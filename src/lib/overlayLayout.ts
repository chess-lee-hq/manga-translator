import type { TranslationResult } from './gemini';

/**
 * 덮어쓰기 말풍선 규칙. 화면(MangaViewer)과 이미지 저장(exportCanvas)이 같은 값을 씁니다.
 * 값은 모두 "화면 CSS px" 기준입니다.
 */
export const OVERLAY_STYLE = {
  /** 글자 크기 하한·상한 (뷰어 배율에 비례) */
  minFontPx: 10,
  maxFontPx: 28,
  fontWeight: 800,
  lineHeight: 1.15,
  letterSpacingEm: -0.02,
  /** 흰 상자 안쪽 여백·모서리·그림자 (뷰어 배율과 무관) */
  paddingXPx: 8,
  paddingYPx: 4,
  radiusPx: 16,
  shadowOffsetYPx: 2,
  shadowBlurPx: 10,
  /** 끊을 수 없는 긴 단어가 있을 때 흰 상자가 박스 너비의 몇 배까지 넓어질 수 있는지 */
  maxWidthRatio: 2,
} as const;

/** 뷰어의 페이지 이미지 높이 = (화면 높이 - VIEWER_CHROME_PX) × 배율 */
export const VIEWER_CHROME_PX = 250;

export type Box = [number, number, number, number];

/** 화면 오버레이와 같은 규칙의 표시용 박스 (직접 편집하지 않은 박스는 가로 1.3배, 세로 1.1배 확장) */
export function getDisplayBox(result: Pick<TranslationResult, 'box_2d' | 'is_edited_box'>): Box {
  const [ymin, xmin, ymax, xmax] = result.box_2d;
  if (result.is_edited_box) return [ymin, xmin, ymax, xmax];
  const width = (xmax - xmin) * 1.3;
  const height = (ymax - ymin) * 1.1;
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  return [cy - height / 2, cx - width / 2, cy + height / 2, cx + width / 2];
}

/**
 * 박스 비율과 글자 수로 한 줄 글자 수·줄 수를 추정한 글자 크기 상한.
 * maxCqi는 박스 너비의 %, maxCqh는 박스 높이의 % (화면에서는 CSS cqi/cqh 단위로 그대로 사용)
 */
export function estimateFontRatios(result: Pick<TranslationResult, 'translated_text'>, displayBox: Box) {
  const [ymin, xmin, ymax, xmax] = displayBox;
  const aspect = (xmax - xmin) / (ymax - ymin);
  const textLen = Math.max(1, result.translated_text.length);
  const charsPerLine = Math.max(1, Math.sqrt(textLen * aspect));
  const lines = Math.max(1, textLen / charsPerLine);
  return {
    maxCqi: (100 / charsPerLine) * 0.85,
    maxCqh: (100 / (lines * 1.15)) * 0.9,
  };
}

/** CSS `clamp(min, min(maxCqi cqi, maxCqh cqh), max)`와 같은 계산 */
export function overlayFontSize(
  ratios: { maxCqi: number; maxCqh: number },
  boxWidth: number,
  boxHeight: number,
  minFont: number,
  maxFont: number,
): number {
  const preferred = Math.min((ratios.maxCqi * boxWidth) / 100, (ratios.maxCqh * boxHeight) / 100);
  return Math.max(minFont, Math.min(preferred, maxFont));
}

type Measure = (text: string) => number;

/**
 * 캔버스용 줄바꿈.
 * keepAll이면 CSS `word-break: keep-all`처럼 공백 단위로 끊고, 한 단어가 너무 길 때만 글자 단위로 자릅니다.
 */
