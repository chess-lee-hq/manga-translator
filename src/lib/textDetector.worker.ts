// CPU(WASM) 전용 빌드 (yolo.worker와 같은 이유)
import * as ort from 'onnxruntime-web/wasm';
import type { PixelBox } from './bubbleShape';

ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
ort.env.wasm.numThreads = 1;

export interface TextDetectRequest {
  id: number;
  bitmap: ImageBitmap;
  modelUrl: string;
}

export type TextDetectResponse =
  | {
    id: number;
    ok: true;
    /** 모델 입력 격자(size×size)의 글자 픽셀 (1 = 글자 획) */
    mask: Uint8Array;
    size: number;
    /** 원본 px → 격자: x * scale + padX */
    scale: number;
    padX: number;
    padY: number;
    /** 글자 줄 (원본 px). 모델이 줄 가운데만 가늘게 잡으므로 실제 글자보다 좁음 */
    lines: PixelBox[];
    elapsedMs: number;
  }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as Worker;
/** comic-text-detector 입력 크기 */
const INPUT_SIZE = 1024;
/** 이 확률 이상이면 글자 픽셀·글자 줄 */
const SEG_THRESHOLD = 0.3;
const LINE_THRESHOLD = 0.3;
/** 이보다 작은 줄 덩어리(격자 칸 수)는 잡티 */
const MIN_LINE_CELLS = 20;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession(modelUrl: string) {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] }).catch(error => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

/** 1024×1024 레터박스(가운데, 회색 여백) → [1, 3, 1024, 1024] float32 */
function preprocess(bitmap: ImageBitmap) {
  const size = INPUT_SIZE;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('OffscreenCanvas 2D 컨텍스트를 만들 수 없습니다.');
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const newW = Math.round(bitmap.width * scale);
  const newH = Math.round(bitmap.height * scale);
  const padX = Math.floor((size - newW) / 2);
  const padY = Math.floor((size - newH) / 2);
  context.fillStyle = 'rgb(114,114,114)';
  context.fillRect(0, 0, size, size);
  context.drawImage(bitmap, padX, padY, newW, newH);
  const pixels = context.getImageData(0, 0, size, size).data;
  const area = size * size;
  const input = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    input[i] = pixels[i * 4] / 255;
    input[area + i] = pixels[i * 4 + 1] / 255;
    input[2 * area + i] = pixels[i * 4 + 2] / 255;
  }
  return { input, scale, padX, padY };
}

/** 줄 확률 지도에서 이어진 덩어리마다 범위 (원본 px) */
function linesOf(prob: Float32Array, size: number, scale: number, padX: number, padY: number): PixelBox[] {
  const on = new Uint8Array(size * size);
  for (let i = 0; i < on.length; i++) on[i] = prob[i] > LINE_THRESHOLD ? 1 : 0;
  const lines: PixelBox[] = [];
  const stack: number[] = [];
  for (let start = 0; start < on.length; start++) {
    if (!on[start]) continue;
    on[start] = 0;
    stack.push(start);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let cells = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % size;
      const y = (i - x) / size;
      cells++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, y > 0 ? i - size : -1, y < size - 1 ? i + size : -1]) {
        if (j >= 0 && on[j]) {
          on[j] = 0;
          stack.push(j);
        }
      }
    }
    if (cells < MIN_LINE_CELLS) continue;
    lines.push({ xmin: (x0 - padX) / scale, ymin: (y0 - padY) / scale, xmax: (x1 + 1 - padX) / scale, ymax: (y1 + 1 - padY) / scale });
  }
  return lines;
}

async function detect(request: TextDetectRequest): Promise<TextDetectResponse> {
  const started = performance.now();
  try {
    const session = await getSession(request.modelUrl);
    const { input, scale, padX, padY } = preprocess(request.bitmap);
    const size = INPUT_SIZE;
    const outputs = await session.run({ images: new ort.Tensor('float32', input, [1, 3, size, size]) });
    const seg = outputs.seg.data as Float32Array;
    const det = outputs.det.data as Float32Array;
    const mask = new Uint8Array(size * size);
    for (let i = 0; i < mask.length; i++) mask[i] = seg[i] > SEG_THRESHOLD ? 1 : 0;
    // det의 첫 번째 지도(줄 가운데 확률)만 씀
    const lines = linesOf(det.subarray(0, size * size), size, scale, padX, padY);
    return { id: request.id, ok: true, mask, size, scale, padX, padY, lines, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    request.bitmap.close();
  }
}

let queue: Promise<void> = Promise.resolve();
ctx.onmessage = (event: MessageEvent<TextDetectRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    const response = await detect(request);
    ctx.postMessage(response, response.ok ? [response.mask.buffer] : []);
  });
};
