import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUsageTotals, recordUsage, resetUsageTotals } from './usageLog';

describe('recordUsage', () => {
  beforeEach(() => {
    resetUsageTotals();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('제공자별로 호출 수와 토큰을 누적한다', () => {
    recordUsage('gemini', '격자 OCR', 1000, 50);
    recordUsage('gemini', '격자 OCR', 500, 20);
    recordUsage('openai', '번역', 300, 100);

    expect(getUsageTotals()).toEqual({
      gemini: { calls: 2, inputTokens: 1500, outputTokens: 70 },
      openai: { calls: 1, inputTokens: 300, outputTokens: 100 },
    });
  });

  it('초기화하면 0으로 돌아간다', () => {
    recordUsage('openai', '번역', 10, 5);
    resetUsageTotals();
    expect(getUsageTotals().openai).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0 });
  });
});
