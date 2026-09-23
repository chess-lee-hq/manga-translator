import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from './testing/memoryStorage';

vi.stubGlobal('localStorage', new MemoryStorage());
import {
  clearWorkUsage, estimateCost, getUsageByModel, getUsageTotals, recordUsage, resetUsageTotals, setUsageWork, sumUsage,
} from './usageLog';

const record = (model: string, inputTokens: number, outputTokens: number, extra: { cached?: number; reasoning?: number } = {}) =>
  recordUsage({
    provider: model.startsWith('gemini') ? 'gemini' : 'openai',
    model,
    label: '격자 번역',
    inputTokens,
    outputTokens,
    cachedInputTokens: extra.cached,
    reasoningTokens: extra.reasoning,
  });

describe('recordUsage', () => {
  beforeEach(() => {
    resetUsageTotals();
    setUsageWork(null);
    localStorage.clear();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('제공자별로 호출 수와 토큰을 누적한다', () => {
    record('gemini-3.6-flash', 1000, 50);
    record('gemini-3.6-flash', 500, 20, { reasoning: 10 });
    record('gpt-5.6-terra', 300, 100, { cached: 200 });

    expect(getUsageTotals()).toEqual({
      gemini: { calls: 2, inputTokens: 1500, cachedInputTokens: 0, outputTokens: 70, reasoningTokens: 10 },
      openai: { calls: 1, inputTokens: 300, cachedInputTokens: 200, outputTokens: 100, reasoningTokens: 0 },
    });
  });

  it('모델별로 나눠 쌓고, 합계를 낼 수 있다', () => {
    record('gpt-5.6-terra', 100, 10);
    record('gpt-6-sol', 200, 20, { reasoning: 5 });
    const byModel = getUsageByModel('session');
    expect(Object.keys(byModel).sort()).toEqual(['gpt-5.6-terra', 'gpt-6-sol']);
    expect(sumUsage(byModel)).toEqual({ calls: 2, inputTokens: 300, cachedInputTokens: 0, outputTokens: 30, reasoningTokens: 5 });
  });

  it('작품이 정해져 있으면 작품별 누적을 localStorage에 남기고, 세션을 초기화해도 유지된다', () => {
    setUsageWork('작품a');
    record('gpt-5.6-terra', 100, 10);
    setUsageWork('작품b');
    record('gpt-5.6-terra', 50, 5);
    resetUsageTotals();

    expect(getUsageByModel('session')).toEqual({});
    setUsageWork('작품a');
    expect(getUsageByModel('work')['gpt-5.6-terra'].inputTokens).toBe(100);
    clearWorkUsage('작품a');
    expect(getUsageByModel('work')).toEqual({});
  });

  it('초기화하면 0으로 돌아간다', () => {
    record('gpt-5.6-terra', 10, 5);
    resetUsageTotals();
    expect(getUsageTotals().openai).toEqual({ calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 });
  });
});

describe('estimateCost', () => {
  const totals = { calls: 1, inputTokens: 1_000_000, cachedInputTokens: 400_000, outputTokens: 100_000, reasoningTokens: 0 };

  it('캐시된 입력은 캐시 단가로, 나머지는 입력 단가로 계산한다', () => {
    expect(estimateCost(totals, { input: 2, cachedInput: 0.5, output: 10 })).toBeCloseTo(0.6 * 2 + 0.4 * 0.5 + 0.1 * 10);
  });

  it('캐시 단가가 없으면 입력 단가를 쓰고, 단가가 없으면 null', () => {
    expect(estimateCost(totals, { input: 1, output: 1 })).toBeCloseTo(1.1);
    expect(estimateCost(totals, undefined)).toBeNull();
  });
});
