/**
 * 로컬 OCR(manga-ocr) 결과 글자 처리와, LLM이 읽은 원문과의 비교.
 * 워커와 화면 양쪽에서 쓰고 브라우저 API에 의존하지 않아 테스트하기 쉽도록 따로 둠
 */
import { stripFurigana } from './prompt';

/** BERT 토크나이저의 특수 토큰 ([PAD] [UNK] [CLS] [SEP] [MASK]) */
const SPECIAL_TOKEN_COUNT = 5;

/** 모델이 낸 토큰 번호를 글자로. manga-ocr와 같게 공백을 없애고 말줄임표를 점으로 풀어 씀 */
export function decodeOcrTokens(ids: number[], vocab: string[]): string {
  return ids
    .filter(id => id >= SPECIAL_TOKEN_COUNT && id < vocab.length)
    .map(id => vocab[id].replace(/^##/, ''))
    .join('')
    .replace(/\s+/g, '')
    .replace(/…/g, '...');
}

/** 비교에서 무시하는 글자: 공백·문장부호·말줄임표·괄호·장음 표기 흔들림·기호 */
const IGNORED = /[\s!?！？。、,.，．…‥・·「」『』()（）［］[\]"'“”‘’~〜〰ー－―—♪♡♥☆★]/g;

export function normalizeForCompare(text: string): string {
  return stripFurigana(text ?? '')
    .normalize('NFKC')
    .replace(IGNORED, '')
    // 작은 가나(っ·ゃ 등)는 손글씨·작은 글씨에서 크게 읽히는 일이 잦아 같은 글자로 봄
    .replace(/[ぁぃぅぇぉっゃゅょゎ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 1))
    .replace(/[ァィゥェォッャュョヮ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 1));
}

function levenshtein(a: string[], b: string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/** 0(전혀 다름) ~ 1(같음) */
export function textSimilarity(a: string, b: string): number {
  const x = Array.from(normalizeForCompare(a));
  const y = Array.from(normalizeForCompare(b));
  if (x.length === 0 && y.length === 0) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/**
 * 두 원문이 이 비율보다 덜 비슷하면 "원문 불일치"로 봄.
 * 효과음·손글씨는 로컬 OCR도 자주 틀리므로 너무 빡빡하게 잡지 않음 (절반 넘게 다를 때만)
 */
export const OCR_MISMATCH_SIMILARITY = 0.5;
/** 이보다 짧은 원문은 비교하지 않음 (한두 글자 효과음은 오판이 많음) */
const MIN_COMPARE_LENGTH = 3;

export function isOcrMismatch(llmOriginal: string, ocrText: string): boolean {
  const llm = Array.from(normalizeForCompare(llmOriginal));
  const ocr = Array.from(normalizeForCompare(ocrText));
  if (Math.max(llm.length, ocr.length) < MIN_COMPARE_LENGTH) return false;
  // 로컬 OCR이 아무것도 못 읽었으면(그림·효과음) 판단하지 않음
  if (ocr.length === 0) return false;
  return textSimilarity(llmOriginal, ocrText) < OCR_MISMATCH_SIMILARITY;
}

/** 원문 불일치로 붙이는 검토 표시 (앞부분이 같으면 같은 종류로 봄) */
export const OCR_MISMATCH_REVIEW = '원문 불일치(로컬 OCR)';
