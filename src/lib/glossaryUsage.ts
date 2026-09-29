import { stripFurigana } from './prompt';

/**
 * 단어장 단어가 지금 연 파일의 번역 기록(원문)에 몇 줄 나왔는지 셉니다. (API 요청 없음)
 * 다른 책에서 딸려 온 단어·이제 안 쓰는 단어를 골라내는 데 씀
 */
const normalize = (text: string) => stripFurigana(text ?? '').normalize('NFKC').replace(/\s+/g, '');

/** 단어(원문) → 그 단어가 들어 있는 대사 줄 수 */
export function countGlossaryUsage(terms: string[], originals: string[]): Record<string, number> {
  const lines = originals.map(normalize).filter(Boolean);
  return Object.fromEntries(terms.map(term => {
    const needle = normalize(term);
    return [term, needle ? lines.filter(line => line.includes(needle)).length : 0];
  }));
}
