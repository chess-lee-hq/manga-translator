import { NO_BUBBLE_FAILURES, type BubbleDetection, type BubbleShape, type GlyphMask } from './bubbleShape';
import { wantsBubbleFit } from './bubbleDisplay';
import type { TranslationResult } from './gemini';
import { columnUnits, cornerRadiusPx, fillColumns, getDisplayBox, OVERLAY_STYLE, VERTICAL_TEXT, verticalCells, type VerticalCell } from './overlayLayout';

/**
 * 원본 말풍선 모양 안에 번역문을 배치합니다. (화면과 이미지 저장이 같은 계산 사용)
 *
 * 번역문이 길 때 글자가 읽을 수 없을 만큼 작아지지 않도록 단계적으로 물러납니다.
 * 1. 모양대로 채우기: 줄마다 그 높이의 말풍선 폭에 맞춰 줄바꿈 (가운데 줄은 넓게, 위아래 줄은 좁게)
 * 2. 줄 간격 조이기
 * 3. 최소 글자 크기(BUBBLE_FIT.minFontPx) 아래로는 절대 줄이지 않음
 * 4. 그래도 넘치면 흰색은 말풍선 안쪽만 칠하고(원래 말풍선 모양·테두리를 지키기 위해 절대 밖으로 넓히지 않음)
 *    글자만 말풍선 밖으로 넘치게 둠 + "넘침" 표시 → 사용자가 직접 "짧게 다시 번역" (자동 재요청은 토큰이 들어 하지 않음)
 */

export const BUBBLE_FIT = {
  /**
   * 말풍선 맞춤에서 허용하는 가장 작은 글자 (배율 100% 화면 px). 이보다 작아져야 하면 넘침.
   * 12였는데 원문 글자가 아주 작은 말풍선(화면에서 8px 안팎)은 어떻게 배치해도 넘쳐, 네모 상자와 같은 10으로
   */
  minFontPx: 10,
  /**
   * 말풍선 맞춤에서 쓰는 가장 큰 글자 (배율 100% 화면 px). 네모 상자(28)보다 낮게 잡아
   * 큰 말풍선에서도 글자가 꽉 차지 않고 말풍선마다 크기가 비슷하게 (단행본처럼 여백이 남음)
   */
  maxFontPx: 22,
  /** 원문 글자 크기를 따를 때의 상한 (특대 글씨 강조용) */
  maxEmphasisPx: 48,
  /**
   * 단행본처럼 좁게 쌓기: 한 줄을 이 글자 수(글자 크기 배수) 안으로 줄바꿈한 배치를 먼저 찾음.
   * 그러려면 글자가 narrowMinScale배까지만 작아져도 됨 — 그보다 더 줄여야 하면 넓게 쓰는 예전 배치로
   */
  narrowLineEm: 5.5,
  narrowMinScale: 0.8,
  /** 좁게 쌓으면 이 줄 수를 넘는 긴 대사는 말풍선 폭을 쓰는 배치로 (12줄짜리 가는 기둥이 되지 않게) */
  narrowMaxLines: 6,
  /** 줄 간격 (기본 → 조인 값) */
  lineHeights: [OVERLAY_STYLE.lineHeight, 1.02],
  /** 말풍선 테두리와 글자 사이 여백 (글자 크기 대비) */
  insetXEm: 0.5,
  insetYEm: 0.4,
  /** 최소 글자로도 안 들어갈 때 넘침으로 넘기기 전에 여백을 이만큼으로 줄여 한 번 더 (좁은 말풍선) */
  tightInsetScale: 0.3,
  /**
   * 그래도 안 되면 줄이 말풍선 안쪽보다 좌우로 조금(여백 배율 -1 = 한쪽 0.5글자) 넘쳐도 가로쓰기로 둠.
   * 흰 테두리를 둘러 그림 위에서도 읽히고, 어색한 세로쓰기·어절 자르기보다 낫다는 사용자 판단 (넘침 표시는 띄우지 않음)
   */
  slightOverflowInsetScale: -1,
  /** 글자 크기를 몇 단계로 나눠 시도할지 */
  fontSteps: 24,
  /**
   * 가로로 안 들어갈 때 세로쓰기를 시도할 만큼 홀쭉한 말풍선 (높이 ÷ 너비).
   * 가로로 쓰면 한 줄에 두세 글자밖에 안 들어가는 막대 같은 말풍선만 (1.15였을 땐 조금 긴 말풍선도 세로로 써서 어색했음)
   */
  verticalMinAspect: 2,
  /** 모양을 못 딴 말풍선에 쓰는 타원: 글자 영역 네 모서리를 지나는 타원(√2배)에 약간 여유 */
  ellipseScale: 1.5,
  /** 타원 모양의 행 수 */
  ellipseRows: 64,
  /** 타원의 최소 반지름 (최소 글자 크기 배수). 원문이 한 줄짜리 세로 글이면 타원이 너무 홀쭉해 아무것도 안 들어가므로 */
  ellipseMinRadiusX: 2.5,
  ellipseMinRadiusY: 1.5,
  /** 찾은 말풍선 모양이 원문 글자 영역을 이 비율 이상 품어야 그 모양을 씀 */
  minBoxCoverage: 0.6,
  /**
   * 원문 글자 획 마스크가 글자 영역(말풍선 안쪽) 어두운 픽셀을 이 비율 이상 덮으면 마스크만 씀 (말풍선은 칠하지 않음).
   * 박스에 걸린 테두리·그림도 분모에 들어가 실제 글자를 다 골라도 0.75~0.85가 나오므로 넉넉히 — 이보다 낮으면 글자 고르기가 실패한 것
   */
  maskMinCoverage: 0.6,
  /** 흰색을 칠할 범위: 원문 글자 영역 둘레 여백(최소 글자 배수, 후리가나·박스 밖으로 살짝 나간 획까지) · 번역문 줄 둘레 여백(글자 크기 배수) */
  keepOriginalPadEm: 0.6,
  keepTextPadEm: 0.35,
  /** 테두리를 못 딴 말풍선에서 원문 글자를 지우는 흰 사각형의 여백 (최소 글자 크기 배수) */
  erasePadEm: 0.3,
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
  /** 최소 글자 크기로도 안 들어가 글자가 말풍선 밖으로 넘침 (흰색은 말풍선 안쪽만) */
  overflow: boolean;
}

type Measure = (text: string, fontSize: number) => number;

interface PxShape {
  top: number;
  rowHeight: number;
  /** 글자를 놓을 구간 (BubbleShape.safeRows가 있으면 그것) */
  rows: ([number, number] | null)[];
  /** 흰색으로 칠할 구간 (말풍선 안쪽 전체) */
  fillRows: ([number, number] | null)[];
  centerX: number;
  centerY: number;
}

