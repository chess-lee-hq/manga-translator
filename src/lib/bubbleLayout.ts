import { NO_BUBBLE_FAILURES, type BubbleDetection, type BubbleShape } from './bubbleShape';
import { wantsBubbleFit } from './bubbleDisplay';
import type { TranslationResult } from './gemini';
import { columnUnits, fillColumns, OVERLAY_STYLE, VERTICAL_TEXT, verticalCells, type VerticalCell } from './overlayLayout';

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
  /** 말풍선 맞춤에서 허용하는 가장 작은 글자 (배율 100% 화면 px). 이보다 작아져야 하면 맞춤을 포기 */
  minFontPx: 12,
  /** 줄 간격 (기본 → 조인 값) */
  lineHeights: [OVERLAY_STYLE.lineHeight, 1.02],
  /** 말풍선 테두리와 글자 사이 여백 (글자 크기 대비) */
  insetXEm: 0.3,
  insetYEm: 0.25,
  /** 글자 크기를 몇 단계로 나눠 시도할지 */
  fontSteps: 24,
  /** 가로로 안 들어갈 때 세로쓰기를 시도할 만큼 홀쭉한 말풍선 (높이 ÷ 너비) */
  verticalMinAspect: 1.15,
  /** 모양을 못 딴 말풍선에 쓰는 타원: 글자 영역 네 모서리를 지나는 타원(√2배)에 약간 여유 */
  ellipseScale: 1.5,
  /** 타원 모양의 행 수 */
  ellipseRows: 64,
  /** 타원의 최소 반지름 (최소 글자 크기 배수). 원문이 한 줄짜리 세로 글이면 타원이 너무 홀쭉해 아무것도 안 들어가므로 */
  ellipseMinRadiusX: 2.5,
  ellipseMinRadiusY: 1.5,
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

  // 어절을 중간에서 자르지 않는 배치를 먼저 찾아보고, 안 될 때만 글자 단위로 자름
  for (const allowBreakWord of allowBreakWords ? [false, true] : [false]) {
    const fit = attempt(base, allowBreakWord);
    if (fit) return { ...fit, fill: fillOf(base), overflow: false };
  }
  return null;
}

const fillOf = (shape: PxShape): BubbleTextLayout['fill'] => ({ top: shape.top, rowHeight: shape.rowHeight, rows: shape.rows });

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

function tryFitVertical(paragraphs: VerticalCell[][], shape: PxShape, fontSize: number): Omit<BubbleVerticalLayout, 'fill' | 'overflow'> | null {
  const cellHeight = fontSize * VERTICAL_TEXT.cellHeight;
  const columnWidth = fontSize * VERTICAL_TEXT.columnWidth;
  const insetX = fontSize * BUBBLE_FIT.insetXEm;
  const insetY = fontSize * BUBBLE_FIT.insetYEm;
  const totalUnits = paragraphs.reduce((sum, cells) => sum + columnUnits(cells), 0);
  const { width } = shapeExtent(shape);
  const maxColumns = Math.max(1, Math.floor((width - insetX * 2) / columnWidth));

  for (let count = 1; count <= maxColumns; count++) {
    const rightEdge = shape.centerX + (count * columnWidth) / 2;
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
    if (runs.length < count) continue;
    const capacities = runs.map(([top, bottom]) => (bottom - top) / cellHeight);
    if (capacities.reduce((a, b) => a + b, 0) < totalUnits) continue;

    const filled = fillColumns(paragraphs, j => capacities[j] ?? 0);
    if (filled.length > count || filled.some((column, j) => columnUnits(column) > capacities[j] + 1e-6)) continue;

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
  return null;
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
  return null;
}

/** 모양이 홀쭉한지 (가로로 안 들어갈 때 세로쓰기를 시도할 대상) */
export function isTallShape(shape: BubbleShape, pageWidth: number, pageHeight: number): boolean {
  const { width, height } = shapeExtent(toPx(shape, pageWidth, pageHeight));
  return width > 0 && height / width >= BUBBLE_FIT.verticalMinAspect;
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
 * 말풍선 모양 안에 넣기: 가로(어절 유지) → 홀쭉하면 세로 → 가로(어절 자르기 허용) 순.
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
  const keepWords = layoutBubbleText(text, shape, pageWidth, pageHeight, measure, minFont, maxFont, false);
  if (keepWords) return { direction: 'horizontal', layout: keepWords };
  if (isTallShape(shape, pageWidth, pageHeight)) {
    const vertical = layoutBubbleVertical(text, shape, pageWidth, pageHeight, minFont, maxFont);
    if (vertical) return { direction: 'vertical', layout: vertical };
  }
  const breakWords = layoutBubbleText(text, shape, pageWidth, pageHeight, measure, minFont, maxFont, true);
  return breakWords ? { direction: 'horizontal', layout: breakWords } : null;
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
    /** bubble: 찾은 말풍선 안 / erase: 테두리를 못 따 원문 글자만 지우고 그 둘레(타원)에 배치 */
    source: 'bubble' | 'erase';
    /** 글자를 배치한 영역 ("짧게 다시 번역"의 글자 수 계산용) */
    area: BubbleShape;
    /** 이어진 말풍선(연리지)의 나머지 칸: 번역문을 나눠 칸마다 따로 넣음 */
    more?: { fit: BubbleFit; area: BubbleShape }[];
  }
  /** 모양을 쓸 대상이 아님 (직접 옮긴 박스, 맞춤을 끈 박스, 모양 계산 전) → 네모 상자 */
  | { kind: 'box' };

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
  result: Pick<TranslationResult, 'box_2d' | 'translated_text' | 'original_text' | 'display_mode' | 'is_edited_box' | 'text_direction' | 'fit_bubble'>,
  detection: BubbleDetection | undefined,
  pageWidth: number,
  pageHeight: number,
  measure: Measure,
  minFont: number,
  maxFont: number,
): BubblePlan {
  if (!detection || !wantsBubbleFit(result)) return { kind: 'box' };
  const text = result.translated_text ?? '';
  if (detection.shape) {
    // 이어진 말풍선 두 칸에 걸친 글자 영역(예전에 하나로 번역된 것): 번역문을 문장 끝에서 나눠 칸마다
    const lobes = detection.lobes;
    const parts = lobes ? splitTranslation(text, lobes.map(l => l.inkShare)) : null;
    if (lobes && parts) {
      const fits = parts.map((part, k) => fitOrOverflow(part, lobes[k].shape, pageWidth, pageHeight, measure, minFont, maxFont));
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
    const fit = fitOrOverflow(text, detection.shape, pageWidth, pageHeight, measure, minFont, maxFont);
    return fit ? { kind: 'fit', fit, source: 'bubble', area: detection.shape } : { kind: 'box' };
  }
  if (NO_BUBBLE_FAILURES.has(detection.failure)) return { kind: 'box' };
  const area = ellipseShapeForBox(result.box_2d, pageWidth, pageHeight, minFont);
  const fit = fitOrOverflow(text, area, pageWidth, pageHeight, measure, minFont, maxFont);
  if (!fit) return { kind: 'box' };
  const fill = eraseFillForBox(result.box_2d, pageWidth, pageHeight, minFont);
  return {
    kind: 'fit',
    fit: fit.direction === 'horizontal' ? { ...fit, layout: { ...fit.layout, fill } } : { ...fit, layout: { ...fit.layout, fill } },
    source: 'erase',
    area,
  };
}
