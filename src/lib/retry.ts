export interface RetryInfo {
  attempt: number;
  delayMs: number;
  error: unknown;
}

export interface RetryOptions {
  /** 첫 시도 이후 추가로 재시도할 횟수 */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (info: RetryInfo) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

type ErrorLike = { name?: unknown; status?: unknown; code?: unknown; message?: unknown; retryAfterMs?: unknown };

function errorMessage(error: unknown): string {
  const message = (error as ErrorLike | null)?.message;
  return typeof message === 'string' ? message : String(error);
}

/** 오류 객체의 status, 또는 메시지 속 `status: 503` · `"code": 429` · `Error 429` 형태에서 HTTP 상태 코드를 찾습니다. */
export function getErrorStatus(error: unknown): number | undefined {
  const e = error as ErrorLike | null;
  if (typeof e?.status === 'number') return e.status;
  if (typeof e?.code === 'number') return e.code;
  const match = errorMessage(error).match(/(?:status(?:\s*code)?\s*[:=]?\s*|"code"\s*:\s*|Error\s+)(\d{3})\b/i);
  return match ? Number(match[1]) : undefined;
}

export function isRetryableError(error: unknown): boolean {
  if ((error as ErrorLike | null)?.name === 'AbortError') return false;
  const message = errorMessage(error);
  // 결제 한도 소진은 기다려도 풀리지 않음
  if (/insufficient_quota|billing/i.test(message)) return false;
  const status = getErrorStatus(error);
  if (status !== undefined) return RETRYABLE_STATUS.has(status);
  return /RESOURCE_EXHAUSTED|UNAVAILABLE|high demand|overloaded|rate limit|Failed to fetch|NetworkError|network error/i.test(message);
}

/** 지수 백오프 + jitter: 시도마다 대기 상한이 2배로 늘고, 그 절반~전체 사이에서 무작위로 기다립니다. */
export function computeBackoffMs(attempt: number, baseDelayMs: number, maxDelayMs: number, random: () => number = Math.random): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** 429(요청 한도)·5xx·네트워크 오류만 재시도합니다. 서버가 Retry-After를 주면 그 값을 우선합니다. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 2000, maxDelayMs = 20000, onRetry, sleep = defaultSleep, random = Math.random } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt > retries || !isRetryableError(error)) throw error;
      const retryAfterMs = (error as ErrorLike | null)?.retryAfterMs;
      const delayMs = typeof retryAfterMs === 'number' && retryAfterMs > 0
        ? Math.min(maxDelayMs, retryAfterMs)
        : computeBackoffMs(attempt, baseDelayMs, maxDelayMs, random);
      onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}

/** 최종 실패한 API 오류를 화면에 보여줄 한국어 안내로 바꿉니다. 해당하지 않으면 원래 오류를 그대로 돌려줍니다. */
export function toFriendlyError(error: unknown, providerLabel: string): Error {
  const message = errorMessage(error);
  const status = getErrorStatus(error);
  let friendly: string | null = null;
  if (/insufficient_quota/i.test(message)) {
    friendly = `${providerLabel} 크레딧(결제 한도)이 소진되었습니다. 결제 설정을 확인해주세요.`;
  } else if (status === 429 || /RESOURCE_EXHAUSTED|rate limit/i.test(message)) {
    friendly = `${providerLabel} 요청 한도 초과(429): 잠시 후 다시 시도하거나 자동 번역을 잠시 꺼주세요.`;
  } else if (status === 503 || /UNAVAILABLE|high demand|overloaded/i.test(message)) {
    friendly = `${providerLabel} 서버 과부하(503): 잠시 후 다시 시도해주세요.`;
  } else if (status === 401 || status === 403 || /API key not valid|invalid api key|incorrect api key/i.test(message)) {
    friendly = `${providerLabel} API 키가 올바르지 않거나 권한이 없습니다.`;
  }
  if (!friendly) return error instanceof Error ? error : new Error(message);
  return new Error(friendly, { cause: error });
}
