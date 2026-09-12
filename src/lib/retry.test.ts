import { describe, expect, it, vi } from 'vitest';
import { assertHeaderSafeApiKey, computeBackoffMs, getErrorStatus, isRetryableError, toFriendlyError, withRetry } from './retry';

const httpError = (status: number, message = `Error ${status}`) => Object.assign(new Error(message), { status });

describe('assertHeaderSafeApiKey', () => {
  it('보통 API 키는 통과시킨다', () => {
    expect(() => assertHeaderSafeApiKey('sk-proj-abcDEF123-_.', 'OpenAI')).not.toThrow();
  });

  it('한글 등 ISO-8859-1을 벗어난 문자가 섞이면 알아보기 쉬운 오류로 막는다 (붙여넣기 사고 방지)', () => {
    expect(() => assertHeaderSafeApiKey('sk-abc한글섞임', 'OpenAI'))
      .toThrow(/OpenAI API 키에 입력할 수 없는 문자/);
    expect(() => assertHeaderSafeApiKey('AIzaSy가짜키', 'Gemini'))
      .toThrow(/Gemini API 키에 입력할 수 없는 문자/);
  });
});

describe('isRetryableError', () => {
  it('429·5xx·네트워크 오류는 재시도한다', () => {
    expect(isRetryableError(httpError(429))).toBe(true);
    expect(isRetryableError(httpError(503))).toBe(true);
    expect(isRetryableError(new Error('got status: 503 Service Unavailable'))).toBe(true);
    expect(isRetryableError(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'))).toBe(true);
    expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('잘못된 요청·키 오류·결제 한도 소진은 재시도하지 않는다', () => {
    expect(isRetryableError(httpError(400, 'API key not valid'))).toBe(false);
    expect(isRetryableError(httpError(401))).toBe(false);
    expect(isRetryableError(httpError(429, 'OpenAI API Error 429: {"error":{"code":"insufficient_quota"}}'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('재시도 가능한 오류는 백오프 후 다시 시도해 성공한다', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn()
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, { sleep, random: () => 1, baseDelayMs: 1000 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(call => call[0])).toEqual([1000, 2000]);
  });

  it('재시도할 수 없는 오류는 바로 던진다', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn().mockRejectedValue(httpError(400));
    await expect(withRetry(fn, { sleep })).rejects.toThrow('Error 400');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('재시도 횟수를 넘기면 마지막 오류를 던진다', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn().mockRejectedValue(httpError(429));
    await expect(withRetry(fn, { sleep, retries: 2 })).rejects.toThrow('Error 429');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('Retry-After 값을 우선 사용한다', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn().mockRejectedValueOnce(Object.assign(httpError(429), { retryAfterMs: 7000 })).mockResolvedValue(1);
    await withRetry(fn, { sleep });
    expect(sleep).toHaveBeenCalledWith(7000);
  });
});

describe('computeBackoffMs', () => {
  it('지수적으로 늘어나고 최대값을 넘지 않는다', () => {
    expect(computeBackoffMs(1, 2000, 20000, () => 0)).toBe(1000);
    expect(computeBackoffMs(3, 2000, 20000, () => 1)).toBe(8000);
    expect(computeBackoffMs(10, 2000, 20000, () => 1)).toBe(20000);
  });
});

describe('toFriendlyError / getErrorStatus', () => {
  it('상태별 안내 메시지를 만든다', () => {
    expect(toFriendlyError(httpError(429), 'Gemini').message).toContain('요청 한도 초과');
    expect(toFriendlyError(new Error('got status: 503'), 'Gemini').message).toContain('서버 과부하');
    expect(toFriendlyError(httpError(400, 'API key not valid. Please pass a valid API key.'), 'Gemini').message).toContain('API 키');
    expect(toFriendlyError(httpError(429, 'insufficient_quota'), 'OpenAI').message).toContain('크레딧');
    const other = new Error('something else');
    expect(toFriendlyError(other, 'Gemini')).toBe(other);
  });

  it('메시지에서 상태 코드를 읽는다', () => {
    expect(getErrorStatus(new Error('OpenAI API Error 502: bad gateway'))).toBe(502);
  });
});
