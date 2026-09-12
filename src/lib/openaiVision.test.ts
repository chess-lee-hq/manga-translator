import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retranslateTextOpenAI, summarizeWorkNotesOpenAI, translateFullPageOpenAI, translateGridImageOpenAI } from './openai';
import { getUsageTotals, resetUsageTotals } from './usageLog';

const okResponse = (content: string, usage = { prompt_tokens: 1200, completion_tokens: 90 }) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }], usage }),
});

const sentBody = (fetchMock: any, call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);
const sentPrompt = (fetchMock: any, call = 0) => {
  const content = sentBody(fetchMock, call).messages[0].content;
  return Array.isArray(content) ? content[0].text : content;
};

describe('translateGridImageOpenAI (주력 엔진)', () => {
  beforeEach(() => {
    resetUsageTotals();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('격자 이미지를 직접 보내고 칸별 원문·번역을 한 번에 받는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse(JSON.stringify({ cells: [{ id: 1, original_text: 'あ', translated_text: '가' }] })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const results = await translateGridImageOpenAI('terra', 'sk-test', 'data:image/jpeg;base64,GRID', 1);

    const body = sentBody(fetchMock);
    expect(body.model).toBe('gpt-5.6-terra');
    expect(body.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,GRID', detail: 'high' } });
    expect(results).toEqual([{ id: 1, original_text: 'あ', translated_text: '가' }]);
    // 요청은 이 한 번뿐 (다른 엔진을 거치지 않음)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getUsageTotals().openai).toEqual({ calls: 1, inputTokens: 1200, outputTokens: 90 });
    expect(getUsageTotals().gemini.calls).toBe(0);
  });

  it('단어장과 앞 페이지 맥락을 프롬프트에 함께 싣는다 (Gemini와 동일한 지침)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"cells":[]}'));
    vi.stubGlobal('fetch', fetchMock);

    await translateGridImageOpenAI('sol', 'sk-test', 'data:image/jpeg;base64,GRID', 3,
      { 拳王: '권왕' }, '# 앞 페이지 맥락\n- 주인공은 반말을 쓴다');

    const prompt = sentPrompt(fetchMock);
    expect(prompt).toContain('拳王 -> 권왕');
    expect(prompt).toContain('주인공은 반말을 쓴다');
    expect(prompt).toContain('번역 지침');
    expect(prompt).toContain('cells');
    expect(sentBody(fetchMock).model).toBe('gpt-5.6-sol');
  });

  it('cells 키가 없으면 빈 배열을 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('{}')));
    expect(await translateGridImageOpenAI('sol', 'sk-test', 'data:image/jpeg;base64,GRID', 3)).toEqual([]);
  });
});

describe('translateFullPageOpenAI (말풍선을 못 찾았을 때)', () => {
  beforeEach(() => {
    resetUsageTotals();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('좌표를 함께 받아 일본 만화 읽는 순서로 정렬한다', async () => {
    const cells = [
      { box_2d: [100, 100, 200, 300], original_text: 'い', translated_text: '왼쪽 위' },
      { box_2d: [100, 700, 200, 900], original_text: 'あ', translated_text: '오른쪽 위' },
    ];
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify({ cells })));
    vi.stubGlobal('fetch', fetchMock);

    const results = await translateFullPageOpenAI('terra', 'sk-test', 'data:image/jpeg;base64,PAGE');

    // 오른쪽 위부터 읽어야 함
    expect(results.map(r => r.translated_text)).toEqual(['오른쪽 위', '왼쪽 위']);
    expect(sentPrompt(fetchMock)).toContain('box_2d');
  });
});

describe('작품 노트·문장 재번역도 같은 엔진으로 처리한다', () => {
  beforeEach(() => {
    resetUsageTotals();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('작품 노트를 OpenAI로 정리한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('- 주인공: 반말'));
    vi.stubGlobal('fetch', fetchMock);

    const notes = await summarizeWorkNotesOpenAI('terra', 'sk-test', [{ original: 'あ', translated: '가' }], '- 기존 노트');

    expect(notes).toBe('- 주인공: 반말');
    expect(sentPrompt(fetchMock)).toContain('기존 노트');
  });

  it('대사가 없으면 요청하지 않고 기존 노트를 유지한다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await summarizeWorkNotesOpenAI('terra', 'sk-test', [], '- 기존 노트')).toBe('- 기존 노트');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('문장 재번역은 원문에 등장하는 단어장만 싣는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('권왕이다'));
    vi.stubGlobal('fetch', fetchMock);

    await retranslateTextOpenAI('terra', 'sk-test', '拳王だ', { 拳王: '권왕', 南斗: '남두' });

    const prompt = sentPrompt(fetchMock);
    expect(prompt).toContain('拳王 -> 권왕');
    expect(prompt).not.toContain('南斗');
  });
});
