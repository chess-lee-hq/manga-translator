/**
 * 글자 픽셀 모델(comic-text-detector, 오픈소스 GPL-3.0)로 페이지의 원문 글자 획과 글자 줄을 찾습니다.
 * - 글자 획: 원문을 지울 때 테두리·그림은 남기고 글자만 지움 (예전 규칙은 구름 테두리·말 그림 조각까지 지웠음)
 * - 글자 줄: 붙은 말풍선을 말풍선별로 나눔 (한 말풍선의 줄들은 같은 높이에 나란히, 붙은 다른 말풍선 줄은 위·아래로 비켜 있음)
 * 모델을 못 불러오거나 실패하면 null → 예전 규칙으로 처리
 */
import type { PixelBox } from './bubbleShape';
import type { TextDetectRequest, TextDetectResponse } from './textDetector.worker';

// 가중치를 float16으로 저장한 모델(90MB → 46MB). scripts/convert_yolo_fp16_weights.py
const getModelUrl = () => new URL(`${import.meta.env.BASE_URL}comictextdetector_fp16w.onnx`, document.baseURI).href;

/** 페이지 한 장의 글자 픽셀. mask는 모델 격자(size×size), 원본 px → 격자는 x * scale + pad */
export interface TextPixels {
  mask: Uint8Array;
  size: number;
  scale: number;
  padX: number;
  padY: number;
  /** 글자 줄 (원본 px, 모델이 잡은 가는 줄 가운데) */
  lines: PixelBox[];
}

/** 번역 결과에 함께 저장하는 원문 글자 획 (원본 px 범위 + 줄마다 칸 수를 번갈아 적은 run-length, 0부터 시작) */
export interface TextMask {
  x: number;
  y: number;
  w: number;
  h: number;
  rle: string;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (response: TextDetectResponse) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./textDetector.worker.ts', import.meta.url), { type: 'module' });
  created.onmessage = (event: MessageEvent<TextDetectResponse>) => {
    const resolve = pending.get(event.data.id);
    pending.delete(event.data.id);
    resolve?.(event.data);
  };
  created.onerror = event => {
    const error = event.message || '알 수 없는 오류';
    pending.forEach((resolve, id) => resolve({ id, ok: false, error }));
    pending.clear();
    created.terminate();
    if (worker === created) worker = null;
  };
  worker = created;
  return created;
}

/** 페이지의 글자 픽셀·글자 줄. 실패하면 null (번역은 예전 규칙으로 계속) */
export async function detectTextPixels(image: HTMLImageElement): Promise<TextPixels | null> {
  try {
    const bitmap = await createImageBitmap(image);
    const id = nextId++;
    const response = await new Promise<TextDetectResponse>(resolve => {
      pending.set(id, resolve);
      const request: TextDetectRequest = { id, bitmap, modelUrl: getModelUrl() };
      getWorker().postMessage(request, [bitmap]);
    });
    if (!response.ok) {
      console.warn('글자 픽셀 찾기 실패 — 예전 방식으로 처리합니다:', response.error);
      return null;
    }
    console.debug(`[글자 픽셀] 글자 줄 ${response.lines.length}개 (${response.elapsedMs}ms)`);
    const { mask, size, scale, padX, padY, lines } = response;
    return { mask, size, scale, padX, padY, lines };
  } catch (error) {
    console.warn('글자 픽셀 찾기 실패 — 예전 방식으로 처리합니다:', error);
    return null;
  }
}

/** 원본 px (x, y)가 글자 획인지 */
function isTextAt(tp: TextPixels, x: number, y: number): boolean {
  const gx = Math.floor(x * tp.scale + tp.padX);
  const gy = Math.floor(y * tp.scale + tp.padY);
  if (gx < 0 || gy < 0 || gx >= tp.size || gy >= tp.size) return false;
  return tp.mask[gy * tp.size + gx] === 1;
}

/** 글자 영역(+여유) 안의 원문 글자 획을 원본 해상도로 잘라 저장용으로. 획이 없으면 null */
export function textMaskFor(tp: TextPixels, box: PixelBox, pad: number, imageWidth: number, imageHeight: number): TextMask | null {
  const x = Math.max(0, Math.floor(box.xmin - pad));
  const y = Math.max(0, Math.floor(box.ymin - pad));
  const w = Math.min(imageWidth, Math.ceil(box.xmax + pad)) - x;
  const h = Math.min(imageHeight, Math.ceil(box.ymax + pad)) - y;
  if (w <= 0 || h <= 0) return null;
  const bits = new Uint8Array(w * h);
  let any = false;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (isTextAt(tp, x + i + 0.5, y + j + 0.5)) {
        bits[j * w + i] = 1;
        any = true;
      }
    }
  }
  return any ? { x, y, w, h, rle: encodeRle(bits) } : null;
}

/** 0·1 배열 → 번갈아 이어지는 칸 수(0부터)를 36진수로 쉼표로 이음 */
export function encodeRle(bits: Uint8Array): string {
  const runs: number[] = [];
  let current = 0;
  let count = 0;
  for (const bit of bits) {
    if (bit === current) count++;
    else {
      runs.push(count);
      current = bit;
      count = 1;
    }
  }
  runs.push(count);
  return runs.map(n => n.toString(36)).join(',');
}

export function decodeRle(rle: string, length: number): Uint8Array {
  const bits = new Uint8Array(length);
  let at = 0;
  let value = 0;
  for (const part of rle.split(',')) {
    const n = parseInt(part, 36) || 0;
    if (value) bits.fill(1, at, Math.min(length, at + n));
    at += n;
    value = 1 - value;
  }
  return bits;
}

