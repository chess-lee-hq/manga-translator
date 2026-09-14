import type { GridTranslationResult } from './gemini';
import type { GridCellInfo } from './imageUtils';
import { stripFurigana } from './prompt';

/**
 * 번역 결과 자동 품질 검사.
 * 기계적으로 판정할 수 있는 실패만 골라 해당 칸만 다시 요청합니다. (번역이 "어색한지" 같은 판단은 하지 않음)
 */

/** 재요청 대상이 되는 문제. 숫자가 클수록 심각 */
export type CellIssue = 'missing' | 'empty' | 'untranslated' | 'japanese_left';
const SEVERITY: Record<CellIssue, number> = { missing: 4, empty: 3, untranslated: 2, japanese_left: 1 };

const HANGUL = /[가-힣ㄱ-ㆎ]/g;
// 히라가나·가타카나 (장음 ー·가운뎃점 ・은 한국어 번역에도 쓰일 수 있어 제외)
const KANA = /[ぁ-ゖァ-ヺ]/g;
const KANJI = /[㐀-䶿一-鿿]/g;
const HAS_LETTER = /[\p{L}\p{N}]/u;
/** 번역문에 가나가 이 비율 이상 섞이면 덜 번역된 것으로 봄 (예: "그건 さくら의 거야") */
const KANA_RATIO_LIMIT = 0.2;

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

/** 칸 하나의 문제를 판정합니다. 문제가 없으면 null */
export function assessCell(result: GridTranslationResult | undefined): CellIssue | null {
  if (!result) return 'missing';
  const translated = (result.translated_text ?? '').trim();
  const original = stripFurigana(result.original_text ?? '').trim();

  // 원문도 번역도 없으면 글자가 없는 칸(그림을 글자로 잘못 잡은 자리) → 재요청하지 않고 자동 삭제에 맡김
  if (!translated) return HAS_LETTER.test(original) ? 'empty' : null;

  const hangul = count(translated, HANGUL);
  const kana = count(translated, KANA);
  const kanji = count(translated, KANJI);

  // 한국어가 한 글자도 없이 일본어만 있음 (원문을 그대로 베낀 경우)
  if (hangul === 0 && kana + kanji > 0) return 'untranslated';
  // 한국어 사이에 일본어가 눈에 띄게 남음
  if (kana >= 2 && kana / (kana + hangul) >= KANA_RATIO_LIMIT) return 'japanese_left';
  return null;
}

/** 번역문 앞에 새어 나온 분류 태그 제거 (재요청 없이 바로 고칠 수 있는 실수) */
export function stripTypeTags(text: string): string {
  return text.replace(/^\s*[[【](대사|효과음|지문|배경|지문\/배경|내레이션|생각)[\]】]\s*/, '');
}

/** 같은 칸에 대한 두 결과 중 문제가 덜한 쪽. 같으면 원래 것을 유지 */
export function pickBetter(current: GridTranslationResult | undefined, candidate: GridTranslationResult | undefined) {
  const rank = (r: GridTranslationResult | undefined) => {
    const issue = assessCell(r);
    return issue ? SEVERITY[issue] : 0;
  };
  return rank(candidate) < rank(current) ? candidate : current;
}

export interface QualityReport {
  /** 검사한 칸 수 */
  checked: number;
  /** 문제 유형별 칸 수 (재요청 전) */
  issues: Partial<Record<CellIssue, number>>;
  /** 재요청 후 문제가 풀린 칸 수 */
  fixed: number;
  /** 재요청 자체가 실패했는지 (원래 결과는 그대로 사용) */
  retryFailed: boolean;
}

/**
 * 첫 응답을 검사하고, 문제 칸만 모아 한 번 더 요청해 더 나은 결과로 합칩니다.
 * @param retry 문제 칸 목록(칸 번호 순)을 받아, 그 순서대로 1번부터 번호를 매긴 결과를 돌려주는 함수
 */
export async function applyQualityRetry(
  translations: GridTranslationResult[],
  cells: GridCellInfo[],
  retry: (failed: GridCellInfo[]) => Promise<GridTranslationResult[]>,
): Promise<{ translations: GridTranslationResult[]; report: QualityReport }> {
  // 같은 칸 번호가 두 번 오면 첫 번째만 사용 (중복 번역 방지 규칙과 동일)
  const byId = new Map<number, GridTranslationResult>();
  for (const t of translations) {
    if (!byId.has(t.id)) byId.set(t.id, { ...t, translated_text: stripTypeTags(t.translated_text ?? '') });
  }

  const report: QualityReport = { checked: cells.length, issues: {}, fixed: 0, retryFailed: false };
  const failed = [...cells]
    .sort((a, b) => a.id - b.id)
    .filter(cell => {
      const issue = assessCell(byId.get(cell.id));
      if (issue) report.issues[issue] = (report.issues[issue] ?? 0) + 1;
      return issue !== null;
    });

  if (failed.length > 0) {
    try {
      const retried = await retry(failed);
      const retriedById = new Map<number, GridTranslationResult>();
      for (const t of retried) if (!retriedById.has(t.id)) retriedById.set(t.id, t);

      failed.forEach((cell, index) => {
        const candidate = retriedById.get(index + 1);
        const next = candidate && { ...candidate, id: cell.id, translated_text: stripTypeTags(candidate.translated_text ?? '') };
        const chosen = pickBetter(byId.get(cell.id), next);
        if (chosen) byId.set(cell.id, chosen);
        if (assessCell(byId.get(cell.id)) === null) report.fixed++;
      });
    } catch (error) {
      console.warn('품질 검사 재요청 실패 — 첫 번째 결과를 그대로 사용합니다:', (error as Error)?.message ?? error);
      report.retryFailed = true;
    }
  }

  return { translations: [...byId.values()].sort((a, b) => a.id - b.id), report };
}
