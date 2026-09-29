import type { Box2d } from '../types';
import { OCR_CACHE_NAME, OCR_MODEL_FILES } from './mangaOcrConfig';
import type { OcrRequest, OcrResponse } from './mangaOcr.worker';

/**
 * 로컬 OCR(manga-ocr) 워커를 다루는 쪽. 모델 받기·상태·말풍선 읽기.
 * 번역 요청과 별개로 돌아가며 API 비용이 들지 않습니다.
 */

export interface OcrModelStatus {
  state: 'idle' | 'loading' | 'ready' | 'error';
  /** 받는 중일 때 바이트 */
  loaded: number;
  total: number;
  error?: string;
}

let status: OcrModelStatus = { state: 'idle', loaded: 0, total: 0 };
const listeners = new Set<() => void>();

function setStatus(next: Partial<OcrModelStatus>) {
  status = { ...status, ...next };
  listeners.forEach(listener => listener());
}

export const getOcrStatus = () => status;
export function subscribeOcrStatus(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (texts: string[]) => void; reject: (error: Error) => void }>();
let readyWaiters: { resolve: () => void; reject: (error: Error) => void }[] = [];

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./mangaOcr.worker.ts', import.meta.url), { type: 'module' });
  created.onmessage = (event: MessageEvent<OcrResponse>) => {
    const message = event.data;
    if (message.type === 'progress') {
      setStatus({ state: 'loading', loaded: message.loaded, total: message.total });
    } else if (message.type === 'ready') {
      setStatus({ state: 'ready', error: undefined });
      readyWaiters.forEach(waiter => waiter.resolve());
      readyWaiters = [];
    } else if (message.type === 'load-error') {
      setStatus({ state: 'error', error: message.error });
      readyWaiters.forEach(waiter => waiter.reject(new Error(message.error)));
      readyWaiters = [];
    } else {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.type === 'result') {
        console.debug(`[ocr] 말풍선 ${message.texts.length}개 읽음 (${message.elapsedMs}ms)`);
        request.resolve(message.texts);
      } else {
        request.reject(new Error(`로컬 OCR 실패: ${message.error}`));
      }
    }
  };
  created.onerror = event => {
    const error = new Error(`로컬 OCR 워커 오류: ${event.message || '알 수 없는 오류'}`);
    pending.forEach(request => request.reject(error));
    pending.clear();
    readyWaiters.forEach(waiter => waiter.reject(error));
    readyWaiters = [];
    setStatus({ state: 'error', error: error.message });
    created.terminate();
    if (worker === created) worker = null;
  };
  worker = created;
  return created;
}

/** 모델을 받아(이미 받았으면 보관본으로) 읽을 준비를 합니다. */
export function loadOcrModel(): Promise<void> {
  if (status.state === 'ready') return Promise.resolve();
  const promise = new Promise<void>((resolve, reject) => readyWaiters.push({ resolve, reject }));
  if (status.state !== 'loading') {
    setStatus({ state: 'loading', loaded: 0, total: 0, error: undefined });
    getWorker().postMessage({ type: 'load' } satisfies OcrRequest);
  }
  return promise;
}

/** 모델 파일을 이미 받아 두었는지 */
export async function isOcrModelDownloaded(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(OCR_CACHE_NAME);
    const found = await Promise.all(Object.values(OCR_MODEL_FILES).map(url => cache.match(url)));
    return found.every(Boolean);
  } catch {
    return false;
  }
}

/** 받아 둔 모델을 지웁니다 (브라우저 저장 공간 약 120MB 확보) */
export async function deleteOcrModel(): Promise<void> {
  worker?.terminate();
  worker = null;
  pending.forEach(request => request.reject(new Error('로컬 OCR 모델을 지웠습니다.')));
  pending.clear();
  setStatus({ state: 'idle', loaded: 0, total: 0, error: undefined });
  if (typeof caches !== 'undefined') await caches.delete(OCR_CACHE_NAME);
}

/** 박스에 딱 맞게 자르면 가장자리 획이 잘리므로 조금 넓혀 자름 */
const CROP_MARGIN_RATIO = 0.05;

/** 페이지의 말풍선 영역들(0~1000 좌표)을 잘라 로컬 OCR로 읽습니다. 순서는 boxes 그대로 */
export async function recognizeBoxes(image: HTMLImageElement, boxes: Box2d[]): Promise<string[]> {
  if (boxes.length === 0) return [];
  await loadOcrModel();
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const bitmaps = await Promise.all(boxes.map(([ymin, xmin, ymax, xmax]) => {
    const x0 = (xmin / 1000) * width;
    const y0 = (ymin / 1000) * height;
    const x1 = (xmax / 1000) * width;
    const y1 = (ymax / 1000) * height;
    const marginX = (x1 - x0) * CROP_MARGIN_RATIO;
    const marginY = (y1 - y0) * CROP_MARGIN_RATIO;
    const sx = Math.max(0, Math.floor(x0 - marginX));
    const sy = Math.max(0, Math.floor(y0 - marginY));
    const sw = Math.max(1, Math.min(width, Math.ceil(x1 + marginX)) - sx);
    const sh = Math.max(1, Math.min(height, Math.ceil(y1 + marginY)) - sy);
    return createImageBitmap(image, sx, sy, sw, sh);
  }));
  const id = nextId++;
  return new Promise<string[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: 'recognize', id, bitmaps } satisfies OcrRequest, bitmaps);
  });
}
