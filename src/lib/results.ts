import { TAG_SCALE_MAX, TAG_SCALE_MIN } from './bubbleDisplay';
import { normalizeEllipsis } from './ellipsis';
import type { TranslationResult } from './gemini';

function isValidBox(box: unknown): box is [number, number, number, number] {
  return Array.isArray(box) && box.length === 4 && box.every(n => typeof n === 'number' && Number.isFinite(n));
}

const DISPLAY_MODES = ['cover', 'tag'] as const;

function isValidTagPos(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(n => typeof n === 'number' && Number.isFinite(n));
}
const TEXT_DIRECTIONS = ['horizontal', 'vertical'] as const;

/**
 * localStorage·JSON·백업 ZIP에서 읽은 번역 배열을 검증합니다.
 * - 좌표(box_2d)가 깨진 항목은 렌더링 시 앱 전체를 멈추게 하므로 걸러냄
 * - 번역문이 비어 있는 항목(그림을 글자로 잘못 인식한 빈 자리)도 걸러냄
 * - 모든 항목에 id를 보장하고, 표시 설정은 알려진 값만 남김
 * - 번역문의 말줄임표(점 3개 이상·…)는 ".."로 통일 (새 번역·예전 기록·불러오기 모두)
 * 배열이 아니면 null을 반환합니다.
 */
export function sanitizeResults(value: unknown): TranslationResult[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((r): r is Partial<TranslationResult> => !!r && typeof r === 'object' && isValidBox((r as TranslationResult).box_2d))
    .filter(r => typeof r.translated_text === 'string' && r.translated_text.trim() !== '')
    .map(r => ({
      ...r,
      id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
      box_2d: r.box_2d as [number, number, number, number],
      original_text: typeof r.original_text === 'string' ? r.original_text : '',
      translated_text: normalizeEllipsis(r.translated_text as string),
      display_mode: DISPLAY_MODES.includes(r.display_mode as never) ? r.display_mode : undefined,
      text_direction: TEXT_DIRECTIONS.includes(r.text_direction as never) ? r.text_direction : undefined,
      tag_pos: isValidTagPos(r.tag_pos) ? r.tag_pos : undefined,
      tag_scale: typeof r.tag_scale === 'number' && Number.isFinite(r.tag_scale)
        ? Math.min(TAG_SCALE_MAX, Math.max(TAG_SCALE_MIN, r.tag_scale))
        : undefined,
      fit_bubble: typeof r.fit_bubble === 'boolean' ? r.fit_bubble : undefined,
    }));
}
