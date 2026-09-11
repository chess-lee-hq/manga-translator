import type { TranslationResult } from './gemini';
import { getDisplayBox, OVERLAY_STYLE, wrapText, type Box } from './overlayLayout';
import { stripFurigana } from './prompt';

/** cover: 원문을 흰 말풍선으로 덮음 / tag: 원문(효과음 등)은 그대로 두고 바깥에 작은 딱지 */
export type DisplayMode = 'cover' | 'tag';

/** 효과음(큰 글씨) 자동 판별 기준. 면적은 페이지 전체를 1로 본 비율 */
export const SFX_RULE = {
  /** 번역문 글자 수 상한 (공백·문장부호 제외) */
  maxTranslatedGlyphs: 5,
  /** 원문 글자 수 상한 (요미가나·문장부호 제외) */
  maxOriginalGlyphs: 8,
  /** 글자 영역이 페이지의 1% 이상 */
  minBoxArea: 0.01,
  /** 원문 한 글자가 페이지의 0.5% 이상을 차지할 만큼 큰 글씨 */
  minAreaPerGlyph: 0.005,
} as const;

/** 작은 딱지 모양. 값은 "배율 100% 화면 px" 기준이며 화면·저장 모두 배율에 비례 */
export const TAG_STYLE = {
  fontPx: 16,
  maxTextWidthPx: 180,
  paddingXPx: 8,
  paddingYPx: 4,
  radiusPx: 10,
  /** 원문 영역과 딱지 사이 간격 */
  gapPx: 6,
} as const;

const IGNORED_CHARS = /[\s!?！？.,、。…~〜ー－\-·・'"“”‘’()（）[\]「」『』]/g;
const glyphCount = (text: string) => Array.from(text.replace(IGNORED_CHARS, '')).length;

/** 번역문이 짧고 원문 글씨가 아주 크면 효과음(박력 글자)으로 봅니다. */
export function isLikelySfx(result: Pick<TranslationResult, 'box_2d' | 'original_text' | 'translated_text'>): boolean {
  const translated = glyphCount(result.translated_text ?? '');
  if (translated === 0 || translated > SFX_RULE.maxTranslatedGlyphs) return false;

  const original = glyphCount(stripFurigana(result.original_text ?? ''));
  if (original > SFX_RULE.maxOriginalGlyphs) return false;

  const [ymin, xmin, ymax, xmax] = result.box_2d;
  const area = (Math.max(0, xmax - xmin) / 1000) * (Math.max(0, ymax - ymin) / 1000);
  return area >= SFX_RULE.minBoxArea && area / Math.max(1, original || translated) >= SFX_RULE.minAreaPerGlyph;
}

/** 사용자가 직접 고른 방식이 있으면 그것을, 없으면 자동 판별 결과를 씁니다. */
export function resolveDisplayMode(result: Pick<TranslationResult, 'box_2d' | 'original_text' | 'translated_text' | 'display_mode'>): DisplayMode {
  if (result.display_mode === 'cover' || result.display_mode === 'tag') return result.display_mode;
  return isLikelySfx(result) ? 'tag' : 'cover';
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TagLayout {
  rect: Rect;
  lines: string[];
  fontSize: number;
}

export function boxToRect([ymin, xmin, ymax, xmax]: Box, pageWidth: number, pageHeight: number): Rect {
  return {
    x: (xmin / 1000) * pageWidth,
    y: (ymin / 1000) * pageHeight,
    width: ((xmax - xmin) / 1000) * pageWidth,
    height: ((ymax - ymin) / 1000) * pageHeight,
  };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function clampToPage(rect: Rect, pageWidth: number, pageHeight: number): Rect {
  return {
    ...rect,
    x: Math.min(Math.max(0, rect.x), Math.max(0, pageWidth - rect.width)),
    y: Math.min(Math.max(0, rect.y), Math.max(0, pageHeight - rect.height)),
  };
}

/**
 * 한 페이지의 작은 딱지 위치를 정합니다. (화면과 이미지 저장이 같은 계산 사용)
 * 원문 글자 영역 바깥의 오른쪽 → 왼쪽 → 아래 → 위 → 네 모서리 순으로 후보를 두고,
 * 원문·다른 말풍선·이미 놓인 딱지와 가장 덜 겹치는 자리를 고릅니다.
 * unit: TAG_STYLE의 1px이 그리는 좌표계에서 몇 px인지 (화면: 뷰어 배율 / 저장: 원본 px 환산 × 배율)
 */
export function layoutTags(
  results: TranslationResult[],
  pageWidth: number,
  pageHeight: number,
  unit: number,
  measure: (text: string, fontSize: number) => number,
): Record<string, TagLayout> {
  const modes = results.map(resolveDisplayMode);
  // 덮는 말풍선은 흰 상자 자리, 딱지 대상은 원문 글자 자리를 피해야 할 영역으로 봄
  const areas = results.map((r, i) => boxToRect(modes[i] === 'tag' ? r.box_2d : getDisplayBox(r), pageWidth, pageHeight));

  const fontSize = TAG_STYLE.fontPx * unit;
  const padX = TAG_STYLE.paddingXPx * unit;
  const padY = TAG_STYLE.paddingYPx * unit;
  const gap = TAG_STYLE.gapPx * unit;
  const placed: Rect[] = [];
  const layouts: Record<string, TagLayout> = {};

  results.forEach((result, i) => {
    if (modes[i] !== 'tag') return;

    const measureLine = (text: string) => measure(text, fontSize);
    const lines = wrapText(result.translated_text.trim(), TAG_STYLE.maxTextWidthPx * unit, measureLine, !result.disable_keep_all);
    const width = Math.max(...lines.map(measureLine)) + padX * 2;
    const height = lines.length * fontSize * OVERLAY_STYLE.lineHeight + padY * 2;

    const anchor = areas[i];
    const right = anchor.x + anchor.width + gap;
    const left = anchor.x - gap - width;
    const below = anchor.y + anchor.height + gap;
    const above = anchor.y - gap - height;
    const middleX = anchor.x + anchor.width / 2 - width / 2;
    const middleY = anchor.y + anchor.height / 2 - height / 2;
    const candidates: [number, number][] = [
      [right, middleY], [left, middleY], [middleX, below], [middleX, above],
      [right, below], [left, below], [right, above], [left, above],
    ];

    let best = clampToPage({ x: candidates[0][0], y: candidates[0][1], width, height }, pageWidth, pageHeight);
    let bestScore = Infinity;
    for (const [x, y] of candidates) {
      const rect = clampToPage({ x, y, width, height }, pageWidth, pageHeight);
      // 원문 효과음을 가리는 것이 가장 나쁘고, 그다음 이미 놓인 딱지, 다른 말풍선 순
      let score = overlapArea(rect, anchor) * 4;
      areas.forEach((other, j) => {
        if (j !== i) score += overlapArea(rect, other);
      });
      placed.forEach(other => {
        score += overlapArea(rect, other) * 2;
      });
      // 페이지 끝에 걸려 밀려난 거리만큼 약한 벌점
      score += (Math.abs(rect.x - x) + Math.abs(rect.y - y)) * fontSize * 0.5;
      if (score < bestScore - 1e-6) {
        best = rect;
        bestScore = score;
      }
    }

    placed.push(best);
    layouts[result.id] = { rect: best, lines, fontSize };
  });

  return layouts;
}
