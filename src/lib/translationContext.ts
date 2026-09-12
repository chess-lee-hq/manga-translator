import type { TranslationCache, UploadedImage } from '../types';
import { buildCacheKey } from './cacheKey';
import { stripFurigana } from './prompt';

export interface DialoguePair {
  original: string;
  translated: string;
}

const PLACEHOLDER_TEXTS = new Set(['...', '번역 중...', '인식된 텍스트가 없습니다.']);

/**
 * 이미 번역이 끝난 앞 페이지들에서 대사를 모읍니다. (가까운 페이지 우선, 읽는 순서 유지)
 * 병렬 번역 때문에 바로 앞 페이지가 아직 없을 수 있어, 번역된 페이지만 거슬러 올라가며 찾습니다.
 */
export function collectRecentPairs(
  images: UploadedImage[],
  cache: TranslationCache,
  beforePageIndex: number,
  maxPairs = 16,
): DialoguePair[] {
  const pages: DialoguePair[][] = [];
  let collected = 0;

  for (let i = Math.min(beforePageIndex, images.length) - 1; i >= 0 && collected < maxPairs; i--) {
    const results = cache[buildCacheKey(images[i].file.name, images[i].file.size)];
    if (!results?.length) continue;

    const page = results
      .filter(r => r.translated_text?.trim() && !PLACEHOLDER_TEXTS.has(r.translated_text.trim()))
      .map(r => ({ original: stripFurigana(r.original_text ?? '').trim(), translated: r.translated_text.trim() }));
    if (page.length === 0) continue;

    pages.unshift(page);
    collected += page.length;
  }

  return pages.flat().slice(-maxPairs);
}

/** 번역 프롬프트에 붙일 맥락 지시문 (작품 노트 + 직전 대사). 넣을 내용이 없으면 빈 문자열 */
export function buildContextInstruction(notes: string | undefined, pairs: DialoguePair[]): string {
  const sections: string[] = [];
  const trimmedNotes = notes?.trim();
  if (trimmedNotes) sections.push(`## 작품 노트 (인물·말투·호칭)\n${trimmedNotes}`);
  if (pairs.length > 0) {
    const lines = pairs.map(p => `- ${p.original || '(원문 없음)'} → ${p.translated}`).join('\n');
    sections.push(`## 직전까지의 번역 (원문 → 번역)\n${lines}`);
  }
  if (sections.length === 0) return '';

  return `\n# 이어지는 맥락 (반드시 참고)\n같은 작품의 앞부분이야. 인물의 말투(반말·존댓말·거친 말투), 서로를 부르는 호칭, 고유명사 표기를 아래와 일관되게 유지해.\n${sections.join('\n')}\n`;
}
