import type { BubbleShape } from './bubbleShape';
import { OVERLAY_STYLE } from './overlayLayout';

/**
 * 원본 말풍선 모양 안에 번역문을 배치합니다. (화면과 이미지 저장이 같은 계산 사용)
 *
 * 번역문이 길 때 글자가 읽을 수 없을 만큼 작아지지 않도록 단계적으로 물러납니다.
 * 1. 모양대로 채우기: 줄마다 그 높이의 말풍선 폭에 맞춰 줄바꿈 (가운데 줄은 넓게, 위아래 줄은 좁게)
 * 2. 줄 간격 조이기
 * 3. 최소 글자 크기(BUBBLE_FIT.minFontPx) 아래로는 절대 줄이지 않음 — 네모 상자(10px)보다 높게 잡아,
 *    말풍선 안에 억지로 작게 넣기보다 넓은 네모 상자로 넘기는 편을 택함
 * 4. 그래도 넘치면 흰 영역을 말풍선 모양 그대로 조금 키움 (면적 약 1.35배까지)
 * 5. 그래도 넘치면 null → 호출하는 쪽이 지금의 둥근 사각형 덮기로 표시
 */

export const BUBBLE_FIT = {
  /** 말풍선 맞춤에서 허용하는 가장 작은 글자 (배율 100% 화면 px). 이보다 작아져야 하면 맞춤을 포기 */
  minFontPx: 12,
  /** 줄 간격 (기본 → 조인 값) */
  lineHeights: [OVERLAY_STYLE.lineHeight, 1.02],
  /** 말풍선 테두리와 글자 사이 여백 (글자 크기 대비) */
  insetXEm: 0.3,
  insetYEm: 0.25,
  /** 흰 영역을 키우는 단계 (말풍선 무게중심 기준 가로·세로 배율) */
  expandScales: [1.08, 1.16],
  /** 글자 크기를 몇 단계로 나눠 시도할지 */
  fontSteps: 24,
} as const;

export interface BubbleLine {
  text: string;
  /** 줄 가운데 x, 줄 위쪽 y (그리는 좌표계 px) */
  cx: number;
  top: number;
}

export interface BubbleTextLayout {
  fontSize: number;
  lineHeight: number;
  lines: BubbleLine[];
  /** 흰색으로 채울 모양 (그리는 좌표계 px, 위에서부터 [왼쪽, 오른쪽]) */
  fill: { top: number; rowHeight: number; rows: ([number, number] | null)[] };
  /** 말풍선 밖으로 흰 영역을 넓혀야 들어갔음 */
  expanded: boolean;
}

type Measure = (text: string, fontSize: number) => number;

interface PxShape {
  top: number;
  rowHeight: number;
  rows: ([number, number] | null)[];
  centerX: number;
  centerY: number;
}

function toPx(shape: BubbleShape, pageWidth: number, pageHeight: number): PxShape {
  const sx = pageWidth / 1000;
  const sy = pageHeight / 1000;
  return {
    top: shape.top * sy,
    rowHeight: shape.rowHeight * sy,
    rows: shape.rows.map(r => (r ? [r[0] * sx, r[1] * sx] : null)),
    centerX: shape.centerX * sx,
    centerY: shape.centerY * sy,
  };
}

/** 모양을 무게중심 기준으로 가로·세로 같은 배율로 키움 (타원은 더 큰 타원이 되도록 행을 다시 뽑음) */
function scaleShape(shape: PxShape, factor: number): PxShape {
  const height = shape.rows.length * shape.rowHeight;
  const newTop = shape.centerY - (shape.centerY - shape.top) * factor;
  const count = Math.ceil((height * factor) / shape.rowHeight);
  const rows: ([number, number] | null)[] = [];
  for (let i = 0; i < count; i++) {
    const y = newTop + (i + 0.5) * shape.rowHeight;
    const source = shape.rows[Math.floor((shape.centerY + (y - shape.centerY) / factor - shape.top) / shape.rowHeight)];
    rows.push(source ? [shape.centerX + (source[0] - shape.centerX) * factor, shape.centerX + (source[1] - shape.centerX) * factor] : null);
  }
  return { ...shape, top: newTop, rows };
}

