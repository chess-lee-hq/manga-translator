import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translateGridImageOpenAI } from './openai';
import { getUsageTotals, resetUsageTotals } from './usageLog';

const okResponse = (content: string, usage = { prompt_tokens: 1200, completion_tokens: 90 }) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }], usage }),
});

describe('translateGridImageOpenAI', () => {
  beforeEach(() => {
    resetUsageTotals();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('격자 이미지를 그대로 보내고 칸별 원문·번역을 돌려준다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse(JSON.stringify({ cells: [{ id: 1, original_text: 'あ', translated_text: '가' }] })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const results = await translateGridImageOpenAI('terra', 'sk-test', 'data:image/jpeg;base64,GRID', 1);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-5.6-terra');
    expect(body.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,GRID', detail: 'high' } });
    expect(results).toEqual([{ id: 1, original_text: 'あ', translated_text: '가' }]);
    // 토큰 사용량이 기록되어 콘솔에서 비교할 수 있어야 함
    expect(getUsageTotals().openai).toEqual({ calls: 1, inputTokens: 1200, outputTokens: 90 });
    expect(getUsageTotals().gemini.calls).toBe(0);
  });

  it('cells 키가 없으면 빈 배열을 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('{}')));
    expect(await translateGridImageOpenAI('sol', 'sk-test', 'data:image/jpeg;base64,GRID', 3)).toEqual([]);
  });
});