export function isTextMask(value: unknown): value is TextMask {
  const m = value as TextMask;
  return !!m && typeof m === 'object' && [m.x, m.y, m.w, m.h].every(n => Number.isInteger(n) && n >= 0) && m.w > 0 && m.h > 0 && typeof m.rle === 'string';
}

/** 글자 줄 묶기 기준 (글자 폭 배수) */
const LINE_GROUP = {
  /** 이웃한 두 줄이 같은 말풍선: 좌우 틈이 이 이하이고, 짧은 줄 높이의 이 비율 이상 위아래로 겹침 */
  maxColumnGap: 1.8,
  minOverlap: 0.5,
  /** 같은 줄이 줄표·말줄임표에서 끊긴 것: 좌우로 겹치고 위아래 틈이 이 이하 (가로쓰기 줄끼리도 이렇게 이어짐) */
  maxStackGap: 0.8,
  /** 따로 서는 묶음: 줄 길이 합이 글자 이만큼 이상 (아니면 가까운 묶음에 붙임 — 그림에 잘못 잡힌 짧은 줄) */
  minLength: 1.5,
  maxGroups: 4,
  /** 줄 범위를 이만큼(줄 폭 배수) 양옆으로 넓혀 실제 글자 폭으로 — 모델은 줄 가운데만 가늘게 잡음 */
  unclip: 0.5,
} as const;

/**
 * 글자 영역 안 글자 줄을 말풍선별로 묶어 두 칸 이상이면 칸마다 범위(원본 px, 읽는 순서)를, 아니면 null.
 * 한 말풍선 = 줄들이 좌우로 가깝고 위아래로 절반 넘게 겹침 (또는 같은 줄이 줄표에서 끊김)
 */
export function splitByTextLines(lines: PixelBox[], box: PixelBox): PixelBox[] | null {
  const inside = lines
    .filter(l => {
      const cx = (l.xmin + l.xmax) / 2;
      const cy = (l.ymin + l.ymax) / 2;
      return cx >= box.xmin && cx <= box.xmax && cy >= box.ymin && cy <= box.ymax;
    })
    .map(l => {
      const grow = Math.min(l.xmax - l.xmin, l.ymax - l.ymin) * LINE_GROUP.unclip;
      return { xmin: l.xmin - grow, ymin: l.ymin - grow, xmax: l.xmax + grow, ymax: l.ymax + grow };
    });
  if (inside.length < 2) return null;
  const widths = inside.map(l => Math.min(l.xmax - l.xmin, l.ymax - l.ymin)).sort((a, b) => a - b);
  const glyph = widths[Math.floor(widths.length / 2)];
  const parent = inside.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < inside.length; i++) {
    for (let j = i + 1; j < inside.length; j++) {
      const a = inside[i];
      const b = inside[j];
      const gapX = Math.max(a.xmin, b.xmin) - Math.min(a.xmax, b.xmax);
      const gapY = Math.max(a.ymin, b.ymin) - Math.min(a.ymax, b.ymax);
      const shorter = Math.min(a.ymax - a.ymin, b.ymax - b.ymin);
      const sideBySide = gapX <= glyph * LINE_GROUP.maxColumnGap && -gapY >= shorter * LINE_GROUP.minOverlap;
      const stacked = gapX < 0 && gapY <= glyph * LINE_GROUP.maxStackGap;
      if (sideBySide || stacked) parent[find(i)] = find(j);
    }
  }
  type Group = PixelBox & { length: number };
  const byRoot = new Map<number, Group>();
  inside.forEach((l, i) => {
    const length = Math.max(l.xmax - l.xmin, l.ymax - l.ymin);
    const g = byRoot.get(find(i));
    if (!g) byRoot.set(find(i), { ...l, length });
    else Object.assign(g, { xmin: Math.min(g.xmin, l.xmin), ymin: Math.min(g.ymin, l.ymin), xmax: Math.max(g.xmax, l.xmax), ymax: Math.max(g.ymax, l.ymax), length: g.length + length });
  });
  const groups = [...byRoot.values()];
  const big = groups.filter(g => g.length >= glyph * LINE_GROUP.minLength);
  if (big.length < 2 || big.length > LINE_GROUP.maxGroups) return null;
  const distance = (a: PixelBox, b: PixelBox) => Math.hypot(
    Math.max(0, Math.max(a.xmin, b.xmin) - Math.min(a.xmax, b.xmax)),
    Math.max(0, Math.max(a.ymin, b.ymin) - Math.min(a.ymax, b.ymax)),
  );
  for (const small of groups.filter(g => !big.includes(g))) {
    const near = big.reduce((p, q) => (distance(small, q) < distance(small, p) ? q : p));
    Object.assign(near, { xmin: Math.min(near.xmin, small.xmin), ymin: Math.min(near.ymin, small.ymin), xmax: Math.max(near.xmax, small.xmax), ymax: Math.max(near.ymax, small.ymax) });
  }
  // 읽는 순서: 위아래로 비켜 있으면 위 먼저, 아니면 오른쪽 먼저
  big.sort((a, b) => (a.ymax < b.ymin ? -1 : b.ymax < a.ymin ? 1 : b.xmax - a.xmax));
  // 후리가나·문장부호가 들어가게 글자 반 자 여유 (원래 글자 영역 밖으로는 반 자까지만)
  const pad = glyph * 0.5;
  return big.map(g => ({
    xmin: Math.max(box.xmin - pad, g.xmin - pad),
    ymin: Math.max(box.ymin - pad, g.ymin - pad),
    xmax: Math.min(box.xmax + pad, g.xmax + pad),
    ymax: Math.min(box.ymax + pad, g.ymax + pad),
  }));
}
