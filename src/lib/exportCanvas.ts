import { layoutTags, resolveDisplayMode, TAG_STYLE } from './bubbleDisplay';
import type { TranslationResult } from './gemini';
import { loadImage } from './imageUtils';
import { createTextMeasurer, estimateFontRatios, getDisplayBox, layoutOverlayText, layoutVerticalText, OVERLAY_STYLE, overlayFontSize, resolveTextDirection, VERTICAL_TEXT, type VerticalLayout } from './overlayLayout';

/** 저장 이미지 목표 높이. 원본이 이보다 작으면 최대 MAX_EXPORT_SCALE배까지 키워 글자를 선명하게 그림 */
const EXPORT_TARGET_HEIGHT = 2400;
const MAX_EXPORT_SCALE = 3;
/** 브라우저 캔버스 한계를 넘지 않도록 출력 픽셀 수 상한 */
const MAX_EXPORT_PIXELS = 16_000_000;
const DEFAULT_FONT_FAMILY = 'ui-sans-serif, system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

/** 저장 해상도 배율: 원본 높이가 목표보다 작으면 키우되 최대 3배, 전체 픽셀 수 상한 이내 */
export function getExportScale(width: number, height: number): number {
  const byHeight = EXPORT_TARGET_HEIGHT / height;
  const byPixels = Math.sqrt(MAX_EXPORT_PIXELS / (width * height));
  return Math.max(1, Math.min(MAX_EXPORT_SCALE, byHeight, byPixels));
}

export interface RenderPageOptions {
  /** 화면에서 이 페이지가 그려진 높이 (CSS px, 뷰어 배율 포함). 글자 크기를 화면과 같은 비율로 맞추는 기준 */
  displayPageHeight: number;
  /** 뷰어 배율. 글자 최소·최대 크기와 작은 딱지는 배율에 비례, 덮기 상자의 여백·모서리는 배율과 무관 (화면 규칙과 동일) */
  viewScale: number;
  /** 화면과 같은 글꼴 */
  fontFamily?: string;
}

/** 흰 상자 + 그림자. shadow 값은 좌표 변환을 받지 않으므로 호출하는 쪽에서 출력 배율을 곱해 넘김 */
function drawBubbleBox(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, shadowBlur: number, shadowOffsetY: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
  ctx.shadowBlur = shadowBlur;
  ctx.shadowOffsetY = shadowOffsetY;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
  ctx.fill();
  ctx.restore();
}

/** 여러 줄을 (cx, cy) 중심으로 그림. CSS 줄 높이 안에서 글꼴 ascent/descent 기준 세로 중앙 (half-leading) */
function drawTextLines(ctx: CanvasRenderingContext2D, lines: string[], cx: number, cy: number, fontSize: number, setFont: (size: number) => void) {
  setFont(fontSize);
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const metrics = ctx.measureText('가');
  const ascent = metrics.fontBoundingBoxAscent || fontSize * 0.88;
  const descent = metrics.fontBoundingBoxDescent || fontSize * 0.12;
  const lineHeight = fontSize * OVERLAY_STYLE.lineHeight;
  const textTop = cy - (lines.length * lineHeight) / 2;
  lines.forEach((line, i) => {
    const baseline = textTop + i * lineHeight + (lineHeight - (ascent + descent)) / 2 + ascent;
    ctx.fillText(line, cx, baseline);
  });
}

/** 세로쓰기: 첫 열을 가장 오른쪽에 두고 글자를 한 칸씩 아래로 그림 */
function drawVerticalColumns(ctx: CanvasRenderingContext2D, layout: VerticalLayout, cx: number, cy: number, setFont: (size: number) => void) {
  setFont(layout.fontSize);
  ctx.letterSpacing = '0px'; // 한 글자씩 그리므로 자간은 쓰지 않음
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const cellHeight = layout.fontSize * VERTICAL_TEXT.cellHeight;
  const columnWidth = layout.fontSize * VERTICAL_TEXT.columnWidth;
  const totalWidth = layout.columns.length * columnWidth;

  layout.columns.forEach((column, columnIndex) => {
    const x = cx + totalWidth / 2 - columnWidth * (columnIndex + 0.5);
    const columnHeight = column.length * cellHeight;
    column.forEach((char, charIndex) => {
      ctx.fillText(char, x, cy - columnHeight / 2 + cellHeight * (charIndex + 0.5));
    });
  });
}

/**
 * 이미지 위에 번역을 화면 덮어쓰기와 같은 규칙으로 그립니다. (덮기 말풍선 + 효과음용 작은 딱지)
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
  const { measure, setFont } = createTextMeasurer(options.fontFamily || DEFAULT_FONT_FAMILY, ctx);

  // 1) 원문을 덮는 말풍선
  for (const result of results) {
    if (resolveDisplayMode(result) === 'tag') continue;

    const displayBox = getDisplayBox(result);
    const [ymin, xmin, ymax, xmax] = displayBox;
    const boxWidth = ((xmax - xmin) / 1000) * width;
    const boxHeight = ((ymax - ymin) / 1000) * height;
    if (!(boxWidth > 0 && boxHeight > 0)) continue;

    const text = result.translated_text ?? '';
    const cx = ((xmin + xmax) / 2 / 1000) * width;
    const cy = ((ymin + ymax) / 2 / 1000) * height;
    const shadowBlur = OVERLAY_STYLE.shadowBlurPx * cssPx * outputScale;
    const shadowOffsetY = OVERLAY_STYLE.shadowOffsetYPx * cssPx * outputScale;

    // 홀쭉한 박스(말풍선 없는 세로 한 줄 글자)는 세로쓰기로
    if (resolveTextDirection(result, boxWidth, boxHeight, minFont, cssPx) === 'vertical') {
      const layout = layoutVerticalText(text, boxWidth, boxHeight, minFont, maxFont, cssPx);
      drawBubbleBox(ctx, cx - layout.width / 2, cy - layout.height / 2, layout.width, layout.height, OVERLAY_STYLE.radiusPx * cssPx, shadowBlur, shadowOffsetY);
      drawVerticalColumns(ctx, layout, cx, cy, setFont);
      continue;
    }

    const fontSize = overlayFontSize(estimateFontRatios({ translated_text: text }, displayBox), boxWidth, boxHeight, minFont, maxFont);
    const layout = layoutOverlayText(text, boxWidth, boxHeight, fontSize, !result.disable_keep_all, t => measure(t, fontSize), cssPx);
    drawBubbleBox(ctx, cx - layout.width / 2, cy - layout.height / 2, layout.width, layout.height, OVERLAY_STYLE.radiusPx * cssPx, shadowBlur, shadowOffsetY);
    drawTextLines(ctx, layout.lines, cx, cy, fontSize, setFont);
  }

  // 2) 효과음 등 원문은 두고 바깥에 붙이는 작은 딱지
  const tagUnit = cssPx * options.viewScale;
  const tags = layoutTags(results, width, height, tagUnit, measure);
  for (const result of results) {
    const tag = tags[result.id];
    if (!tag) continue;
    const { x, y, width: w, height: h } = tag.rect;
    drawBubbleBox(
      ctx, x, y, w, h,
      TAG_STYLE.radiusPx * tagUnit, OVERLAY_STYLE.shadowBlurPx * tagUnit * outputScale, OVERLAY_STYLE.shadowOffsetYPx * tagUnit * outputScale,
    );
    drawTextLines(ctx, tag.lines, x + w / 2, y + h / 2, tag.fontSize, setFont);
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
