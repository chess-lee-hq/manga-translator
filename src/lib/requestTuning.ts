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