/** y 구간 [y0, y1]에 걸친 모든 행에서 공통으로 쓸 수 있는 가로 구간 */
function bandSpan(shape: PxShape, y0: number, y1: number): [number, number] | null {
  const first = Math.floor((y0 - shape.top) / shape.rowHeight);
  const last = Math.ceil((y1 - shape.top) / shape.rowHeight) - 1;
  if (first < 0 || last >= shape.rows.length || last < first) return null;
  let left = -Infinity;
  let right = Infinity;
  for (let i = first; i <= last; i++) {
    const row = shape.rows[i];
    if (!row) return null;
    left = Math.max(left, row[0]);
    right = Math.min(right, row[1]);
  }
  return right > left ? [left, right] : null;
}

/**
 * 줄마다 다른 폭에 맞춰 줄바꿈합니다. 공백(어절) 단위로 끊고,
 * allowBreakWord일 때만 한 어절이 줄보다 길면 글자 단위로 자릅니다. 줄이 모자라면 null.
 */
export function wrapToWidths(text: string, widths: number[], measure: (t: string) => number, allowBreakWord: boolean): string[] | null {
  const lines: string[] = [];
  let line = '';
  const limit = () => (widths[lines.length] ?? -1) + 0.01;
  const pushLine = () => {
    lines.push(line.trimEnd());
    line = '';
    return lines.length < widths.length;
  };

  const paragraphs = text.split('\n');
  for (let p = 0; p < paragraphs.length; p++) {
    for (const token of paragraphs[p].split(/(\s+)/).filter(Boolean)) {
      if (!token.trim()) {
        if (line) line += ' ';
        continue;
      }
      if (measure(line + token) <= limit()) {
        line += token;
        continue;
      }
      if (line.trim() && !pushLine()) return null;
      line = '';
      if (measure(token) <= limit()) {
        line = token;
        continue;
      }
      if (!allowBreakWord) return null;
      for (const ch of Array.from(token)) {
        if (line && measure(line + ch) > limit()) {
          if (!pushLine()) return null;
        }
        if (measure(ch) > limit()) return null;
        line += ch;
      }
    }
    if (p < paragraphs.length - 1 && !pushLine()) return null;
  }
  if (line.trim() || lines.length === 0) {
    if (lines.length >= widths.length) return null;
    lines.push(line.trimEnd());
  }
  return lines;
}

function tryFit(text: string, shape: PxShape, fontSize: number, lineHeightEm: number, measure: Measure, allowBreakWord: boolean): BubbleLine[] | null {
  const lineHeight = fontSize * lineHeightEm;
  const insetX = fontSize * BUBBLE_FIT.insetXEm;
  const insetY = fontSize * BUBBLE_FIT.insetYEm;
  const innerTop = shape.top + insetY;
  const innerBottom = shape.top + shape.rows.length * shape.rowHeight - insetY;
  const maxLines = Math.floor((innerBottom - innerTop) / lineHeight);
  const measureAt = (t: string) => measure(t, fontSize);
  // 줄 폭을 다 더해도 글 전체 길이보다 짧으면 그 줄 수로는 절대 안 들어감 (빠른 제외)
  const totalWidth = measureAt(text.replace(/\s+/g, ''));

  const linesAt = (top: number, count: number) => {
    const spans: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      const span = bandSpan(shape, top + i * lineHeight, top + (i + 1) * lineHeight);
      // 두 글자도 못 들어가는 좁은 줄(말풍선 뾰족한 끝)은 쓰지 않음 — 한 글자만 외따로 남는 줄 방지
      if (!span || span[1] - span[0] - insetX * 2 < fontSize * 2) return null;
      spans.push(span);
    }
    return spans;
  };
  const centeredTop = (count: number) => Math.min(Math.max(shape.centerY - (count * lineHeight) / 2, innerTop), innerBottom - count * lineHeight);

  for (let count = 1; count <= maxLines; count++) {
    // 글자 덩어리의 가운데를 말풍선 무게중심에 두고, 위아래 끝을 넘으면 안쪽으로 밀어 넣음
    const top = centeredTop(count);
    const spans = linesAt(top, count);
    if (!spans) continue;
    const widths = spans.map(s => s[1] - s[0] - insetX * 2);
    if (widths.reduce((a, b) => a + b, 0) < totalWidth) continue;

    const lines = wrapToWidths(text, widths, measureAt, allowBreakWord);
    if (!lines) continue;

    if (lines.length < count) {
      // 줄이 덜 쓰였으면 실제 줄 수로 다시 가운데 정렬 (새 자리에서도 각 줄이 들어갈 때만)
      const retop = centeredTop(lines.length);
      const respans = linesAt(retop, lines.length);
      if (respans && lines.every((line, i) => measureAt(line) <= respans[i][1] - respans[i][0] - insetX * 2 + 0.01)) {
        return lines.map((line, i) => ({ text: line, cx: (respans[i][0] + respans[i][1]) / 2, top: retop + i * lineHeight }));
      }
    }
    return lines.map((line, i) => ({ text: line, cx: (spans[i][0] + spans[i][1]) / 2, top: top + i * lineHeight }));
  }
  return null;
}

