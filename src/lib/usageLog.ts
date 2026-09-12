/**
 * API 토큰 사용량을 모아 콘솔에 남깁니다. (토큰 소모량 점검용)
 * 브라우저 콘솔에서 `__mangaTokenUsage` 로 누적치를 바로 볼 수 있습니다.
 */
export type UsageProvider = 'gemini' | 'openai';

export interface ProviderUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

const totals: Record<UsageProvider, ProviderUsage> = {
  gemini: { calls: 0, inputTokens: 0, outputTokens: 0 },
  openai: { calls: 0, inputTokens: 0, outputTokens: 0 },
};

export function recordUsage(provider: UsageProvider, label: string, inputTokens: number, outputTokens: number) {
  const total = totals[provider];
  total.calls += 1;
  total.inputTokens += inputTokens;
  total.outputTokens += outputTokens;
  console.debug(
    `[tokens] ${provider} · ${label} — 입력 ${inputTokens} / 출력 ${outputTokens}`
    + ` (누적 ${total.calls}회, 입력 ${total.inputTokens} / 출력 ${total.outputTokens})`,
  );
}

export function getUsageTotals(): Record<UsageProvider, ProviderUsage> {
  return { gemini: { ...totals.gemini }, openai: { ...totals.openai } };
}

export function resetUsageTotals() {
  for (const provider of Object.keys(totals) as UsageProvider[]) {
    totals[provider] = { calls: 0, inputTokens: 0, outputTokens: 0 };
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as { __mangaTokenUsage: unknown }).__mangaTokenUsage = totals;
}
