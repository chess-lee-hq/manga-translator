/**
 * API 토큰 사용량을 모읍니다. (헤더의 "사용량" 창과 콘솔 `[tokens]` 로그에 표시)
 * 브라우저 콘솔에서 `__mangaTokenUsage` 로 이번 세션 누적치를 바로 볼 수 있습니다.
 *
 * - cachedInputTokens: 프롬프트 앞부분이 이전 요청과 같아서 싸게 계산된 입력 토큰
 *   (프롬프트를 고정 → 준고정 → 매번 바뀜 순으로 배치한 효과가 여기에 드러남. translationPrompt.ts 참고)
 * - reasoningTokens: 출력 토큰 중 모델이 답을 내기 전에 속으로 생각하는 데 쓴 토큰 (OpenAI 추론·Gemini thinking).
 *   원문 읽기·번역은 깊은 추론이 거의 필요 없어, 이 비중이 크면 "추론 줄이기"로 비용을 크게 줄일 수 있음
 *
 * 이번 세션 합계(메모리)와 작품별 누적(localStorage)을 모델별로 함께 쌓습니다.
 */
export type UsageProvider = 'gemini' | 'openai';

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  /** inputTokens 중 캐시가 걸려 할인된 분량 */
  cachedInputTokens: number;
  /** 추론 토큰 포함 */
  outputTokens: number;
  /** outputTokens 중 추론(생각)에 쓴 분량 */
  reasoningTokens: number;
}

export interface UsageRecord {
  provider: UsageProvider;
  model: string;
  /** 로그에 표시할 요청 이름 (격자 번역, 재요청 등) */
  label: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
}

const WORK_USAGE_PREFIX = 'manga-usage-work-';

const emptyUsage = (): UsageTotals => ({ calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 });

const byProvider: Record<UsageProvider, UsageTotals> = { gemini: emptyUsage(), openai: emptyUsage() };
let sessionByModel: Record<string, UsageTotals> = {};
/** 지금 열린 작품 (작품별 누적을 어디에 쌓을지). App이 작품이 바뀔 때 알려 줌 */
let currentWorkKey: string | null = null;
const listeners = new Set<() => void>();
/** useSyncExternalStore가 바뀐 줄 알 수 있도록 기록할 때마다 올림 */
let version = 0;

function add(target: UsageTotals, record: UsageRecord) {
  target.calls += 1;
  target.inputTokens += record.inputTokens;
  target.cachedInputTokens += record.cachedInputTokens ?? 0;
  target.outputTokens += record.outputTokens;
  target.reasoningTokens += record.reasoningTokens ?? 0;
}

function readWorkUsage(workKey: string): Record<string, UsageTotals> {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${WORK_USAGE_PREFIX}${workKey}`) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function notify() {
  version++;
  listeners.forEach(listener => listener());
}

export function recordUsage(record: UsageRecord) {
  const { provider, model, label } = record;
  add(byProvider[provider], record);
  add((sessionByModel[model] ??= emptyUsage()), record);

  if (currentWorkKey) {
    const work = readWorkUsage(currentWorkKey);
    add((work[model] = { ...emptyUsage(), ...work[model] }), record);
    try {
      localStorage.setItem(`${WORK_USAGE_PREFIX}${currentWorkKey}`, JSON.stringify(work));
    } catch {
      // 저장 공간이 부족해도 번역은 계속되어야 하므로 사용량 누적만 건너뜀
    }
  }

  const total = byProvider[provider];
  const cached = record.cachedInputTokens ? ` (캐시 ${record.cachedInputTokens})` : '';
  const reasoning = record.reasoningTokens ? ` (추론 ${record.reasoningTokens})` : '';
  console.debug(
    `[tokens] ${provider} · ${model} · ${label} — 입력 ${record.inputTokens}${cached} / 출력 ${record.outputTokens}${reasoning}`
    + ` (누적 ${total.calls}회, 입력 ${total.inputTokens} / 캐시 ${total.cachedInputTokens} / 출력 ${total.outputTokens} / 추론 ${total.reasoningTokens})`,
  );
  notify();
}

/** 이번 세션의 엔진별 합계 */
export function getUsageTotals(): Record<UsageProvider, UsageTotals> {
  return { gemini: { ...byProvider.gemini }, openai: { ...byProvider.openai } };
}

/** 모델별 합계 — session: 앱을 연 뒤부터 / work: 지금 작품에서 지금까지 */
export function getUsageByModel(scope: 'session' | 'work'): Record<string, UsageTotals> {
  if (scope === 'session') return structuredClone(sessionByModel);
  return currentWorkKey ? readWorkUsage(currentWorkKey) : {};
}

export function setUsageWork(workKey: string | null) {
  if (currentWorkKey === workKey) return;
  currentWorkKey = workKey;
  notify();
}

export function resetUsageTotals() {
  byProvider.gemini = emptyUsage();
  byProvider.openai = emptyUsage();
  sessionByModel = {};
  notify();
}

export function clearWorkUsage(workKey: string) {
  try {
    localStorage.removeItem(`${WORK_USAGE_PREFIX}${workKey}`);
  } catch {
    // 지울 게 없음
  }
  notify();
}

export function subscribeUsage(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getUsageVersion = () => version;

export function sumUsage(totals: Record<string, UsageTotals>): UsageTotals {
  return Object.values(totals).reduce((sum, t) => ({
    calls: sum.calls + (t.calls ?? 0),
    inputTokens: sum.inputTokens + (t.inputTokens ?? 0),
    cachedInputTokens: sum.cachedInputTokens + (t.cachedInputTokens ?? 0),
    outputTokens: sum.outputTokens + (t.outputTokens ?? 0),
    reasoningTokens: sum.reasoningTokens + (t.reasoningTokens ?? 0),
  }), emptyUsage());
}

/** 모델 단가 (미국 달러 / 100만 토큰). 모델마다 달라 사용자가 직접 넣음 */
export interface ModelPrice {
  input: number;
  /** 캐시된 입력 단가. 비우면 입력 단가로 계산 */
  cachedInput?: number;
  output: number;
}

const PRICES_KEY = 'manga-model-prices';

export function loadModelPrices(): Record<string, ModelPrice> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRICES_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveModelPrices(prices: Record<string, ModelPrice>) {
  try {
    localStorage.setItem(PRICES_KEY, JSON.stringify(prices));
  } catch {
    // 저장 못 해도 이번 화면에서는 계산됨
  }
}

/** 예상 비용(달러). 단가가 없으면 null */
export function estimateCost(totals: UsageTotals, price: ModelPrice | undefined): number | null {
  if (!price || !(price.input >= 0) || !(price.output >= 0)) return null;
  const cached = Math.min(totals.cachedInputTokens, totals.inputTokens);
  const fresh = totals.inputTokens - cached;
  return (fresh * price.input + cached * (price.cachedInput ?? price.input) + totals.outputTokens * price.output) / 1_000_000;
}

if (typeof window !== 'undefined') {
  (window as unknown as { __mangaTokenUsage: unknown }).__mangaTokenUsage = byProvider;
}
