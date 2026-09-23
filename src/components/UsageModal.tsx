import { useState, useSyncExternalStore } from 'react';
import { BarChart3, RotateCcw, X } from 'lucide-react';
import {
  clearWorkUsage, estimateCost, getUsageByModel, getUsageVersion, loadModelPrices, resetUsageTotals, saveModelPrices, subscribeUsage, sumUsage,
  type ModelPrice, type UsageTotals,
} from '../lib/usageLog';
import { isReduceReasoningEnabled, listReasoningUnsupportedModels, setReduceReasoning } from '../lib/requestTuning';

/** 사용량이 기록될 때마다 다시 그리도록 구독합니다. */
export function useUsageVersion() {
  return useSyncExternalStore(subscribeUsage, getUsageVersion);
}

/** 12345 → "12.3k" */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** 추론 토큰이 출력의 이 비율을 넘으면 "추론 줄이기"를 권함 */
const REASONING_WARN_RATIO = 0.3;

interface UsageModalProps {
  workKey: string;
  workTitle: string;
  onClose: () => void;
}

/**
 * 토큰 사용량 창: 이번 세션 / 이 작품 누적을 모델별로 보여주고, 단가를 넣으면 예상 비용도 계산합니다.
 * 추론(생각) 토큰 비중이 크면 "추론 줄이기"를 켤 수 있습니다.
 */
