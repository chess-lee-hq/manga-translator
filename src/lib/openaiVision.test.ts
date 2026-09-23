import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from './testing/memoryStorage';

vi.stubGlobal('localStorage', new MemoryStorage());
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
      okResponse(JSON.stringify({ cells: [{ id: 1, jp: 'あ', ko: '가' }] })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const results = await translateGridImageOpenAI('terra', 'sk-test', 'data:image/jpeg;base64,GRID', 1);

    const body = sentBody(fetchMock);
    expect(body.model).toBe('gpt-5.6-terra');
    expect(body.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,GRID', detail: 'high' } });
    expect(results).toEqual([{ id: 1, original_text: 'あ', translated_text: '가' }]);
    // 요청은 이 한 번뿐 (다른 엔진을 거치지 않음)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getUsageTotals().openai).toEqual({ calls: 1, inputTokens: 1200, cachedInputTokens: 0, outputTokens: 90, reasoningTokens: 0 });
    expect(getUsageTotals().gemini.calls).toBe(0);
  });

  it('단어장과 앞 페이지 맥락을 프롬프트에 함께 싣는다 (Gemini와 동일한 지침)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"cells":[]}'));
    vi.stubGlobal('fetch', fetchMock);

    await translateGridImageOpenAI('sol', 'sk-test', 'data:image/jpeg;base64,GRID', 3,
      { glossary: { 拳王: '권왕' }, context: '# 앞 페이지 맥락\n- 주인공은 반말을 쓴다' });

    const prompt = sentPrompt(fetchMock);
    expect(prompt).toContain('拳王 -> 권왕');
    expect(prompt).toContain('주인공은 반말을 쓴다');
    expect(prompt).toContain('번역 지침');
    // 응답 형태는 json_schema(strict)가 강제하므로 프롬프트에는 각 필드의 뜻만 짧게 남는다
    expect(prompt).toContain('jp = 일본어 원문');
    expect(sentBody(fetchMock).response_format.json_schema.schema.properties.cells.items.required).toEqual(['id', 'jp', 'ko']);
    expect(sentBody(fetchMock).model).toBe('gpt-6-sol');
  });

  it.each([
    ['terra', 'gpt-5.6-terra'],
    ['sol', 'gpt-6-sol'],
    ['luna', 'gpt-6-luna'],
  ] as const)('헤더에서 고른 %s는 %s 모델로 보낸다 (세대가 섞여 있어 표로 매핑)', async (version, model) => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"cells":[]}'));
    vi.stubGlobal('fetch', fetchMock);
    await translateGridImageOpenAI(version, 'sk-test', 'data:image/jpeg;base64,GRID', 1);
    expect(sentBody(fetchMock).model).toBe(model);
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
      { box: [100, 100, 200, 300], jp: 'い', ko: '왼쪽 위' },
      { box: [100, 700, 200, 900], jp: 'あ', ko: '오른쪽 위' },
    ];
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify({ cells })));
    vi.stubGlobal('fetch', fetchMock);

    const results = await translateFullPageOpenAI('luna', 'sk-test', 'data:image/jpeg;base64,PAGE');

    // 오른쪽 위부터 읽어야 함
    expect(results.map(r => r.translated_text)).toEqual(['오른쪽 위', '왼쪽 위']);
    expect(sentPrompt(fetchMock)).toContain('box = 영역 좌표');
  });
});

describe('작품 노트·문장 재번역도 같은 엔진으로 처리한다', () => {
  beforeEach(() => {
    resetUsageTotals();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('작품 노트와 단어장 후보를 요청 한 번으로 받는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"notes":"- 주인공: 반말","glossary":[{"original":"雷神流","translated":"뇌신류"}]}'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await summarizeWorkNotesOpenAI('luna', 'sk-test', [{ original: 'あ', translated: '가' }], '- 기존 노트', '', ['リョウ']);

    expect(result).toEqual({ notes: '- 주인공: 반말', glossary: [{ original: '雷神流', translated: '뇌신류' }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody(fetchMock).response_format.type).toBe('json_schema');
    expect(sentBody(fetchMock).response_format.json_schema.strict).toBe(true);
    const prompt = sentPrompt(fetchMock);
    expect(prompt).toContain('기존 노트');
    expect(prompt).toContain('이미 단어장에 있는 원문은 제외: リョウ');
  });

  it('모델이 JSON 형식을 어기면 응답 전체를 노트로 쓴다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('- 주인공: 반말')));
    expect(await summarizeWorkNotesOpenAI('luna', 'sk-test', [{ original: 'あ', translated: '가' }])).toEqual({ notes: '- 주인공: 반말', glossary: [] });
  });

  it('대사가 없으면 요청하지 않고 기존 노트를 유지한다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await summarizeWorkNotesOpenAI('luna', 'sk-test', [], '- 기존 노트')).toEqual({ notes: '- 기존 노트', glossary: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('문장 재번역은 원문에 등장하는 단어장만 싣는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('권왕이다'));
    vi.stubGlobal('fetch', fetchMock);

    await retranslateTextOpenAI('luna', 'sk-test', '拳王だ', { glossary: { 拳王: '권왕', 南斗: '남두' } });

    const prompt = sentPrompt(fetchMock);
    expect(prompt).toContain('拳王 -> 권왕');
    expect(prompt).not.toContain('南斗');
  });
});

describe('추론 줄이기 (reasoning_effort)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetUsageTotals();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('꺼져 있으면 reasoning_effort를 보내지 않고, 추론 토큰은 따로 기록한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('번역', {
      prompt_tokens: 100, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 30 },
    } as any));
    vi.stubGlobal('fetch', fetchMock);
    await retranslateTextOpenAI('terra', 'sk-test', '原文');
    expect(sentBody(fetchMock).reasoning_effort).toBeUndefined();
    expect(getUsageTotals().openai.reasoningTokens).toBe(30);
  });

  it('켜면 low로 보내고, 모델이 거절하면 기억해 두고 설정 없이 다시 보낸다', async () => {
    localStorage.setItem('manga-reduce-reasoning', 'true');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 400, headers: new Headers(),
        text: async () => '{"error":{"message":"Unsupported parameter: \'reasoning_effort\'"}}',
      })
      .mockResolvedValue(okResponse('번역'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await retranslateTextOpenAI('terra', 'sk-test', '原文')).toBe('번역');
    expect(sentBody(fetchMock, 0).reasoning_effort).toBe('low');
    expect(sentBody(fetchMock, 1).reasoning_effort).toBeUndefined();

    await retranslateTextOpenAI('terra', 'sk-test', '原文');
    expect(sentBody(fetchMock, 2).reasoning_effort).toBeUndefined();
  });
});
