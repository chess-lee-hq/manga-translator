/**
 * API 토큰 사용량을 모아 콘솔에 남깁니다. (토큰 소모량 점검용)
 * 브라우저 콘솔에서 `__mangaTokenUsage` 로 누적치를 바로 볼 수 있습니다.
 *
 * cachedInputTokens는 "프롬프트 앞부분이 이전 요청과 같아서 싸게 계산된 입력 토큰"입니다.
 * 프롬프트 순서를 고정 → 준고정 → 매번 바뀜 순으로 배치한 효과가 여기에 그대로 드러납니다. (translationPrompt.ts 참고)
 */
export type UsageProvider = 'gemini' | 'openai';

export interface ProviderUsage {
  calls: number;
  inputTokens: number;
  /** inputTokens 중 캐시가 걸려 할인된 분량 */
  cachedInputTokens: number;
  outputTokens: number;
}

const emptyUsage = (): ProviderUsage => ({ calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });

const totals: Record<UsageProvider, ProviderUsage> = {
  gemini: emptyUsage(),
  openai: emptyUsage(),
};

export function recordUsage(provider: UsageProvider, label: string, inputTokens: number, outputTokens: number, cachedInputTokens = 0) {
  const total = totals[provider];
  total.calls += 1;
  total.inputTokens += inputTokens;
  total.cachedInputTokens += cachedInputTokens;
  total.outputTokens += outputTokens;
  const cachedNow = cachedInputTokens > 0 ? ` (캐시 ${cachedInputTokens})` : '';
  const cachedTotal = total.cachedInputTokens > 0 ? ` / 캐시 ${total.cachedInputTokens}` : '';
  console.debug(
    `[tokens] ${provider} · ${label} — 입력 ${inputTokens}${cachedNow} / 출력 ${outputTokens}`
    + ` (누적 ${total.calls}회, 입력 ${total.inputTokens}${cachedTotal} / 출력 ${total.outputTokens})`,
  );
}

export function getUsageTotals(): Record<UsageProvider, ProviderUsage> {
  return { gemini: { ...totals.gemini }, openai: { ...totals.openai } };
}

export function resetUsageTotals() {
  for (const provider of Object.keys(totals) as UsageProvider[]) {
    totals[provider] = emptyUsage();
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as { __mangaTokenUsage: unknown }).__mangaTokenUsage = totals;
}