export function wrapText(text: string, maxWidth: number, measure: Measure, keepAll: boolean): string[] {
  const limit = maxWidth + 0.01; // 부동소수점 오차로 딱 맞는 줄이 넘어가지 않게
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    const pushChars = (chunk: string) => {
      for (const ch of Array.from(chunk)) {
        if (line && measure(line + ch) > limit) {
          lines.push(line.trimEnd());
          line = ch.trim() ? ch : '';
        } else {
          line += ch;
        }
      }
    };

    if (!keepAll) {
      pushChars(paragraph);
    } else {
      for (const token of paragraph.split(/(\s+)/).filter(Boolean)) {
        if (measure(line + token) <= limit) {
          line += token;
        } else if (!token.trim()) {
          if (line) lines.push(line.trimEnd());
          line = '';
        } else {
          if (line.trim()) lines.push(line.trimEnd());
          line = '';
          if (measure(token) <= limit) line = token;
          else pushChars(token);
        }
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export interface OverlayLayout {
  lines: string[];
  /** 흰 상자 크기 (여백 포함) */
  width: number;
  height: number;
}

/**
 * 화면 덮어쓰기의 CSS 배치를 그대로 재현합니다.
 * - 흰 상자 너비: 기본은 박스 너비. 끊을 수 없는 한 단어가 더 길면 그만큼 넓어짐(최대 박스의 2배)
 * - 그 너비 안에서 줄바꿈하고, 글이 박스보다 길면 높이가 늘어남 (박스 중앙 기준)
 * cssPx: 화면 CSS 1px이 그리는 좌표계에서 몇 px인지 (여백 환산용)
 */
export function layoutOverlayText(
  text: string,
  boxWidth: number,
  boxHeight: number,
  fontSize: number,
  keepAll: boolean,
  measure: Measure,
  cssPx: number,
): OverlayLayout {
  const padX = OVERLAY_STYLE.paddingXPx * cssPx;
  const padY = OVERLAY_STYLE.paddingYPx * cssPx;

  const maxContent = Math.max(0, ...text.split('\n').map(measure)) + padX * 2;
  const unbreakable = keepAll ? text.split(/\s+/) : Array.from(text.replace(/\s/g, ''));
  const minContent = Math.max(0, ...unbreakable.map(measure)) + padX * 2;

  // CSS: width = fit-content, min-width 100%, max-width 200% (box-sizing: border-box)
  const fitContent = Math.min(maxContent, Math.max(minContent, boxWidth));
  const width = Math.min(Math.max(fitContent, boxWidth), boxWidth * OVERLAY_STYLE.maxWidthRatio);

  const lines = wrapText(text, Math.max(0, width - padX * 2), measure, keepAll);
  const height = Math.max(boxHeight, lines.length * fontSize * OVERLAY_STYLE.lineHeight + padY * 2);
  return { lines, width, height };
}

/** 세로쓰기 규칙. 화면과 이미지 저장이 같은 값을 씁니다. */
export const VERTICAL_TEXT = {
  /** 글자 한 칸의 높이 = 글자 크기 × 이 값 */
  cellHeight: 1.05,
  /** 한 열의 너비 = 글자 크기 × 이 값 */
  columnWidth: 1.1,
  /** 가로로 썼을 때 한 줄에 이 글자 수도 못 들어가면 세로쓰기 (흰 영역을 넘치는 경우) */
  minCharsPerLine: 3,
  /** 한 글자뿐이면 세로·가로가 같으므로 가로로 둠 */
  minChars: 2,
} as const;

/**
 * 글자 방향 결정. 사용자가 직접 고른 값이 있으면 그것을 씁니다.
 * 자동 판별은 "세로로 길고 좁아서 가로로는 한 줄에 몇 글자도 못 들어가는 박스"만 세로쓰기로 봅니다.
 * (말풍선 없이 세로 한 줄로 쓰인 원문 자리)
 */
export function resolveTextDirection(
  result: Pick<TranslationResult, 'translated_text' | 'text_direction'>,
  boxWidth: number,
  boxHeight: number,
  minFontSize: number,
  cssPx: number,
): 'horizontal' | 'vertical' {
  if (result.text_direction === 'horizontal' || result.text_direction === 'vertical') return result.text_direction;
  const chars = Array.from((result.translated_text ?? '').trim()).length;
  if (chars < VERTICAL_TEXT.minChars) return 'horizontal';
  if (boxWidth >= boxHeight || minFontSize <= 0) return 'horizontal';
  const usableWidth = boxWidth - OVERLAY_STYLE.paddingXPx * cssPx * 2;
  return usableWidth / minFontSize < VERTICAL_TEXT.minCharsPerLine ? 'vertical' : 'horizontal';
}

export interface VerticalLayout {
  fontSize: number;
  /** 글자를 담은 열 목록. 첫 열이 가장 오른쪽 (일본 만화 세로쓰기 방향) */
  columns: string[][];
  /** 흰 상자 크기 (여백 포함, 최소한 원래 박스 크기) */
  width: number;
  height: number;
}

/**
 * 세로쓰기 배치. 박스 높이에 맞춰 한 열에 들어갈 글자 수를 정하고, 넘치면 왼쪽으로 열을 늘립니다.
 * 박스 안에 들어가는 가장 큰 글자 크기를 고르고, 최소 크기로도 넘치면 흰 상자를 키웁니다.
 */
export function layoutVerticalText(
  text: string,
  boxWidth: number,
  boxHeight: number,
  minFontSize: number,
  maxFontSize: number,
  cssPx: number,
): VerticalLayout {
  const padX = OVERLAY_STYLE.paddingXPx * cssPx;
  const padY = OVERLAY_STYLE.paddingYPx * cssPx;
  const step = Math.max(0.5, (maxFontSize - minFontSize) / 20);

  const build = (fontSize: number) => {
    const cellHeight = fontSize * VERTICAL_TEXT.cellHeight;
    const columnWidth = fontSize * VERTICAL_TEXT.columnWidth;
    const maxRows = Math.max(1, Math.floor((boxHeight - padY * 2) / cellHeight));

    const columns: string[][] = [];
    for (const paragraph of text.split('\n')) {
      let column: string[] = [];
      for (const char of Array.from(paragraph)) {
        if (column.length >= maxRows) {
          columns.push(column);
          column = [];
        }
        column.push(char);
      }
      columns.push(column);
    }

    const rows = Math.max(1, ...columns.map(column => column.length));
    return {
      fontSize,
      columns,
      contentWidth: columns.length * columnWidth + padX * 2,
      contentHeight: rows * cellHeight + padY * 2,
    };
  };

  const toLayout = (built: ReturnType<typeof build>): VerticalLayout => ({
    fontSize: built.fontSize,
    columns: built.columns,
    width: Math.max(built.contentWidth, boxWidth),
    height: Math.max(built.contentHeight, boxHeight),
  });

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= step) {
    const built = build(fontSize);
    if (built.contentWidth <= boxWidth && built.contentHeight <= boxHeight) return toLayout(built);
  }
  return toLayout(build(minFontSize));
}

/**
 * 덮어쓰기 글꼴(굵기·자간 포함)로 글자 폭을 재는 도구. ctx를 주면 그 캔버스의 글꼴 설정을 바꿔가며 씁니다.
 */
export function createTextMeasurer(fontFamily: string, ctx?: CanvasRenderingContext2D | null) {
  const context = ctx ?? document.createElement('canvas').getContext('2d');
  const setFont = (fontSize: number) => {
    if (!context) return;
    context.font = `${OVERLAY_STYLE.fontWeight} ${fontSize}px ${fontFamily}`;
    context.letterSpacing = `${OVERLAY_STYLE.letterSpacingEm * fontSize}px`;
  };
  const measure = (text: string, fontSize: number) => {
    if (!context) return Array.from(text).length * fontSize;
    setFont(fontSize);
    return context.measureText(text).width;
  };
  return { measure, setFont };
}
