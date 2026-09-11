import type { TranslationResult } from './gemini';
import { loadImage } from './imageUtils';

/**
 * 덮어쓰기 말풍선 규칙. 화면(MangaViewer)과 이미지 저장(renderTranslatedPage)이 같은 값을 씁니다.
 * 값은 모두 "화면 CSS px" 기준입니다.
 */
export const OVERLAY_STYLE = {
  /** 글자 크기 하한·상한 (뷰어 배율에 비례) */
  minFontPx: 13,
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

/** 저장 이미지 목표 높이. 원본이 이보다 작으면 최대 MAX_EXPORT_SCALE배까지 키워 글자를 선명하게 그림 */
const EXPORT_TARGET_HEIGHT = 2400;
const MAX_EXPORT_SCALE = 3;
/** 브라우저 캔버스 한계를 넘지 않도록 출력 픽셀 수 상한 */
const MAX_EXPORT_PIXELS = 16_000_000;
const DEFAULT_FONT_FAMILY = 'ui-sans-serif, system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

type Box = [number, number, number, number];

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

/** 저장 해상도 배율: 원본 높이가 목표보다 작으면 키우되 최대 3배, 전체 픽셀 수 상한 이내 */
export function getExportScale(width: number, height: number): number {
  const byHeight = EXPORT_TARGET_HEIGHT / height;
  const byPixels = Math.sqrt(MAX_EXPORT_PIXELS / (width * height));
  return Math.max(1, Math.min(MAX_EXPORT_SCALE, byHeight, byPixels));
}

export interface RenderPageOptions {
  /** 화면에서 이 페이지가 그려진 높이 (CSS px, 뷰어 배율 포함). 글자 크기를 화면과 같은 비율로 맞추는 기준 */
  displayPageHeight: number;
  /** 뷰어 배율. 글자 최소·최대 크기는 배율에 비례하고, 여백·모서리는 배율과 무관 (화면 규칙과 동일) */
  viewScale: number;
  /** 화면과 같은 글꼴 */
  fontFamily?: string;
}

/**
 * 이미지 위에 번역 말풍선을 화면 덮어쓰기와 같은 규칙으로 그립니다.
 * 원본이 작으면 고해상도로 키워 그리므로 화면(레티나)보다 흐려 보이지 않습니다.
 */
export async function renderTranslatedPage(src: string, results: TranslationResult[], options: RenderPageOptions): Promise<HTMLCanvasElement> {
  const image = await loadImage(src);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const outputScale = getExportScale(width, height);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * outputScale);
  canvas.height = Math.round(height * outputScale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // 이후 모든 좌표는 원본 이미지 기준으로 그리고, 캔버스가 출력 배율만큼 키움
  ctx.scale(canvas.width / width, canvas.height / height);
  ctx.drawImage(image, 0, 0, width, height);

  // 화면 CSS 1px이 원본 이미지에서 몇 px인지
  const cssPx = height / Math.max(1, options.displayPageHeight);
  const minFont = OVERLAY_STYLE.minFontPx * options.viewScale * cssPx;
  const maxFont = OVERLAY_STYLE.maxFontPx * options.viewScale * cssPx;
  const fontFamily = options.fontFamily || DEFAULT_FONT_FAMILY;
  const setFont = (size: number) => {
    ctx.font = `${OVERLAY_STYLE.fontWeight} ${size}px ${fontFamily}`;
    ctx.letterSpacing = `${OVERLAY_STYLE.letterSpacingEm * size}px`;
  };
  const measure = (text: string) => ctx.measureText(text).width;

  for (const result of results) {
    const displayBox = getDisplayBox(result);
    const [ymin, xmin, ymax, xmax] = displayBox;
    const boxWidth = ((xmax - xmin) / 1000) * width;
    const boxHeight = ((ymax - ymin) / 1000) * height;
    if (!(boxWidth > 0 && boxHeight > 0)) continue;

    const text = result.translated_text ?? '';
    const fontSize = overlayFontSize(estimateFontRatios({ translated_text: text }, displayBox), boxWidth, boxHeight, minFont, maxFont);
    setFont(fontSize);
    const layout = layoutOverlayText(text, boxWidth, boxHeight, fontSize, !result.disable_keep_all, measure, cssPx);

    const cx = ((xmin + xmax) / 2 / 1000) * width;
    const cy = ((ymin + ymax) / 2 / 1000) * height;

    // 흰 상자 + 그림자 (shadow 값은 좌표 변환을 받지 않으므로 출력 배율을 직접 곱함)
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
    ctx.shadowBlur = OVERLAY_STYLE.shadowBlurPx * cssPx * outputScale;
    ctx.shadowOffsetY = OVERLAY_STYLE.shadowOffsetYPx * cssPx * outputScale;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(
      cx - layout.width / 2,
      cy - layout.height / 2,
      layout.width,
      layout.height,
      Math.min(OVERLAY_STYLE.radiusPx * cssPx, layout.width / 2, layout.height / 2),
    );
    ctx.fill();
    ctx.restore();

    // 글자: CSS 줄 높이 안에서 글꼴 ascent/descent 기준으로 세로 중앙 (half-leading)
    ctx.fillStyle = '#111827';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const metrics = ctx.measureText('가');
    const ascent = metrics.fontBoundingBoxAscent || fontSize * 0.88;
    const descent = metrics.fontBoundingBoxDescent || fontSize * 0.12;
    const lineHeight = fontSize * OVERLAY_STYLE.lineHeight;
    const textTop = cy - (layout.lines.length * lineHeight) / 2;
    layout.lines.forEach((line, i) => {
      const baseline = textTop + i * lineHeight + (lineHeight - (ascent + descent)) / 2 + ascent;
      ctx.fillText(line, cx, baseline);
    });
  }

  return canvas;
}

export function exportFormatFor(mimeType: string): { type: string; ext: string; quality?: number } {
  return mimeType === 'image/png'
    ? { type: 'image/png', ext: 'png' }
    : { type: 'image/jpeg', ext: 'jpg', quality: 0.95 };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('이미지 변환에 실패했습니다.'))), type, quality);
  });
}