function toPx(shape: BubbleShape, pageWidth: number, pageHeight: number): PxShape {
  const sx = pageWidth / 1000;
  const sy = pageHeight / 1000;
  const scaleRows = (rows: ([number, number] | null)[]) => rows.map(r => (r ? [r[0] * sx, r[1] * sx] as [number, number] : null));
  return {
    top: shape.top * sy,
    rowHeight: shape.rowHeight * sy,
    rows: scaleRows(shape.safeRows ?? shape.rows),
    fillRows: scaleRows(shape.rows),
    centerX: shape.centerX * sx,
    centerY: shape.centerY * sy,
  };
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

function tryFit(
  text: string,
  shape: PxShape,
  fontSize: number,
  lineHeightEm: number,
  measure: Measure,
  allowBreakWord: boolean,
  /** 한 줄 폭 상한 (단행본처럼 좁게 쌓을 때) */
  maxLineWidth = Infinity,
  /** 테두리 여백 배율 (넘침 직전 마지막 시도에서 줄임). 가로가 음수면 줄이 말풍선 안쪽 폭보다 그만큼 넓어도 됨 */
  insetScale = 1,
  insetYScale = insetScale,
): BubbleLine[] | null {
  const lineHeight = fontSize * lineHeightEm;
  const insetX = fontSize * BUBBLE_FIT.insetXEm * insetScale;
  const insetY = fontSize * BUBBLE_FIT.insetYEm * insetYScale;
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
    const widths = spans.map(s => Math.min(s[1] - s[0] - insetX * 2, maxLineWidth));
    if (widths.reduce((a, b) => a + b, 0) < totalWidth) continue;

    const lines = wrapToWidths(text, widths, measureAt, allowBreakWord);
    if (!lines) continue;

    if (lines.length < count) {
      // 줄이 덜 쓰였으면 실제 줄 수로 다시 가운데 정렬 (새 자리에서도 각 줄이 들어갈 때만)
      const retop = centeredTop(lines.length);
      const respans = linesAt(retop, lines.length);
      if (respans && lines.every((line, i) => measureAt(line) <= Math.min(respans[i][1] - respans[i][0] - insetX * 2, maxLineWidth) + 0.01)) {
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
  /** false면 어절을 중간에서 자르지 않는 배치만 찾음 (세로쓰기를 먼저 시도해 보려고) */
  allowBreakWords = true,
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

  // 1) 단행본처럼 좁게: 한 줄을 narrowLineEm 글자 안으로 (가장 긴 어절은 한 줄에 들어가도록), 어절 유지
  const longestWord = Math.max(...trimmed.split(/\s+/).map(word => measureFast(word, 1)));
  const narrowFloor = Math.max(minFont, maxFont * BUBBLE_FIT.narrowMinScale);
  for (let fontSize = maxFont; fontSize >= narrowFloor - 1e-6; fontSize -= step) {
    const cap = Math.max(fontSize * BUBBLE_FIT.narrowLineEm, longestWord * fontSize);
    const lines = tryFit(trimmed, base, fontSize, BUBBLE_FIT.lineHeights[0], measureFast, false, cap);
    if (lines && lines.length > BUBBLE_FIT.narrowMaxLines) break;
    if (lines) return { fontSize, lineHeight: fontSize * BUBBLE_FIT.lineHeights[0], lines, fill: fillOf(base), overflow: false };
  }

  // 2) 안 되면 말풍선 폭을 다 쓰는 배치. 어절을 중간에서 자르지 않는 배치를 먼저 찾아보고, 안 될 때만 글자 단위로 자름
  for (const allowBreakWord of allowBreakWords ? [false, true] : [false]) {
    const fit = attempt(base, allowBreakWord);
    if (fit) return { ...fit, fill: fillOf(base), overflow: false };
  }

  // 3) 최소 글자로 여백만 줄이면 말풍선 안에 들어가는 좁은 말풍선 (넘침 표시를 띄우지 않도록)
  {
    for (const allowBreakWord of allowBreakWords ? [false, true] : [false]) {
      const lines = tryFit(trimmed, base, minFont, BUBBLE_FIT.lineHeights[1], measureFast, allowBreakWord, Infinity, BUBBLE_FIT.tightInsetScale);
      if (lines) return { fontSize: minFont, lineHeight: minFont * BUBBLE_FIT.lineHeights[1], lines, fill: fillOf(base), overflow: false };
    }
  }
  return null;
}

/**
 * 어절을 지키며 줄이 좌우로만 조금(한쪽 0.5글자) 말풍선 밖으로 나가는 배치. 위아래는 말풍선 안.
 * 홀쭉하지 않은 말풍선에서 어색한 세로쓰기·어절 자르기 대신 씀 (흰색은 말풍선 안쪽만, 넘침 표시 없음)
 */
export function layoutBubbleSlightOverflow(
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
  for (let fontSize = maxFont; fontSize >= minFont - 1e-6; fontSize -= step) {
    const lines = tryFit(trimmed, base, fontSize, BUBBLE_FIT.lineHeights[1], measureFast, false, Infinity, BUBBLE_FIT.slightOverflowInsetScale, BUBBLE_FIT.tightInsetScale);
    if (lines) return { fontSize, lineHeight: fontSize * BUBBLE_FIT.lineHeights[1], lines, fill: fillOf(base), overflow: false };
  }
  return null;
}

const fillOf = (shape: PxShape): BubbleTextLayout['fill'] => ({ top: shape.top, rowHeight: shape.rowHeight, rows: shape.fillRows });

/**
 * 최소 글자 크기로도 안 들어갈 때: 말풍선 가운데 폭에 맞춰 줄바꿈하고 위아래로 넘치게 둠.
 * 흰색은 말풍선 안쪽만 칠하므로 넘친 줄은 그림 위에 놓임 (그리는 쪽이 흰 테두리를 둘러 읽히게 함)
 */
export function layoutBubbleOverflow(
  text: string,
  shape: BubbleShape,
  pageWidth: number,
  pageHeight: number,
  measure: Measure,
  minFont: number,
): BubbleTextLayout | null {
  const trimmed = text.trim();
  if (!trimmed || !(minFont > 0)) return null;
  const base = toPx(shape, pageWidth, pageHeight);
  const fontSize = minFont;
  const lineHeight = fontSize * BUBBLE_FIT.lineHeights[1];
  const insetX = fontSize * BUBBLE_FIT.insetXEm;
  let span = bandSpan(base, base.centerY - lineHeight / 2, base.centerY + lineHeight / 2);
  if (!span) {
    // 가운데 높이에 행이 없으면(아주 낮은 모양) 가장 넓은 행
    for (const row of base.rows) if (row && (!span || row[1] - row[0] > span[1] - span[0])) span = row;
  }
  if (!span) return null;
  const width = Math.max(span[1] - span[0] - insetX * 2, fontSize * 2);
  const measureFast = cachedMeasure(measure);
  const lines = wrapToWidths(trimmed, new Array<number>(Array.from(trimmed).length + 1).fill(width), t => measureFast(t, fontSize), true);
  if (!lines) return null;
  const top = base.centerY - (lines.length * lineHeight) / 2;
  const cx = (span[0] + span[1]) / 2;
  return {
    fontSize,
    lineHeight,
    lines: lines.map((line, i) => ({ text: line, cx, top: top + i * lineHeight })),
    fill: fillOf(base),
    overflow: true,
  };
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

/** 말풍선 모양 안 세로쓰기 배치 (그리는 좌표계 px) */
export interface BubbleVerticalLayout {
  fontSize: number;
  cellHeight: number;
  columnWidth: number;
  /** 첫 열이 가장 오른쪽. cx = 열 가운데 x, top = 첫 칸의 위쪽 y */
  columns: { cx: number; top: number; cells: VerticalCell[] }[];
  fill: BubbleTextLayout['fill'];
  overflow: boolean;
}

export type BubbleFit =
  | { direction: 'horizontal'; layout: BubbleTextLayout }
  | { direction: 'vertical'; layout: BubbleVerticalLayout };

/** 모양의 가로 범위와 높이 (홀쭉한지 판정용) */
function shapeExtent(shape: PxShape) {
  let left = Infinity;
  let right = -Infinity;
  shape.rows.forEach(row => {
    if (!row) return;
    left = Math.min(left, row[0]);
    right = Math.max(right, row[1]);
  });
  return { width: right - left, height: shape.rows.length * shape.rowHeight };
}

/** 가로 구간 [x0, x1]이 통째로 들어가는 세로 구간 — 무게중심 행에서 위아래로 넓혀 감 */
function columnRun(shape: PxShape, x0: number, x1: number): [number, number] | null {
  const covers = (i: number) => {
    const row = shape.rows[i];
    return !!row && row[0] <= x0 && row[1] >= x1;
  };
  let start = Math.min(shape.rows.length - 1, Math.max(0, Math.floor((shape.centerY - shape.top) / shape.rowHeight)));
  if (!covers(start)) {
    // 무게중심 행이 이 열을 못 담으면 가장 가까운 담는 행에서 시작
    let found = -1;
    for (let d = 1; d < shape.rows.length && found < 0; d++) {
      if (covers(start - d)) found = start - d;
      else if (covers(start + d)) found = start + d;
    }
    if (found < 0) return null;
    start = found;
  }
  let first = start;
  let last = start;
  while (first > 0 && covers(first - 1)) first--;
  while (last < shape.rows.length - 1 && covers(last + 1)) last++;
  return [shape.top + first * shape.rowHeight, shape.top + (last + 1) * shape.rowHeight];
}

function tryFitVertical(paragraphs: VerticalCell[][], shape: PxShape, fontSize: number, insetScale = 1): Omit<BubbleVerticalLayout, 'fill' | 'overflow'> | null {
  const cellHeight = fontSize * VERTICAL_TEXT.cellHeight;
  const columnWidth = fontSize * VERTICAL_TEXT.columnWidth;
  const insetX = fontSize * BUBBLE_FIT.insetXEm * insetScale;
  const insetY = fontSize * BUBBLE_FIT.insetYEm * insetScale;
  const totalUnits = paragraphs.reduce((sum, cells) => sum + columnUnits(cells), 0);
  const { width } = shapeExtent(shape);
  const maxColumns = Math.max(1, Math.floor((width - insetX * 2) / columnWidth));

  // 열 묶음의 가로 가운데 후보: 무게중심, 행마다 가운데의 가운데값 (혹이 달린 말풍선은 무게중심이 몸통에서 벗어남)
  const mids = shape.rows.filter((r): r is [number, number] => !!r).map(r => (r[0] + r[1]) / 2).sort((a, b) => a - b);
  const centers = [shape.centerX, ...(mids.length > 0 ? [mids[Math.floor(mids.length / 2)]] : [])];
  for (let count = 1; count <= maxColumns; count++) {
    for (const centerX of centers) {
      const fit = tryColumns(count, centerX);
      if (fit) return fit;
    }
  }
  return null;

  function tryColumns(count: number, centerX: number): Omit<BubbleVerticalLayout, 'fill' | 'overflow'> | null {
    const rightEdge = centerX + (count * columnWidth) / 2;
    const runs: [number, number][] = [];
    for (let j = 0; j < count; j++) {
      const x1 = rightEdge - j * columnWidth;
      const run = columnRun(shape, x1 - columnWidth - insetX, x1 + insetX);
      if (!run) break;
      const top = run[0] + insetY;
      const bottom = run[1] - insetY;
      // 두 칸도 못 들어가는 열(말풍선 뾰족한 끝)은 쓰지 않음
      if ((bottom - top) / cellHeight < 2) break;
      runs.push([top, bottom]);
    }
    if (runs.length < count) return null;
    const capacities = runs.map(([top, bottom]) => (bottom - top) / cellHeight);
    if (capacities.reduce((a, b) => a + b, 0) < totalUnits) return null;

    const filled = fillColumns(paragraphs, j => capacities[j] ?? 0);
    if (filled.length > count || filled.some((column, j) => columnUnits(column) > capacities[j] + 1e-6)) return null;

    return {
      fontSize,
      cellHeight,
      columnWidth,
      columns: filled.map((cells, j) => {
        const [top, bottom] = runs[j];
        const height = columnUnits(cells) * cellHeight;
        // 글자 덩어리를 말풍선 무게중심 높이에 두되 그 열의 세로 구간 안으로
        const columnTop = Math.min(Math.max(shape.centerY - height / 2, top), bottom - height);
        return { cx: rightEdge - (j + 0.5) * columnWidth, top: columnTop, cells };
      }),
    };
  }
}

/**
 * 말풍선 모양 안 세로쓰기. 일본 만화의 홀쭉한 말풍선은 가로로 한 줄에 몇 글자 못 들어가므로,
 * 가로쓰기로 어절을 자르지 않고는 안 들어갈 때 세로로 세워 봅니다.
 */
export function layoutBubbleVertical(
  text: string,
  shape: BubbleShape,
  pageWidth: number,
  pageHeight: number,
  minFont: number,
  maxFont: number,
): BubbleVerticalLayout | null {
  const trimmed = text.trim();
  if (!trimmed || !(maxFont >= minFont && minFont > 0)) return null;
  const paragraphs = trimmed.split('\n').map(verticalCells);
  const base = toPx(shape, pageWidth, pageHeight);
  const step = Math.max((maxFont - minFont) / BUBBLE_FIT.fontSteps, 0.25);
  for (let fontSize = maxFont; fontSize >= minFont - 1e-6; fontSize -= step) {
    const fit = tryFitVertical(paragraphs, base, fontSize);
    if (fit) return { ...fit, fill: fillOf(base), overflow: false };
  }
  // 좁은 말풍선: 최소 글자에서 여백만 줄여 한 번 더
  const tight = tryFitVertical(paragraphs, base, minFont, BUBBLE_FIT.tightInsetScale);
  return tight ? { ...tight, fill: fillOf(base), overflow: false } : null;
}

/** 모양이 홀쭉한지 (가로로 안 들어갈 때 세로쓰기를 시도할 대상) */
export function isTallShape(shape: BubbleShape, pageWidth: number, pageHeight: number): boolean {
  const { width, height } = shapeExtent(toPx(shape, pageWidth, pageHeight));
  return width > 0 && height / width >= BUBBLE_FIT.verticalMinAspect;
}

/** 원문 글자 영역(0~1000) 중 모양 안에 드는 넓이 비율 */
function boxCoverage(shape: BubbleShape, box: [number, number, number, number]): number {
  const [ymin, xmin, ymax, xmax] = box;
  const area = (ymax - ymin) * (xmax - xmin);
  if (!(area > 0)) return 1;
  let covered = 0;
  shape.rows.forEach((row, i) => {
    if (!row) return;
    const y0 = Math.max(ymin, shape.top + i * shape.rowHeight);
    const y1 = Math.min(ymax, shape.top + (i + 1) * shape.rowHeight);
    if (y1 <= y0) return;
    const x0 = Math.max(xmin, row[0]);
    const x1 = Math.min(xmax, row[1]);
    if (x1 > x0) covered += (x1 - x0) * (y1 - y0);
  });
  return covered / area;
}

/** 말풍선 넓이가 표시용 박스의 이 배수를 넘으면 원문 자리 둘레(박스의 localScale배)로 잘라 씀 */
// 1.5배: 이름표 위 흰 옷까지 한 모양으로 잡혀(1.6배) 번역문이 옷 쪽(무게중심)으로 가던 경우까지. 보통 말풍선은 잘라도 거의 그대로
const LOCALIZE = { areaRatio: 1.5, scale: 1.8, strayRatio: 1 } as const;

function shapeArea(shape: BubbleShape): number {
  return shape.rows.reduce((sum, row) => sum + (row ? row[1] - row[0] : 0), 0) * shape.rowHeight;
}

/** 모양의 무게중심이 원문 글자 영역(0~1000)을 그 폭·높이의 절반만큼 넓힌 범위 밖에 있음 */
function strayedFrom(shape: BubbleShape, box: [number, number, number, number]): boolean {
  const [ymin, xmin, ymax, xmax] = box;
  const padX = ((xmax - xmin) / 2) * LOCALIZE.strayRatio;
  const padY = ((ymax - ymin) / 2) * LOCALIZE.strayRatio;
  return shape.centerX < xmin - padX || shape.centerX > xmax + padX || shape.centerY < ymin - padY || shape.centerY > ymax + padY;
}

/** 큰 말풍선 모양을 원문 자리(표시용 박스를 키운 범위)로 잘라, 가운데를 원문 자리로 */
export function localizeShape(shape: BubbleShape, box: [number, number, number, number]): BubbleShape {
  const [ymin, xmin, ymax, xmax] = box;
  const boxArea = (ymax - ymin) * (xmax - xmin);
  if (!(boxArea > 0) || shapeArea(shape) <= boxArea * LOCALIZE.areaRatio) return shape;
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  const halfW = ((xmax - xmin) / 2) * LOCALIZE.scale;
  const halfH = ((ymax - ymin) / 2) * LOCALIZE.scale;
  const rows = shape.rows.map((row, i) => {
    if (!row) return null;
    const y = shape.top + (i + 0.5) * shape.rowHeight;
    if (y < cy - halfH || y > cy + halfH) return null;
    const l = Math.max(row[0], cx - halfW);
    const r = Math.min(row[1], cx + halfW);
    return r > l ? ([l, r] as [number, number]) : null;
  });
  const first = rows.findIndex(Boolean);
  if (first < 0) return shape;
  const last = rows.length - 1 - [...rows].reverse().findIndex(Boolean);
  const safe = shape.safeRows?.slice(first, last + 1).map((row, k) => {
    const clip = rows[first + k];
    if (!row || !clip) return null;
    const l = Math.max(row[0], clip[0]);
    const r = Math.min(row[1], clip[1]);
    return r > l ? ([l, r] as [number, number]) : null;
  });
  return {
    top: shape.top + first * shape.rowHeight,
    rowHeight: shape.rowHeight,
    rows: rows.slice(first, last + 1),
    ...(safe ? { safeRows: safe } : {}),
    centerX: cx,
    centerY: cy,
  };
}

/** 표시용 박스(0~1000)를 모서리가 둥근 흰 상자 모양으로 (radiusPx: 그리는 좌표계 px) */
export function roundedBoxShape(box: [number, number, number, number], pageWidth: number, pageHeight: number, radiusPx: number): BubbleShape {
  const [ymin, xmin, ymax, xmax] = box;
  const rows = 48;
  const rowHeight = (ymax - ymin) / rows;
  const heightPx = ((ymax - ymin) / 1000) * pageHeight;
  const widthPx = ((xmax - xmin) / 1000) * pageWidth;
  const r = Math.max(0, Math.min(radiusPx, heightPx / 2, widthPx / 2));
  const shapeRows: [number, number][] = [];
  for (let i = 0; i < rows; i++) {
    const yPx = ((i + 0.5) / rows) * heightPx;
    const dy = Math.max(0, r - Math.min(yPx, heightPx - yPx));
    const insetPx = r - Math.sqrt(Math.max(0, r * r - dy * dy));
    const inset = (insetPx / pageWidth) * 1000;
    shapeRows.push([xmin + inset, xmax - inset]);
  }
  return { top: ymin, rowHeight, rows: shapeRows, centerX: (xmin + xmax) / 2, centerY: (ymin + ymax) / 2 };
}

/**
 * 말풍선은 있어 보이는데 테두리를 못 딴 경우 번역문을 놓을 타원 (0~1000).
 * 글자 영역 네 모서리를 지나는 타원보다 조금 크게. 흰색은 이 타원이 아니라 원문 글자 영역만 칠함 (planBubble)
 */
export function ellipseShapeForBox(box: [number, number, number, number], pageWidth: number, pageHeight: number, minFont = 0): BubbleShape {
  const [ymin, xmin, ymax, xmax] = box;
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  // 정규화 좌표는 가로·세로 축척이 달라, 실제 화면에서 타원이 되도록 px로 계산한 뒤 되돌림
  const rxPx = Math.max(((xmax - xmin) / 2 / 1000) * pageWidth * BUBBLE_FIT.ellipseScale, minFont * BUBBLE_FIT.ellipseMinRadiusX);
  const ryPx = Math.max(((ymax - ymin) / 2 / 1000) * pageHeight * BUBBLE_FIT.ellipseScale, minFont * BUBBLE_FIT.ellipseMinRadiusY);
  const rx = (rxPx / pageWidth) * 1000;
  const ry = (ryPx / pageHeight) * 1000;
  const top = Math.max(0, cy - ry);
  const bottom = Math.min(1000, cy + ry);
  const rowHeight = (bottom - top) / BUBBLE_FIT.ellipseRows;
  const rows: ([number, number] | null)[] = [];
  for (let i = 0; i < BUBBLE_FIT.ellipseRows; i++) {
    const y = top + (i + 0.5) * rowHeight;
    const t = 1 - ((y - cy) / ry) ** 2;
    if (t <= 0) {
      rows.push(null);
      continue;
    }
    const half = rx * Math.sqrt(t);
    rows.push([Math.max(0, cx - half), Math.min(1000, cx + half)]);
  }
  return { top, rowHeight, rows, centerX: cx, centerY: cy };
}

/**
 * 말풍선 모양 안에 넣기: 가로(어절 유지) → 가로(좌우로 살짝 넘침) → 막대처럼 홀쭉하면 세로 → 가로(어절 자르기 허용) 순.
 * 세로쓰기는 한 어절도 가로 한 줄에 못 들어가는 좁은 말풍선에서만 (사용자가 가로쓰기를 더 선호)
 * 어느 쪽으로도 안 들어가면 null (호출하는 쪽이 네모 상자로 덮음)
 */
export function fitIntoShape(
  text: string,
  shape: BubbleShape,
  pageWidth: number,
  pageHeight: number,
  measure: Measure,
  minFont: number,
  maxFont: number,
): BubbleFit | null {
  const vertical = () => layoutBubbleVertical(text, shape, pageWidth, pageHeight, minFont, maxFont);
  // 가로 배치가 한 줄에 두세 글자씩 잘게 쪼개진 기둥이면(원문이 세로쓰기인 좁은 말풍선) 세로가 들어가는 한 세로가 더 읽기 좋음
  const horizontal = (layout: BubbleTextLayout): BubbleFit => {
    if (isChoppy(layout)) {
      const v = vertical();
      if (v) return { direction: 'vertical', layout: v };
    }
    return { direction: 'horizontal', layout };
  };
  const keepWords = layoutBubbleText(text, shape, pageWidth, pageHeight, measure, minFont, maxFont, false);
  if (keepWords) return horizontal(keepWords);
  const slight = layoutBubbleSlightOverflow(text, shape, pageWidth, pageHeight, measure, minFont, maxFont);
  if (slight) return horizontal(slight);
  if (isTallShape(shape, pageWidth, pageHeight)) {
    const v = vertical();
    if (v) return { direction: 'vertical', layout: v };
  }
  const breakWords = layoutBubbleText(text, shape, pageWidth, pageHeight, measure, minFont, maxFont, true);
  if (breakWords) return horizontal(breakWords);
  // 가로로는 어떻게도 넘치는데 세로로는 들어가면 넘치게 두는 것보다 세로가 나음
  if (!isTallShape(shape, pageWidth, pageHeight)) {
    const v = vertical();
    if (v) return { direction: 'vertical', layout: v };
  }
  return null;
}

/** 한 줄 평균 2.5글자 이하로 5줄 이상 — 가로로 쓰기엔 너무 잘게 쪼개진 배치 */
function isChoppy(layout: BubbleTextLayout): boolean {
  if (layout.lines.length < 5) return false;
  const chars = layout.lines.reduce((sum, line) => sum + Array.from(line.text.replace(/\s/g, '')).length, 0);
  return chars / layout.lines.length <= 2.5;
}

/**
 * 테두리를 못 딴 말풍선에서 원문 글자만 지울 흰 사각형 (그리는 좌표계 px).
 * 말풍선 모양을 모르니 원문 글자 영역보다 조금만 넓게 칠해 말풍선 테두리를 건드리지 않음
 */
function eraseFillForBox(box: [number, number, number, number], pageWidth: number, pageHeight: number, minFont: number): BubbleTextLayout['fill'] {
  const [ymin, xmin, ymax, xmax] = box;
  const pad = minFont * BUBBLE_FIT.erasePadEm;
  const top = (ymin / 1000) * pageHeight - pad;
  const bottom = (ymax / 1000) * pageHeight + pad;
  return { top, rowHeight: bottom - top, rows: [[(xmin / 1000) * pageWidth - pad, (xmax / 1000) * pageWidth + pad]] };
}

/** 덮는 말풍선 하나를 어떻게 그릴지 (화면·이미지 저장 공통) */
export type BubblePlan =
  | {
    kind: 'fit';
    fit: BubbleFit;
    /** bubble: 찾은 말풍선 안 / erase: 테두리를 다 못 따(글자가 테두리에 걸침) 찾은 말풍선 안쪽이나 글자 영역 둘레 타원에 배치 */
    source: 'bubble' | 'erase';
    /** 글자를 배치한 영역 ("짧게 다시 번역"의 글자 수 계산용) */
    area: BubbleShape;
    /** 이어진 말풍선(연리지)의 나머지 칸: 번역문을 나눠 칸마다 따로 넣음 */
    more?: { fit: BubbleFit; area: BubbleShape }[];
    /** 글자 영역 전체를 둥근 상자로 칠하는 배치 (흰색을 줄이지 않음) */
    panel?: boolean;
    /** 원문 글자 획만 지울 마스크 (있으면 먼저 그림). 획을 거의 다 골랐으면 흰색 칠하기(fill)는 비움 */
    mask?: GlyphMask;
  }
  /** 모양을 쓸 대상이 아님 (직접 옮긴 박스, 맞춤을 끈 박스, 모양 계산 전) → 네모 상자 */
  | { kind: 'box' };

/**
 * 페이지 안에서 번역문 글자 크기를 통일하는 규칙. 단행본처럼 기준 크기 하나로 쓰고, 원문 글자가 확실히 큰 대사(외침·강조)만 키움.
 * 원문이 작은 대사도 기준 크기 (작은 말풍선은 안 들어가면 그만큼만 줄어듦)
 */
export const UNIFORM_FONT = {
  /** 원문 글자 크기가 페이지 기준(가운데값)의 이 배율 이상일 때만 따라서 키움 — 재는 오차(±30%)로 들쭉날쭉하지 않게 넉넉히 */
  emphasisRatio: 1.5,
  /** 키울 때 상한 */
  maxRatio: 2.5,
  /** 원문 글자 한 자 크기 대비 번역문 글자 크기 (한글은 같은 크기면 비슷한 칸을 차지) */
  koreanScale: 1,
} as const;

/**
 * 페이지 글자 영역마다 번역문 글자 크기 목표 (그리는 좌표계 px). 원문 크기를 못 잰 항목은 기준 크기, 아무것도 못 재면 빈 맵.
 * 목표는 "최대" 크기 — 말풍선에 안 들어가면 그만큼만 줄어듦
 */
export function uniformFontTargets(
  items: { id: string; glyph?: number; edited?: boolean }[],
  pageHeight: number,
  minFont: number,
  maxFont: number,
  /** 칸 id(번역 결과 id)별로 정한 기준을 기억 — 빈 칸 하나를 옮기거나 지워도 나머지 말풍선 글자 크기가 바뀌지 않게 */
  remember = false,
): Map<string, number> {
  const targets = new Map<string, number>();
  // 직접 고친 영역은 원문 크기를 새 자리에서 다시 잰 값이라(그림·빈칸) 기준에도 강조에도 쓰지 않음
  const measured = (list: typeof items) => list.map(i => i.glyph).filter((g): g is number => !!g && g > 0).sort((a, b) => a - b);
  const glyphs = measured(items.filter(i => !i.edited));
  const fallback = measured(items);
  const remembered = remember ? items.map(i => REMEMBERED_BASE.get(i.id)).filter((b): b is number => b !== undefined).sort((a, b) => a - b) : [];
  const pool = glyphs.length > 0 ? glyphs : fallback;
  if (remembered.length === 0 && pool.length === 0) return targets;
  const base = remembered.length > 0 ? remembered[Math.floor(remembered.length / 2)] : pool[Math.floor(pool.length / 2)];
  if (remember) for (const item of items) REMEMBERED_BASE.set(item.id, base);
  const toPx = (glyph: number) => Math.min(maxFont, Math.max(minFont, (glyph / 1000) * pageHeight * UNIFORM_FONT.koreanScale));
  for (const item of items) {
    const ratio = item.glyph && !item.edited ? item.glyph / base : 1;
    const scale = ratio >= UNIFORM_FONT.emphasisRatio ? Math.min(UNIFORM_FONT.maxRatio, ratio) : 1;
    targets.set(item.id, toPx(base * scale));
  }
  return targets;
}

/** 번역 결과 id → 그 페이지 기준 글자 크기(원문 글자 크기, 페이지 높이 1000 기준). 다시 번역하면 id가 새로 생겨 새로 정함 */
const REMEMBERED_BASE = new Map<string, number>();

/** 말풍선에 안 들어갈 때 줄여도 되는 가장 작은 글자: 목표 크기의 이 배율 (그보다 작아져야 하면 넘침 — 칸마다 글자 크기가 들쭉날쭉했음) */
export const FONT_FLOOR_RATIO = 0.8;

/** 목표 크기에서 줄일 수 있는 하한 (절대 하한 minFont 이상) */
export const fontFloor = (minFont: number, target: number) => Math.max(minFont, target * FONT_FLOOR_RATIO);

/** 번역문을 나눌 수 있는 자리: 문장부호(. ! ? … ~ 。) 뒤, 줄바꿈 */
const SENTENCE_END = /[.!?…~。！？]+["'」』)\]]*\s*|\n+/g;
/** 칸별 원문 비율과 나눈 번역문 비율이 이만큼 넘게 다르면 억지로 나누지 않음 */
const SPLIT_MAX_DRIFT = 0.25;

/**
 * 이어진 말풍선 두 칸에 하나로 번역된 글을 문장 끝에서 나눕니다. 원문 글자가 칸에 나뉜 비율(shares)에 가장 가까운 자리.
 * 문장이 하나뿐이거나 비율이 크게 어긋나면 null (나누지 않고 전체 모양에 넣음). 두 칸까지만
 */
export function splitTranslation(text: string, shares: number[]): string[] | null {
  if (shares.length !== 2) return null;
  const trimmed = text.trim();
  const weight = (t: string) => t.replace(/\s+/g, '').length;
  const total = weight(trimmed);
  if (total === 0) return null;
  let best: { at: number; drift: number } | null = null;
  for (const match of trimmed.matchAll(SENTENCE_END)) {
    const at = match.index! + match[0].length;
    if (at >= trimmed.length) continue;
    const drift = Math.abs(weight(trimmed.slice(0, at)) / total - shares[0]);
    if (!best || drift < best.drift) best = { at, drift };
  }
  if (!best || best.drift > SPLIT_MAX_DRIFT) return null;
  const parts = [trimmed.slice(0, best.at).trim(), trimmed.slice(best.at).trim()];
  return parts.every(Boolean) ? parts : null;
}

/** 모양 안에 넣기 → 안 되면 최소 글자로 넘치게 */
function fitOrOverflow(text: string, shape: BubbleShape, pageWidth: number, pageHeight: number, measure: Measure, minFont: number, maxFont: number): BubbleFit | null {
  const fit = fitIntoShape(text, shape, pageWidth, pageHeight, measure, minFont, maxFont);
  if (fit) return fit;
  const overflow = layoutBubbleOverflow(text, shape, pageWidth, pageHeight, measure, minFont);
  return overflow ? { direction: 'horizontal', layout: overflow } : null;
}

/**
 * - 말풍선 모양을 찾았으면 그 안에 (흰색은 말풍선 안쪽만 — 넘치면 글자만 넘치고 "넘침" 표시)
 * - 말풍선은 있어 보이는데(배경이 흰색) 테두리를 못 땄으면 원문 글자만 지우고 그 둘레 타원에 배치
 * - 그 밖(직접 옮긴 박스, 맞춤을 끈 박스, 모양 계산 전)은 네모 상자
 * 말풍선이 아예 없는 글자(그림·스크린톤 위)는 여기 오기 전에 "옆에 작게 붙이기"로 빠짐 (bubbleDisplay.effectiveDisplayMode)
 */
export function planBubble(
  result: Pick<TranslationResult, 'box_2d' | 'translated_text' | 'original_text' | 'display_mode' | 'is_edited_box' | 'text_direction' | 'fit_bubble' | 'corner_radius'>,
  detection: BubbleDetection | undefined,
  pageWidth: number,
  pageHeight: number,
  measure: Measure,
  minFont: number,
  maxFont: number,
  /** 안 들어갈 때 줄일 수 있는 하한 (없으면 minFont). 페이지 기준 크기의 80% — 칸마다 글자 크기가 들쭉날쭉하지 않게 */
  floorFont: number = minFont,
): BubblePlan {
  const plan = planBubbleUntrimmed(result, detection, pageWidth, pageHeight, measure, minFont, maxFont, Math.min(maxFont, Math.max(minFont, floorFont)));
  if (plan.kind !== 'fit') return plan;
  // 말풍선 없는 글자의 둥근 상자는 상자 전체를 칠함 (원문이 그림·톤 위라 일부만 지우면 얼룩져 보임)
  if (detection && !detection.shape && NO_BUBBLE_FAILURES.has(detection.failure)) return plan;
  if (plan.panel) return plan;
  const found = detection?.shape ?? (detection && !detection.shape ? detection.interior : undefined);
  if (found && boxCoverage(found, result.box_2d) < BUBBLE_FIT.minBoxCoverage) return plan;
  // 원문 글자 획을 거의 다 골라냈으면 그 획만 지우고(마스크) 말풍선은 칠하지 않음 — 테두리·안으로 들어온 그림이 그대로 남음.
  // 글자가 테두리·그림에 붙어 못 고른 획이 많으면 예전처럼 원문 영역+번역문 줄 둘레를 함께 칠함
  const mask = detection?.glyphMask;
  if (mask && mask.coverage >= BUBBLE_FIT.maskMinCoverage) {
    return { ...plan, mask, fit: withFill(plan.fit, EMPTY_FILL), ...(plan.more ? { more: plan.more.map(m => ({ ...m, fit: withFill(m.fit, EMPTY_FILL) })) } : {}) };
  }
  const keep = keepRects(result.box_2d, pageWidth, pageHeight, minFont);
  return {
    ...plan,
    ...(mask ? { mask } : {}),
    fit: trimFill(plan.fit, keep, measure),
    ...(plan.more ? { more: plan.more.map(m => ({ ...m, fit: trimFill(m.fit, keep, measure) })) } : {}),
  };
}

const EMPTY_FILL: BubbleTextLayout['fill'] = { top: 0, rowHeight: 1, rows: [] };

function withFill(fit: BubbleFit, fill: BubbleTextLayout['fill']): BubbleFit {
  return fit.direction === 'horizontal' ? { ...fit, layout: { ...fit.layout, fill } } : { ...fit, layout: { ...fit.layout, fill } };
}

/**
 * 흰색을 칠할 범위 줄이기: 말풍선 안쪽 전체 대신 "원문 글자 영역 + 번역문 줄"만 (둘 다 여유를 두고, 말풍선 안쪽을 넘지 않게).
 * 말풍선 안의 빈 곳은 원래 흰 종이라 칠하지 않아도 똑같이 보이고, 말풍선 안으로 들어온 그림(인물 머리 등)은 가리지 않음.
 * 말풍선 테두리 안에 그림이 둘러싸여 있으면 예전엔 그림까지 칠해 지웠음
 */
type Rect = [number, number, number, number]; // x0, y0, x1, y1

function keepRects(box: [number, number, number, number], pageWidth: number, pageHeight: number, minFont: number): Rect[] {
  const [ymin, xmin, ymax, xmax] = box;
  const pad = minFont * BUBBLE_FIT.keepOriginalPadEm;
  return [[(xmin / 1000) * pageWidth - pad, (ymin / 1000) * pageHeight - pad, (xmax / 1000) * pageWidth + pad, (ymax / 1000) * pageHeight + pad]];
}

function textRects(fit: BubbleFit, measure: Measure): Rect[] {
  const layout = fit.layout;
  const pad = layout.fontSize * BUBBLE_FIT.keepTextPadEm;
  if (fit.direction === 'horizontal') {
    return fit.layout.lines.map(line => {
      const half = measure(line.text, fit.layout.fontSize) / 2;
      return [line.cx - half - pad, line.top - pad, line.cx + half + pad, line.top + fit.layout.lineHeight + pad] as Rect;
    });
  }
  const { columnWidth, cellHeight } = fit.layout;
  return fit.layout.columns.map(column => [
    column.cx - columnWidth / 2 - pad, column.top - pad, column.cx + columnWidth / 2 + pad, column.top + columnUnits(column.cells) * cellHeight + pad,
  ] as Rect);
}

function trimFill(fit: BubbleFit, keep: Rect[], measure: Measure): BubbleFit {
  const rects = [...keep, ...textRects(fit, measure)];
  const { top, rowHeight, rows } = fit.layout.fill;
  const trimmed = rows.map((row, i): [number, number] | null => {
    if (!row) return null;
    const y0 = top + i * rowHeight;
    const y1 = y0 + rowHeight;
    let left = Infinity;
    let right = -Infinity;
    for (const [rx0, ry0, rx1, ry1] of rects) {
      if (ry1 <= y0 || ry0 >= y1) continue;
      left = Math.min(left, rx0);
      right = Math.max(right, rx1);
    }
    const l = Math.max(row[0], left);
    const r = Math.min(row[1], right);
    return r > l ? [l, r] : null;
  });
  return withFill(fit, { top, rowHeight, rows: trimmed });
}

/** 원문 자리(표시용 박스)를 둥근 흰 상자 모양으로 — 모서리는 말풍선마다 고른 둥글기(없으면 기본) */
function panelOf(result: Pick<TranslationResult, 'box_2d' | 'is_edited_box' | 'corner_radius'>, pageWidth: number, pageHeight: number, minFont: number): BubbleShape {
  const box = getDisplayBox(result);
  const widthPx = ((box[3] - box[1]) / 1000) * pageWidth;
  const heightPx = ((box[2] - box[0]) / 1000) * pageHeight;
  return roundedBoxShape(box, pageWidth, pageHeight, cornerRadiusPx(result, widthPx, heightPx, OVERLAY_STYLE.radiusPx * (minFont / BUBBLE_FIT.minFontPx)));
}

function planBubbleUntrimmed(
  result: Pick<TranslationResult, 'box_2d' | 'translated_text' | 'original_text' | 'display_mode' | 'is_edited_box' | 'text_direction' | 'fit_bubble' | 'corner_radius'>,
  detection: BubbleDetection | undefined,
  pageWidth: number,
  pageHeight: number,
  measure: Measure,
  minFont: number,
  maxFont: number,
  floorFont: number,
): BubblePlan {
  if (!detection || !wantsBubbleFit(result)) return { kind: 'box' };
  const text = result.translated_text ?? '';
  // 찾은 모양이 원문 글자 영역을 60%도 못 품으면 엉뚱한 흰 영역(옷·배경)을 잡은 것 → 글자 영역을 둥근 상자로 (이름표 등)
  if (detection.shape && boxCoverage(detection.shape, result.box_2d) < BUBBLE_FIT.minBoxCoverage) {
    const panel = panelOf(result, pageWidth, pageHeight, minFont);
    const fit = fitOrOverflow(text, panel, pageWidth, pageHeight, measure, floorFont, maxFont);
    return fit ? { kind: 'fit', fit, source: 'erase', area: panel } : { kind: 'box' };
  }
  if (detection.shape) {
    // 이어진 말풍선 두 칸에 걸친 글자 영역(예전에 하나로 번역된 것): 번역문을 문장 끝에서 나눠 칸마다
    const lobes = detection.lobes;
    const parts = lobes ? splitTranslation(text, lobes.map(l => l.inkShare)) : null;
    if (lobes && parts) {
      const fits = parts.map((part, k) => fitOrOverflow(part, lobes[k].shape, pageWidth, pageHeight, measure, floorFont, maxFont));
      if (fits.every(f => f)) {
        return {
          kind: 'fit',
          fit: fits[0]!,
          source: 'bubble',
          area: lobes[0].shape,
          more: fits.slice(1).map((fit, k) => ({ fit: fit!, area: lobes[k + 1].shape })),
        };
      }
    }
    // 말풍선이 원문 글자 영역보다 훨씬 크면(큰 말풍선에 짧은 글, 컷 테두리 안 흰 바탕 전체가 잡힌 경우)
    // 무게중심이 원문 자리에서 멀어 번역문이 엉뚱한 곳(그림 가운데)으로 감 → 원문 자리 둘레로 잘라 그 안에
    // 찾은 모양의 무게중심이 원문 자리에서 크게 벗어나면 말풍선이 아니라 옆의 흰 컷 바탕까지 번져 잡힌 것
    // (「……」 말풍선이 흰 바탕 컷과 맞닿음 — 번역문이 말풍선 밖 그림 위로 갔음) → 원문 자리의 둥근 상자에 들어가면 그쪽
    if (strayedFrom(detection.shape, result.box_2d)) {
      const panel = panelOf(result, pageWidth, pageHeight, minFont);
      const panelFit = fitOrOverflow(text, panel, pageWidth, pageHeight, measure, floorFont, maxFont);
      if (panelFit && !panelFit.layout.overflow) return { kind: 'fit', fit: panelFit, source: 'erase', area: panel, panel: true };
    }
    const local = localizeShape(detection.shape, getDisplayBox(result));
    const fit = fitOrOverflow(text, local, pageWidth, pageHeight, measure, floorFont, maxFont);
    // 넘치는데 표시용 박스가 찾은 모양 안에 거의 다 들면(잡힌 모양이 무늬 있는 옷·그림까지 번져 안쪽이 잘게 끊김 — 이름표 등)
    // 박스를 칠해도 말풍선 밖으로 안 나가므로 글자 영역의 둥근 상자로
    if ((!fit || fit.layout.overflow) && local !== detection.shape) {
      const panel = panelOf(result, pageWidth, pageHeight, minFont);
      const panelFit = fitOrOverflow(text, panel, pageWidth, pageHeight, measure, floorFont, maxFont);
      if (panelFit && !panelFit.layout.overflow) return { kind: 'fit', fit: panelFit, source: 'erase', area: panel, panel: true };
    }
    return fit ? { kind: 'fit', fit, source: 'bubble', area: local } : { kind: 'box' };
  }
  // 말풍선이 없는 글자(그림·톤 위, 테두리 없는 해설): 표시용 박스를 둥근 흰 상자로 보고 말풍선과 같은 규칙으로 배치
  // (예전 네모 상자 배치는 높이를 안 쓰고 폭에만 맞춰, 세로로 긴 상자에서 긴 어절이 옆으로 삐져나왔음)
  if (NO_BUBBLE_FAILURES.has(detection.failure)) {
    const panel = panelOf(result, pageWidth, pageHeight, minFont);
    const fit = fitOrOverflow(text, panel, pageWidth, pageHeight, measure, floorFont, maxFont);
    return fit ? { kind: 'fit', fit, source: 'erase', area: panel } : { kind: 'box' };
  }
  // 글자 획 일부가 말풍선 밖에 걸쳐 모양을 확정 못 했어도, 찾은 말풍선 안쪽이 있으면 그 안에 놓고 그 안을 칠함
  // (글자 영역 둘레 타원은 글자 영역이 한쪽에 치우치면 말풍선 밖으로 삐져나왔음). 밖에 걸친 원문 획만 남을 수 있음
  const area = ellipseShapeForBox(result.box_2d, pageWidth, pageHeight, minFont);
  const fit = fitOrOverflow(text, area, pageWidth, pageHeight, measure, floorFont, maxFont);
  if (detection.interior && boxCoverage(detection.interior, result.box_2d) < BUBBLE_FIT.minBoxCoverage) {
    // 안쪽도 원문 자리를 못 품으면 엉뚱한 흰 영역 → 글자 영역의 둥근 상자로
    const panel = panelOf(result, pageWidth, pageHeight, minFont);
    const fit = fitOrOverflow(text, panel, pageWidth, pageHeight, measure, floorFont, maxFont);
    return fit ? { kind: 'fit', fit, source: 'erase', area: panel } : { kind: 'box' };
  }
  if (detection.interior) {
    const inner = fitOrOverflow(text, detection.interior, pageWidth, pageHeight, measure, floorFont, maxFont);
    // 안쪽에서 넘치는데 글자 영역 둘레에는 들어가면 그쪽 (안쪽이 이름표 같은 작은 칸이 아니라 주변 배경으로 잡힌 경우 등)
    if (inner && !(inner.layout.overflow && fit && !fit.layout.overflow)) {
      return { kind: 'fit', fit: inner, source: 'erase', area: detection.interior };
    }
  }
  if (!fit) return { kind: 'box' };
  // 말풍선 안쪽(흰 종이+그 안의 글자)을 글자 영역 범위로 잘라 칠함 — 글자 영역이 그림 쪽으로 삐져나와도 그림은 안 칠함.
  // 그것도 없으면(배경이 너무 작게 잡힘 등) 글자 영역 네모
  const fill = detection.erase ? fillOf(toPx(detection.erase, pageWidth, pageHeight)) : eraseFillForBox(result.box_2d, pageWidth, pageHeight, minFont);
  return {
    kind: 'fit',
    fit: fit.direction === 'horizontal' ? { ...fit, layout: { ...fit.layout, fill } } : { ...fit, layout: { ...fit.layout, fill } },
    source: 'erase',
    area,
  };
}
