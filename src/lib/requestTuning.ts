import { getErrorStatus } from './retry';

/**
 * "추론 줄이기" 설정 (사용량 창의 실험 옵션).
 *
 * 원문을 읽고 번역하는 일은 깊은 추론이 거의 필요 없는데, 추론형 모델은 답을 내기 전에 속으로 생각하는 토큰을
 * 출력 토큰으로 청구합니다. 이 설정을 켜면 OpenAI에는 reasoning_effort를 낮게, Gemini에는 thinking 예산을 0으로 보냅니다.
 *
 * 모델이 그 설정을 지원하지 않으면(400 오류) 그 모델은 기억해 두고 설정 없이 다시 보내므로, 켜 둬도 번역이 멈추지 않습니다.
 */
const ENABLED_KEY = 'manga-reduce-reasoning';
const UNSUPPORTED_KEY = 'manga-reasoning-unsupported';

/** OpenAI reasoning_effort 값 — 가장 널리 지원되는 낮은 단계 */
export const LOW_REASONING_EFFORT = 'low';

export function isReduceReasoningEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setReduceReasoning(enabled: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, String(enabled));
  } catch {
    // 저장 못 하면 이번 세션만 꺼진 채로 동작
  }
}

function loadUnsupported(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(UNSUPPORTED_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

/** 이 모델에 추론 줄이기 설정을 실어 보낼지 */
export function shouldReduceReasoning(model: string): boolean {
  return isReduceReasoningEnabled() && !loadUnsupported().includes(model);
}

export function markReasoningControlUnsupported(model: string) {
  const list = loadUnsupported();
  if (list.includes(model)) return;
  try {
    localStorage.setItem(UNSUPPORTED_KEY, JSON.stringify([...list, model]));
  } catch {
    // 기억 못 해도 이번 요청은 설정 없이 다시 보냄
  }
  console.info(`[reasoning] ${model}은(는) 추론 줄이기 설정을 지원하지 않아 앞으로 이 모델에는 보내지 않습니다.`);
}

export function listReasoningUnsupportedModels(): string[] {
  return loadUnsupported();
}

/** 모델이 "그런 설정은 모른다"며 거절한 오류인지 (파라미터 이름이 오류 문구에 들어 있는 400) */
export function isUnsupportedParameterError(error: unknown, parameter: string): boolean {
  const message = String((error as Error)?.message ?? error).toLowerCase();
  return getErrorStatus(error) === 400 && message.includes(parameter.toLowerCase());
}

/**
 * OpenAI prompt_cache_key: 앞부분이 같은 요청들에 같은 키를 달면 같은 서버로 보내져 프롬프트 캐시 적중률이 올라갑니다.
 * 같은 작품의 요청은 지침·단어장·작품 노트가 같으므로 "작품 + 이미지 여부"로 묶습니다.
 * 모델이 이 설정을 모르면(400) 기억해 두고 설정 없이 다시 보냅니다. (추론 줄이기와 같은 방식)
 */
const CACHE_KEY_UNSUPPORTED_KEY = 'manga-cache-key-unsupported';
let promptCacheScope: string | null = null;

/** 지금 열린 작품 (App이 작품이 바뀔 때 알려 줌) */
export function setPromptCacheScope(workKey: string | null) {
  promptCacheScope = workKey;
}

/** 작품 이름을 그대로 보내지 않도록 짧은 해시로 (FNV-1a 32비트) */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function loadCacheKeyUnsupported(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY_UNSUPPORTED_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

/** 이 요청에 붙일 prompt_cache_key. 모델이 지원하지 않는다고 기억해 둔 경우 undefined */
export function promptCacheKeyFor(model: string, kind: 'vision' | 'text'): string | undefined {
  if (loadCacheKeyUnsupported().includes(model)) return undefined;
  return `manga-${kind}-${shortHash(promptCacheScope ?? 'none')}`;
}

export function markPromptCacheKeyUnsupported(model: string) {
  const list = loadCacheKeyUnsupported();
  if (list.includes(model)) return;
  try {
    localStorage.setItem(CACHE_KEY_UNSUPPORTED_KEY, JSON.stringify([...list, model]));
  } catch {
    // 기억 못 해도 이번 요청은 설정 없이 다시 보냄
  }
  console.info(`[cache] ${model}은(는) prompt_cache_key를 지원하지 않아 앞으로 이 모델에는 보내지 않습니다.`);
}

/**
 * GPT-5.6 이후 모델의 캐시 지점 제어 (prompt_cache_options.mode = explicit + prompt_cache_breakpoint).
 * 기본(implicit)은 "마지막 user 메시지 끝"에 캐시 지점을 잡아, 이미지까지 포함한 요청 전체를 1.25배 단가로 캐시에 쓰고
 * 다음 요청(다른 이미지)은 그걸 다시 쓰지 못함. 그래서 고정 부분(지침·단어장·노트) 끝에만 지점을 찍고 자동 지점은 끔.
 * 모델이 모르는 설정이면(400) 기억해 두고 빼서 다시 보냄.
 */
const BREAKPOINT_UNSUPPORTED_KEY = 'manga-cache-breakpoint-unsupported';

function loadList(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

export const shouldUseCacheBreakpoints = (model: string) => !loadList(BREAKPOINT_UNSUPPORTED_KEY).includes(model);

export function markCacheBreakpointsUnsupported(model: string) {
  const list = loadList(BREAKPOINT_UNSUPPORTED_KEY);
  if (list.includes(model)) return;
  try {
    localStorage.setItem(BREAKPOINT_UNSUPPORTED_KEY, JSON.stringify([...list, model]));
  } catch {
    // 기억 못 해도 이번 요청은 설정 없이 다시 보냄
  }
  console.info(`[cache] ${model}은(는) 캐시 지점 설정을 지원하지 않아 앞으로 이 모델에는 보내지 않습니다.`);
}
