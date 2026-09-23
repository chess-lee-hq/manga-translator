/**
 * 사용자가 대본에서 직접 고친 번역을 작품별로 기억합니다.
 * 이후 번역 요청에 최근 교정 예시로 넣어, 모델이 같은 실수를 반복하지 않고 사용자가 원하는 방향을 따르게 합니다.
 */
import { stripFurigana } from './prompt';

export interface Correction {
  /** 일본어 원문 */
  original: string;
  /** AI가 처음 내놓은 번역 */
  before: string;
  /** 사용자가 고친 번역 */
  after: string;
  /** 마지막으로 고친 시각 (ISO) */
  at: string;
}

export const CORRECTIONS_PREFIX = 'manga-corrections-';
/** 작품 하나에 보관할 최대 개수 (오래된 것부터 버림) */
const MAX_STORED = 60;
/** 번역 요청에 넣을 최근 교정 수 */
// 교정은 작품 노트를 만들 때도 재료로 들어가므로(중복), 번역 프롬프트에는 가장 최근 것 몇 개만 싣는다
const MAX_IN_PROMPT = 3;
/** 프롬프트에 넣을 때 한 항목의 최대 글자 수 (긴 대사가 토큰을 잡아먹지 않게) */
const MAX_FIELD_CHARS = 80;
/** AI 번역이 아니라 화면 표시용 임시 문구 — 이걸 고친 건 교정이 아님 */
const PLACEHOLDERS = new Set(['', '...', '번역 중...', '번역 실패', '인식된 텍스트가 없습니다.']);

const correctionsKey = (workName: string) => `${CORRECTIONS_PREFIX}${workName || 'default'}`;

function isCorrection(value: unknown): value is Correction {
  const c = value as Correction;
  return !!c && typeof c.original === 'string' && typeof c.before === 'string' && typeof c.after === 'string';
}

export function loadCorrections(workName: string): Correction[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(correctionsKey(workName)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isCorrection).map(c => ({ ...c, at: typeof c.at === 'string' ? c.at : '' })) : [];
  } catch {
    return [];
  }
}

export function saveCorrections(workName: string, list: Correction[]) {
  try {
    if (list.length === 0) localStorage.removeItem(correctionsKey(workName));
    else localStorage.setItem(correctionsKey(workName), JSON.stringify(list));
  } catch (err) {
    console.warn('교정 기록 저장 실패:', err);
  }
}

/**
 * 교정 하나를 목록에 반영합니다. (최신이 앞)
 * - 같은 원문을 다시 고치면 처음 AI 번역(before)은 유지하고 수정본만 바꿈
 * - 결국 AI 번역과 같게 되돌렸으면 교정 기록에서 뺌
 * - 임시 문구를 고친 경우·내용이 그대로인 경우는 무시
 */
export function applyCorrection(list: Correction[], original: string, before: string, after: string, now = new Date()): Correction[] {
  const orig = original.trim();
  const prev = before.trim();
  const next = after.trim();
  if (!orig || orig === '...' || !next) return list;

  const existing = list.find(c => c.original === orig);
  const aiVersion = existing ? existing.before : prev;
  if (!existing && (PLACEHOLDERS.has(prev) || prev === next)) return list;

  const rest = list.filter(c => c.original !== orig);
  if (aiVersion === next) return rest; // AI 번역으로 되돌림
  return [{ original: orig, before: aiVersion, after: next, at: now.toISOString() }, ...rest].slice(0, MAX_STORED);
}

/** 백업에서 불러온 교정을 현재 목록에 합칩니다. 같은 원문은 더 최근에 고친 쪽을 남김 */
export function mergeCorrections(current: Correction[], incoming: Correction[]): Correction[] {
  const byOriginal = new Map<string, Correction>();
  for (const c of [...current, ...incoming].filter(isCorrection)) {
    const prev = byOriginal.get(c.original);
    if (!prev || (c.at || '') > (prev.at || '')) byOriginal.set(c.original, c);
  }
  return [...byOriginal.values()].sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, MAX_STORED);
}

const clip = (text: string) => (text.length > MAX_FIELD_CHARS ? `${text.slice(0, MAX_FIELD_CHARS)}…` : text);

/** 번역 프롬프트에 넣을 교정 예시 (최근 것부터) */
export function buildCorrectionSection(list: Correction[], max = MAX_IN_PROMPT): string {
  if (list.length === 0) return '';
  const lines = list.slice(0, max).map(c =>
    `- ${clip(stripFurigana(c.original))} : AI 번역 "${clip(c.before)}" → 사용자 수정 "${clip(c.after)}"`);
  return `## 사용자가 직접 고친 번역 (같은 실수를 반복하지 말고, 말투·표현·용어를 이 방향에 맞춰)\n${lines.join('\n')}`;
}
