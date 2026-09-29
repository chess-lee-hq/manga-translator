import type { TranslationResult } from '../types';
import { stripFurigana } from './prompt';

/**
 * 번역 일관성 검사 (API 요청 없음).
 * - 같은 원문이 페이지마다 다르게 번역된 곳 (인물 이름을 부르는 대사, 반복되는 말버릇·효과음 등)
 * - 단어장에 있는 원문이 나왔는데 번역에 단어장의 한국어 표기가 없는 곳
 */

export interface ConsistencyPage {
  /** 0부터 시작하는 페이지 번호 */
  imgIndex: number;
  key: string;
  results: TranslationResult[];
}

export interface LineRef {
  imgIndex: number;
  key: string;
  id: string;
  originalText: string;
  translatedText: string;
}

export interface ConsistencyVariant {
  /** 이 번역 중 가장 많이 쓰인 표기 그대로 */
  translated: string;
  refs: LineRef[];
}

export interface ConsistencyGroup {
  /** 비교에 쓴 원문 (요미가나·문장부호 제외) */
  original: string;
  /** 많이 쓰인 번역부터 */
  variants: ConsistencyVariant[];
}

export interface GlossaryMiss {
  term: string;
  expected: string;
  refs: LineRef[];
}

/** 이 글자들만 다른 원문·번역은 같은 것으로 봄 (공백·문장부호·말줄임표·괄호) */
const IGNORED = /[\s!?！？。、,.，．…‥・·「」『』()（）［］[\]"'“”‘’~〜〰♪♡♥☆★]/g;
const MIN_ORIGINAL_LENGTH = 2;

export const normalizeOriginal = (text: string) => stripFurigana(text ?? '').normalize('NFKC').replace(IGNORED, '');
export const normalizeTranslation = (text: string) => (text ?? '').normalize('NFKC').replace(IGNORED, '');

function refsOf(pages: ConsistencyPage[]): LineRef[] {
  return pages.flatMap(page => page.results
    .filter(r => r.translated_text?.trim())
    .map(r => ({ imgIndex: page.imgIndex, key: page.key, id: r.id, originalText: r.original_text ?? '', translatedText: r.translated_text })));
}

/** 같은 원문인데 번역이 2가지 이상인 곳. 여러 번 나온 원문·긴 원문부터 */
export function findInconsistentLines(pages: ConsistencyPage[], ignored: Iterable<string> = []): ConsistencyGroup[] {
  const skip = new Set(ignored);
  const byOriginal = new Map<string, Map<string, LineRef[]>>();
  for (const ref of refsOf(pages)) {
    const original = normalizeOriginal(ref.originalText);
    if (Array.from(original).length < MIN_ORIGINAL_LENGTH || skip.has(original)) continue;
    const variants = byOriginal.get(original) ?? new Map<string, LineRef[]>();
    const translation = normalizeTranslation(ref.translatedText);
    variants.set(translation, [...(variants.get(translation) ?? []), ref]);
    byOriginal.set(original, variants);
  }

  const groups: ConsistencyGroup[] = [];
  for (const [original, variants] of byOriginal) {
    if (variants.size < 2) continue;
    groups.push({
      original,
      variants: [...variants.values()]
        .map(refs => ({ translated: mostCommon(refs.map(r => r.translatedText.trim())), refs }))
        .sort((a, b) => b.refs.length - a.refs.length),
    });
  }
  const total = (g: ConsistencyGroup) => g.variants.reduce((sum, v) => sum + v.refs.length, 0);
  return groups.sort((a, b) => total(b) - total(a) || Array.from(b.original).length - Array.from(a.original).length);
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  values.forEach(v => counts.set(v, (counts.get(v) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** 단어장 원문이 나왔는데 번역에 단어장의 한국어 표기가 없는 곳 */
export function findGlossaryMisses(pages: ConsistencyPage[], glossary: Record<string, string>): GlossaryMiss[] {
  const refs = refsOf(pages);
  return Object.entries(glossary)
    .filter(([term, expected]) => Array.from(normalizeOriginal(term)).length >= MIN_ORIGINAL_LENGTH && normalizeTranslation(expected))
    .map(([term, expected]) => {
      const wantedOriginal = normalizeOriginal(term);
      const wantedTranslation = normalizeTranslation(expected);
      return {
        term,
        expected,
        refs: refs.filter(ref => normalizeOriginal(ref.originalText).includes(wantedOriginal)
          && !normalizeTranslation(ref.translatedText).includes(wantedTranslation)),
      };
    })
    .filter(miss => miss.refs.length > 0)
    .sort((a, b) => b.refs.length - a.refs.length);
}

const IGNORED_KEY_PREFIX = 'manga-consistency-ignored-';

/** "그대로 둬도 됨"으로 넘긴 원문 (작품별) */
export function loadIgnoredOriginals(workKey: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${IGNORED_KEY_PREFIX}${workKey}`) || '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function saveIgnoredOriginals(workKey: string, originals: string[]) {
  try {
    localStorage.setItem(`${IGNORED_KEY_PREFIX}${workKey}`, JSON.stringify([...new Set(originals)]));
  } catch {
    // 저장 못 해도 이번 화면에서는 숨김
  }
}