/** 글자 폭은 글자 크기에 비례하므로 조각마다 한 번만 재고 크기만 곱함 (배치 탐색 중 수천 번 재는 비용 절약) */
const MEASURE_BASE_PX = 100;
function cachedMeasure(measure: Measure): Measure {
  const cache = new Map<string, number>();
  return (text, fontSize) => {
    let width = cache.get(text);
    if (width === undefined) {
      width = measure(text, MEASURE_BASE_PX);
      cache.set(text, width);
    }
    return (width * fontSize) / MEASURE_BASE_PX;
  };
}

/**
 * @param shape 말풍선 모양 (0~1000)
 * @param pageWidth/pageHeight 그리는 좌표계의 페이지 크기 (화면 CSS px 또는 원본 이미지 px)
 * @param minFont/maxFont 그리는 좌표계 기준 글자 크기 범위
 */
export function layoutBubbleText(
  text: string,
  shape: BubbleShape,
  pageWidth: number,
  pageHeight: number,
  measure: Measure,
  minFont: number,
  maxFont: number,
): BubbleTextLayout | null {
  const trimmed = text.trim();
  if (!trimmed || !(maxFont >= minFont && minFont > 0)) return null;
  const base = toPx(shape, pageWidth, pageHeight);
  const step = Math.max((maxFont - minFont) / BUBBLE_FIT.fontSteps, 0.25);
  const measureFast = cachedMeasure(measure);

  const attempt = (candidate: PxShape, allowBreakWord: boolean) => {
    for (const lineHeightEm of BUBBLE_FIT.lineHeights) {
      for (let fontSize = maxFont; fontSize >= minFont - 1e-6; fontSize -= step) {
        const lines = tryFit(trimmed, candidate, fontSize, lineHeightEm, measureFast, allowBreakWord);
        if (lines) return { fontSize, lineHeight: fontSize * lineHeightEm, lines };
      }
    }
    return null;
  };

  const shapes: [PxShape, boolean][] = [[base, false], ...BUBBLE_FIT.expandScales.map(f => [scaleShape(base, f), true] as [PxShape, boolean])];
  // 어절을 중간에서 자르지 않는 배치를 (흰 영역을 키우는 것까지) 먼저 모두 찾아보고, 어떻게도 안 될 때만 글자 단위로 자름
  for (const allowBreakWord of [false, true]) {
    for (const [candidate, expanded] of shapes) {
      const fit = attempt(candidate, allowBreakWord);
      if (fit) return { ...fit, fill: { top: candidate.top, rowHeight: candidate.rowHeight, rows: candidate.rows }, expanded };
    }
  }
  return null;
}

/** 채울 모양의 외곽선 (왼쪽 끝을 위→아래, 오른쪽 끝을 아래→위로 이은 다각형). 빈 행은 건너뜀 */
export function fillOutline(fill: BubbleTextLayout['fill']): [number, number][] {
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  fill.rows.forEach((row, i) => {
    if (!row) return;
    const y0 = fill.top + i * fill.rowHeight;
    const y1 = y0 + fill.rowHeight;
    left.push([row[0], y0], [row[0], y1]);
    right.push([row[1], y0], [row[1], y1]);
  });
  return [...left, ...right.reverse()];
}

/**
 * 번역문을 줄이면 몇 글자까지 들어가는지 (확장 없이, 최소 글자 크기 기준).
 * "짧게 다시 번역"에 목표 글자 수로 넘깁니다.
 */
export function bubbleCapacity(text: string, shape: BubbleShape, pageWidth: number, pageHeight: number, measure: Measure, minFont: number): number {
  const chars = Array.from(text.trim());
  const base = toPx(shape, pageWidth, pageHeight);
  const measureFast = cachedMeasure(measure);
  const fits = (n: number) => !!tryFit(chars.slice(0, n).join(''), base, minFont, BUBBLE_FIT.lineHeights[1], measureFast, true);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  return low;
}