export function UsageModal({ workKey, workTitle, onClose }: UsageModalProps) {
  useUsageVersion();
  const [scope, setScope] = useState<'session' | 'work'>('session');
  const [prices, setPrices] = useState<Record<string, ModelPrice>>(loadModelPrices);
  const [reduceReasoning, setReduceReasoningState] = useState(isReduceReasoningEnabled);

  const byModel = getUsageByModel(scope);
  const models = Object.keys(byModel).sort();
  const total = sumUsage(byModel);
  const unsupported = listReasoningUnsupportedModels();
  const reasoningHeavy = total.outputTokens > 0 && total.reasoningTokens / total.outputTokens >= REASONING_WARN_RATIO;

  const costs = models.map(model => estimateCost(byModel[model], prices[model]));
  const knownCost = costs.filter((c): c is number => c !== null).reduce((sum, c) => sum + c, 0);
  const missingPrice = costs.some(c => c === null);

  const updatePrice = (model: string, field: keyof ModelPrice, raw: string) => {
    const value = raw.trim() === '' ? undefined : Number(raw);
    const current: ModelPrice = prices[model] ?? { input: NaN, output: NaN };
    const nextPrice = { ...current, [field]: value === undefined ? (field === 'cachedInput' ? undefined : NaN) : value };
    const next = { ...prices, [model]: nextPrice };
    setPrices(next);
    saveModelPrices(next);
  };

  const toggleReduceReasoning = () => {
    setReduceReasoning(!reduceReasoning);
    setReduceReasoningState(!reduceReasoning);
  };

  const reset = () => {
    if (scope === 'session') resetUsageTotals();
    else if (confirm(`「${workTitle}」의 누적 사용량 기록을 지울까요? (번역 기록은 그대로입니다)`)) clearWorkUsage(workKey);
  };

  const priceInput = (model: string, field: keyof ModelPrice, placeholder: string) => {
    const value = prices[model]?.[field];
    return (
      <input
        type="number"
        min="0"
        step="0.01"
        placeholder={placeholder}
        defaultValue={value !== undefined && Number.isFinite(value) ? value : ''}
        onChange={e => updatePrice(model, field, e.target.value)}
        className="w-14 px-1 py-0.5 border border-gray-200 rounded text-right text-xs"
      />
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sky-600">
            <BarChart3 size={22} />
            <h3 className="text-lg font-bold text-gray-800">토큰 사용량</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="닫기">
            <X size={22} />
          </button>
        </div>

        <div className="flex items-center justify-between mb-3">
          <div className="flex bg-gray-100 p-0.5 rounded-md border border-gray-200">
            {([['session', '이번 세션'], ['work', `이 작품 누적 「${workTitle}」`]] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setScope(value)}
                className={`px-3 py-1 rounded text-xs font-medium max-w-xs truncate ${scope === value ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button onClick={reset} disabled={models.length === 0} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 disabled:opacity-40">
            <RotateCcw size={12} /> 초기화
          </button>
        </div>

        {models.length === 0 ? (
          <p className="text-sm text-gray-500 py-8 text-center">아직 기록된 요청이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b">
                  <th className="text-left py-1.5 font-medium">모델</th>
                  <th className="text-right font-medium">요청</th>
                  <th className="text-right font-medium">입력</th>
                  <th className="text-right font-medium" title="입력 중 캐시가 걸려 할인된 비율">캐시</th>
                  <th className="text-right font-medium" title="추론(생각) 토큰 포함">출력</th>
                  <th className="text-right font-medium" title="출력 중 추론(생각)에 쓴 비율">추론</th>
                  <th className="text-right font-medium pl-3" title="100만 토큰당 달러: 입력 / 캐시 입력(비우면 입력 단가) / 출력">단가 $/1M (입력·캐시·출력)</th>
                  <th className="text-right font-medium pl-2">예상 비용</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model, i) => (
                  <UsageRow key={model} model={model} totals={byModel[model]} cost={costs[i]}>
                    {priceInput(model, 'input', '입력')}
                    {priceInput(model, 'cachedInput', '캐시')}
                    {priceInput(model, 'output', '출력')}
                  </UsageRow>
                ))}
                <tr className="border-t font-semibold text-gray-800">
                  <td className="py-1.5">합계</td>
                  <td className="text-right">{total.calls}</td>
                  <td className="text-right">{formatTokens(total.inputTokens)}</td>
                  <td className="text-right">{percent(total.cachedInputTokens, total.inputTokens)}%</td>
                  <td className="text-right">{formatTokens(total.outputTokens)}</td>
                  <td className="text-right">{percent(total.reasoningTokens, total.outputTokens)}%</td>
                  <td />
                  <td className="text-right pl-2">{knownCost > 0 || !missingPrice ? `$${knownCost.toFixed(3)}` : '—'}{missingPrice && knownCost > 0 ? '+' : ''}</td>
                </tr>
              </tbody>
            </table>
            {missingPrice && <p className="text-[11px] text-gray-400 mt-1">단가를 넣은 모델만 비용을 계산합니다. 단가는 각 서비스의 가격표를 보고 직접 넣어 주세요.</p>}
          </div>
        )}

        <div className={`mt-5 p-3 rounded-lg border ${reasoningHeavy ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={reduceReasoning} onChange={toggleReduceReasoning} className="mt-0.5" />
            <span className="text-xs text-gray-700">
              <b className="text-gray-800">추론 줄이기 (실험)</b> — 모델이 답하기 전에 속으로 생각하는 토큰을 줄입니다.
              원문 읽기·번역은 깊은 추론이 거의 필요 없어 출력 비용이 크게 줄 수 있지만, 어려운 장면의 번역 품질이 조금 떨어질 수 있습니다.
              지원하지 않는 모델은 자동으로 건너뜁니다.
              {reasoningHeavy && (
                <span className="block mt-1 text-amber-700">
                  지금 출력의 {percent(total.reasoningTokens, total.outputTokens)}%가 추론 토큰입니다. 켜 보면 비용이 눈에 띄게 줄 수 있습니다.
                </span>
              )}
              {unsupported.length > 0 && (
                <span className="block mt-1 text-gray-500">지원하지 않아 건너뛰는 모델: {unsupported.join(', ')}</span>
              )}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

function UsageRow({ model, totals, cost, children }: { model: string; totals: UsageTotals; cost: number | null; children: React.ReactNode }) {
  return (
    <tr className="border-b border-gray-100 text-gray-700">
      <td className="py-1.5 font-mono">{model}</td>
      <td className="text-right">{totals.calls}</td>
      <td className="text-right">{formatTokens(totals.inputTokens)}</td>
      <td className="text-right">{percent(totals.cachedInputTokens, totals.inputTokens)}%</td>
      <td className="text-right">{formatTokens(totals.outputTokens)}</td>
      <td className="text-right">{percent(totals.reasoningTokens ?? 0, totals.outputTokens)}%</td>
      <td className="text-right pl-3 whitespace-nowrap space-x-1">{children}</td>
      <td className="text-right pl-2">{cost === null ? '—' : `$${cost.toFixed(3)}`}</td>
    </tr>
  );
}
