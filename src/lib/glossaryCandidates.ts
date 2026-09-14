/**
 * 번역 기록에서 뽑은 "단어장 후보".
 * 작품 노트를 정리하는 요청에 함께 붙여 받으므로 추가 요청은 없고, 사용자가 단어장 창에서 추가·무시를 고릅니다.
 */
import { parseJsonResponse, stripFurigana } from './prompt';

export interface GlossaryCandidate {
  original: string;
  translated: string;
}

/** 작품 노트 정리 요청의 응답: 노트 본문 + 단어장 후보 */
export interface WorkNotesResult {
  notes: string;
  glossary: GlossaryCandidate[];
}

interface StoredCandidates {
  candidates: GlossaryCandidate[];
  /** 사용자가 "무시"한 원문 — 다시 추천하지 않음 */
  dismissed: string[];
}

const PREFIX = 'manga-glossary-candidates-';
/** 한 번에 보여줄 최대 후보 수 */
export const MAX_CANDIDATES = 12;
/** 번역 기록에서 최소 이만큼 등장해야 후보로 인정 (모델이 지어낸 용어 걸러내기) */
const MIN_OCCURRENCES = 2;

const CJK = /[ぁ-ゖァ-ヺ㐀-䶿一-鿿]/;
const HANGUL = /[가-힣]/;

export const candidatesKey = (workName: string) => `${PREFIX}${workName || 'default'}`;

export function loadCandidates(workName: string): StoredCandidates {
  try {
    const parsed = JSON.parse(localStorage.getItem(candidatesKey(workName)) || '{}');
    return {
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates.filter(isCandidate) : [],
      dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed.filter((d: unknown) => typeof d === 'string') : [],
    };
  } catch {
    return { candidates: [], dismissed: [] };
  }
}

export function saveCandidates(workName: string, data: StoredCandidates) {
  try {
    if (data.candidates.length === 0 && data.dismissed.length === 0) localStorage.removeItem(candidatesKey(workName));
    else localStorage.setItem(candidatesKey(workName), JSON.stringify(data));
  } catch (err) {
    console.warn('단어장 후보 저장 실패:', err);
  }
}

function isCandidate(value: unknown): value is GlossaryCandidate {
  const c = value as GlossaryCandidate;
  return !!c && typeof c.original === 'string' && typeof c.translated === 'string';
}

/**
 * 작품 노트 요청의 응답을 읽습니다.
 * JSON이 아니면(모델이 형식을 어긴 경우) 응답 전체를 노트로 쓰고 후보는 없는 것으로 처리합니다.
 */
export function parseWorkNotesResponse(text: string): WorkNotesResult {
  const trimmed = text.trim();
  try {
    const parsed = parseJsonResponse<{ notes?: unknown; glossary?: unknown }>(trimmed);
    if (parsed && typeof parsed === 'object' && typeof parsed.notes === 'string') {
      return { notes: parsed.notes.trim(), glossary: Array.isArray(parsed.glossary) ? parsed.glossary.filter(isCandidate) : [] };
    }
  } catch {
    // JSON이 아니면 아래에서 본문 전체를 노트로 사용
  }
  return { notes: trimmed, glossary: [] };
}

const countOccurrences = (haystack: string, needle: string) => {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
};

/**
 * 모델이 제안한 후보 중 쓸 만한 것만 남깁니다.
 * - 원문은 일본어(가나·한자) 2~20자, 번역은 한글이 들어간 1~20자
 * - 이미 단어장에 있거나 사용자가 무시한 원문은 제외
 * - 참고한 대사 원문에 실제로 2번 이상 등장해야 함 (모델이 지어낸 용어 방지)
 */
export function filterCandidates(
  raw: GlossaryCandidate[],
  sourceOriginals: string[],
  glossary: Record<string, string>,
  dismissed: string[],
): GlossaryCandidate[] {
  const corpus = sourceOriginals.map(stripFurigana).join('\n');
  const skip = new Set([...Object.keys(glossary), ...dismissed]);
  const seen = new Set<string>();
  const result: GlossaryCandidate[] = [];
  for (const candidate of raw) {
    const original = stripFurigana(candidate.original).trim();
    const translated = candidate.translated.trim();
    const length = Array.from(original).length;
    if (length < 2 || length > 20 || !CJK.test(original)) continue;
    if (!translated || Array.from(translated).length > 20 || !HANGUL.test(translated)) continue;
    if (skip.has(original) || seen.has(original)) continue;
    if (countOccurrences(corpus, original) < MIN_OCCURRENCES) continue;
    seen.add(original);
    result.push({ original, translated });
  }
  return result;
}

/** 새로 뽑은 후보를 기존 대기 목록에 합칩니다. 같은 원문은 새 번역으로 바꾸고, 단어장·무시 목록에 있는 건 뺌 */
export function mergeCandidates(
  current: GlossaryCandidate[],
  incoming: GlossaryCandidate[],
  glossary: Record<string, string>,
  dismissed: string[],
): GlossaryCandidate[] {
  const skip = new Set([...Object.keys(glossary), ...dismissed]);
  const byOriginal = new Map<string, GlossaryCandidate>();
  for (const c of [...current, ...incoming]) {
    if (!skip.has(c.original)) byOriginal.set(c.original, c);
  }
  return [...byOriginal.values()].slice(-MAX_CANDIDATES);
}
