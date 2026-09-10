import type { TranslationResult } from './gemini';
import { loadImage } from './imageUtils';

const FONT_FAMILY = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
const LINE_HEIGHT = 1.15;
/** 화면 오버레이는 표시 높이 약 650px 기준 13~28px 글자를 씁니다. 원본 해상도로 환산할 때 이 기준을 사용합니다. */
const REFERENCE_PAGE_HEIGHT = 650;

/** 화면 오버레이와 같은 규칙의 표시용 박스 (직접 편집하지 않은 박스는 가로 1.3배, 세로 1.1배 확장) */
export function getDisplayBox(result: Pick<TranslationResult, 'box_2d' | 'is_edited_box'>): [number, number, number, number] {
  const [ymin, xmin, ymax, xmax] = result.box_2d;
  if (result.is_edited_box) return [ymin, xmin, ymax, xmax];
  const width = (xmax - xmin) * 1.3;
  const height = (ymax - ymin) * 1.1;
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  return [cy - height / 2, cx - width / 2, cy + height / 2, cx + width / 2];
}

type Measure = (text: string) => number;

/**
 * 캔버스용 줄바꿈.
 * keepAll이면 CSS `word-break: keep-all`처럼 공백 단위로 끊고, 한 단어가 너무 길 때만 글자 단위로 자릅니다.
 */
export function wrapText(text: string, maxWidth: number, measure: Measure, keepAll: boolean): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    const pushChars = (chunk: string) => {
      for (const ch of Array.from(chunk)) {
        if (line && measure(line + ch) > maxWidth) {
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
        if (measure(line + token) <= maxWidth) {
          line += token;
        } else if (!token.trim()) {
          if (line) lines.push(line.trimEnd());
          line = '';
        } else {
          if (line.trim()) lines.push(line.trimEnd());
          line = '';
          if (measure(token) <= maxWidth) line = token;
          else pushChars(token);
        }
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export interface BubbleLayout {
  fontSize: number;
  lines: string[];
  width: number;
  height: number;
}

/** 박스 안에 들어가는 가장 큰 글자 크기를 찾습니다. 최소 크기로도 넘치면 박스를 가로 2배까지, 세로는 필요한 만큼 키웁니다. */
export function layoutBubbleText(
  text: string,
  boxWidth: number,
  boxHeight: number,
  keepAll: boolean,
  measureAt: (text: string, fontSize: number) => number,
  minFont: number,
  maxFont: number,
): BubbleLayout {
  const step = Math.max(1, Math.round(maxFont / 40));
  for (let fontSize = maxFont; fontSize >= minFont; fontSize -= step) {
    const padX = fontSize * 0.4;
    const padY = fontSize * 0.2;
    const innerWidth = Math.max(fontSize, boxWidth - padX * 2);
    const lines = wrapText(text, innerWidth, t => measureAt(t, fontSize), keepAll);
    const textWidth = Math.max(...lines.map(l => measureAt(l, fontSize)));
    const textHeight = lines.length * fontSize * LINE_HEIGHT;
    if (textWidth <= innerWidth && textHeight + padY * 2 <= boxHeight) {
      return { fontSize, lines, width: boxWidth, height: boxHeight };
    }
  }

  const fontSize = minFont;
  const padX = fontSize * 0.4;
  const padY = fontSize * 0.2;
  const innerWidth = Math.max(fontSize, boxWidth * 2 - padX * 2);
  const lines = wrapText(text, innerWidth, t => measureAt(t, fontSize), keepAll);
  const textWidth = Math.max(...lines.map(l => measureAt(l, fontSize)));
  return {
    fontSize,
    lines,
    width: Math.max(boxWidth, Math.min(boxWidth * 2, textWidth + padX * 2)),
    height: Math.max(boxHeight, lines.length * fontSize * LINE_HEIGHT + padY * 2),
  };
}

/**
 * 원본 해상도 이미지 위에 번역 말풍선을 직접 그립니다.
 * 화면 캡처(html2canvas)와 달리 페이지 이동이 필요 없고, 창 크기와 무관하게 원본 화질로 저장됩니다.
 */
export async function renderTranslatedPage(src: string, results: TranslationResult[]): Promise<HTMLCanvasElement> {
  const image = await loadImage(src);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다.');
  ctx.drawImage(image, 0, 0);

  const unit = height / REFERENCE_PAGE_HEIGHT;
  const minFont = Math.max(8, 13 * unit);
  const maxFont = Math.max(minFont, 28 * unit);
  const fontAt = (size: number) => `800 ${size}px ${FONT_FAMILY}`;
  const measureAt = (text: string, size: number) => {
    ctx.font = fontAt(size);
    return ctx.measureText(text).width;
  };

  for (const result of results) {
    const text = result.translated_text?.trim();
    if (!text) continue;

    const [ymin, xmin, ymax, xmax] = getDisplayBox(result);
    const boxWidth = ((xmax - xmin) / 1000) * width;
    const boxHeight = ((ymax - ymin) / 1000) * height;
    if (boxWidth <= 0 || boxHeight <= 0) continue;

    const layout = layoutBubbleText(text, boxWidth, boxHeight, !result.disable_keep_all, measureAt, minFont, maxFont);
    const cx = ((xmin + xmax) / 2 / 1000) * width;
    const cy = ((ymin + ymax) / 2 / 1000) * height;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
    ctx.shadowBlur = 10 * unit;
    ctx.shadowOffsetY = 2 * unit;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(
      cx - layout.width / 2,
      cy - layout.height / 2,
      layout.width,
      layout.height,
      Math.min(16 * unit, layout.width / 2, layout.height / 2),
    );
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#111827';
    ctx.font = fontAt(layout.fontSize);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lineHeight = layout.fontSize * LINE_HEIGHT;
    const firstLineY = cy - ((layout.lines.length - 1) * lineHeight) / 2;
    layout.lines.forEach((line, i) => ctx.fillText(line, cx, firstLineY + i * lineHeight));
  }

  return canvas;
}

export function exportFormatFor(mimeType: string): { type: string; ext: string; quality?: number } {
  return mimeType === 'image/png'
    ? { type: 'image/png', ext: 'png' }
    : { type: 'image/jpeg', ext: 'jpg', quality: 0.92 };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('이미지 변환에 실패했습니다.'))), type, quality);
  });
}
