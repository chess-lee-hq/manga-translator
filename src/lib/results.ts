import type { TranslationResult } from './gemini';

function isValidBox(box: unknown): box is [number, number, number, number] {
  return Array.isArray(box) && box.length === 4 && box.every(n => typeof n === 'number' && Number.isFinite(n));
}

/**
 * localStorage·JSON·백업 ZIP에서 읽은 번역 배열을 검증합니다.
 * 좌표(box_2d)가 깨진 항목은 렌더링 시 앱 전체를 멈추게 하므로 걸러내고, 모든 항목에 id를 보장합니다.
 * 배열이 아니면 null을 반환합니다.
 */
export function sanitizeResults(value: unknown): TranslationResult[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((r): r is Partial<TranslationResult> => !!r && typeof r === 'object' && isValidBox((r as TranslationResult).box_2d))
    .map(r => ({
      ...r,
      id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
      box_2d: r.box_2d as [number, number, number, number],
      original_text: typeof r.original_text === 'string' ? r.original_text : '',
      translated_text: typeof r.translated_text === 'string' ? r.translated_text : '',
      display_mode: r.display_mode === 'cover' || r.display_mode === 'tag' ? r.display_mode : undefined,
    }));
}
