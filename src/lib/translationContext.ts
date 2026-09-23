import type { TranslationCache, UploadedImage } from '../types';
import { buildCacheKey } from './cacheKey';
import { buildCorrectionSection, type Correction } from './corrections';
import { stripFurigana } from './prompt';

export interface DialoguePair {
  original: string;
  translated: string;
}

const PLACEHOLDER_TEXTS = new Set(['...', '번역 중...', '인식된 텍스트가 없습니다.']);

/**
 * 번역 요청마다 붙이는 직전 대사 수. 작품 노트가 있으면 말투·호칭은 노트가 알려 주므로
 * 직전 대사는 바로 앞 흐름만 알 만큼 줄여 매 요청의 입력 토큰을 아낍니다.
 */
const RECENT_PAIRS_WITH_NOTES = 8;
const RECENT_PAIRS_WITHOUT_NOTES = 16;
export const recentPairLimit = (notes: string | undefined) => (notes?.trim() ? RECENT_PAIRS_WITH_NOTES : RECENT_PAIRS_WITHOUT_NOTES);

function pagePairs(images: UploadedImage[], cache: TranslationCache, index: number): { key: string; pairs: DialoguePair[] } {
  const key = buildCacheKey(images[index].file.name, images[index].file.size);
  const pairs = (cache[key] ?? [])
    .filter(r => r.translated_text?.trim() && !PLACEHOLDER_TEXTS.has(r.translated_text.trim()))
    .map(r => ({ original: stripFurigana(r.original_text ?? '').trim(), translated: r.translated_text.trim() }));
  return { key, pairs };
}

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
    const { pairs: page } = pagePairs(images, cache, i);
    if (page.length === 0) continue;

    pages.unshift(page);
    collected += page.length;
  }

  return pages.flat().slice(-maxPairs);
}

/**
 * 작품 노트에 아직 반영되지 않은 페이지의 대사만 모읍니다. (읽는 순서, 너무 많으면 최근 것만)
 * pageKeys는 대사가 있는 번역된 페이지 전체 — 갱신에 성공하면 이것을 "반영됨"으로 저장합니다.
 */
export function collectUnsummarizedPairs(
  images: UploadedImage[],
  cache: TranslationCache,
  coveredPages: Iterable<string>,
  maxPairs: number,
): { pairs: DialoguePair[]; pageKeys: string[] } {
  const covered = new Set(coveredPages);
  const pairs: DialoguePair[] = [];
  const pageKeys: string[] = [];
  images.forEach((_, i) => {
    const { key, pairs: page } = pagePairs(images, cache, i);
    if (page.length === 0) return;
    pageKeys.push(key);
    if (!covered.has(key)) pairs.push(...page);
  });
  return { pairs: pairs.slice(-maxPairs), pageKeys };
}

export interface TranslationContext {
  /** (B) 작품 노트 — 작품 단위로만 바뀌므로 프롬프트 앞쪽(캐시가 걸리는 구간)에 들어감 */
  context: string;
  /** (C) 직전 대사·내 교정 — 페이지마다 바뀌므로 프롬프트 맨 뒤에 들어감 */
  recentContext: string;
}

const CONTEXT_HEADER = `# 이어지는 맥락 (반드시 참고)
같은 작품의 앞부분이야. 인물의 말투(반말·존댓말·거친 말투), 서로를 부르는 호칭, 고유명사 표기를 아래와 일관되게 유지해.`;

/**
 * 번역 프롬프트에 붙일 맥락을 **바뀌는 주기별로 나눠** 만듭니다.
 *
 * 프롬프트는 "앞에서부터 동일한 구간"만 캐시되어 싸게 계산되므로,
 * 10장에 한 번 바뀌는 작품 노트와 페이지마다 바뀌는 직전 대사를 한 덩어리로 묶으면
 * 노트까지 매번 캐시가 깨져 버립니다. 그래서 둘을 분리해 돌려줍니다. (translationPrompt.ts의 순서 규칙 참고)
 */
export function buildContextInstruction(notes: string | undefined, pairs: DialoguePair[], corrections: Correction[] = []): TranslationContext {
  const trimmedNotes = notes?.trim();
  const context = trimmedNotes ? `\n${CONTEXT_HEADER}\n## 작품 노트 (인물·말투·호칭)\n${trimmedNotes}\n` : '';

  const recent: string[] = [];
  const correctionSection = buildCorrectionSection(corrections);
  if (correctionSection) recent.push(correctionSection);
  if (pairs.length > 0) {
    const lines = pairs.map(p => `- ${p.original || '(원문 없음)'} → ${p.translated}`).join('\n');
    recent.push(`## 직전까지의 번역 (원문 → 번역)\n${lines}`);
  }
  // 노트가 없으면 맥락 안내 문구가 아직 안 나왔으므로 여기서 한 번 붙여 준다
  const recentContext = recent.length === 0 ? '' : `${trimmedNotes ? '' : `${CONTEXT_HEADER}\n`}${recent.join('\n')}`;

  return { context, recentContext };
}
