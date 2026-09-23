import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from './testing/memoryStorage';

vi.stubGlobal('localStorage', new MemoryStorage());
import {
  isUnsupportedParameterError, listReasoningUnsupportedModels, markReasoningControlUnsupported, setReduceReasoning, shouldReduceReasoning,
} from './requestTuning';

describe('추론 줄이기 설정', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('꺼져 있으면 어떤 모델에도 보내지 않는다', () => {
    expect(shouldReduceReasoning('gpt-5.6-terra')).toBe(false);
  });

  it('켜면 보내되, 지원하지 않는다고 기억한 모델은 뺀다', () => {
    setReduceReasoning(true);
    expect(shouldReduceReasoning('gpt-5.6-terra')).toBe(true);
    markReasoningControlUnsupported('gpt-5.6-terra');
    markReasoningControlUnsupported('gpt-5.6-terra');
    expect(shouldReduceReasoning('gpt-5.6-terra')).toBe(false);
    expect(shouldReduceReasoning('gpt-6-sol')).toBe(true);
    expect(listReasoningUnsupportedModels()).toEqual(['gpt-5.6-terra']);
  });

  it('파라미터 이름이 담긴 400 오류만 "지원 안 함"으로 본다', () => {
    const unsupported = Object.assign(new Error("Unsupported parameter: 'reasoning_effort'"), { status: 400 });
    expect(isUnsupportedParameterError(unsupported, 'reasoning_effort')).toBe(true);
    expect(isUnsupportedParameterError(Object.assign(new Error('bad image'), { status: 400 }), 'reasoning_effort')).toBe(false);
    expect(isUnsupportedParameterError(Object.assign(new Error('reasoning_effort'), { status: 429 }), 'reasoning_effort')).toBe(false);
  });
});
