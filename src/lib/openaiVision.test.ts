import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from './testing/memoryStorage';

vi.stubGlobal('localStorage', new MemoryStorage());
import { resetCacheWarmState, retranslateTextOpenAI, summarizeWorkNotesOpenAI, translateFullPageOpenAI, translateGridImageOpenAI } from './openai';
import { setPromptCacheScope } from './requestTuning';
import { getUsageByModel, getUsageTotals, resetUsageTotals } from './usageLog';

const okResponse = (content: string, usage = { prompt_tokens: 1200, completion_tokens: 90 }) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }], usage }),
});

/** 격자 번역 앞에 나가는 "캐시 준비" 요청은 빼고 본 요청만 (openai.ts ensureCacheWarm) */
const isWarmup = (call: any[]) => String(call[1]?.body ?? '').includes('캐시 준비용 요청');
const realCalls = (fetchMock: any) => fetchMock.mock.calls.filter((call: any[]) => !isWarmup(call));
const sentBody = (fetchMock: any, call = 0) => JSON.parse(realCalls(fetchMock)[call][1].body);
const sentPrompt = (fetchMock: any, call = 0) => {
  // 캐시 경계로 나눈 developer(고정)·user(매번) 메시지의 글을 이어 붙여 하나의 프롬프트로 봄
  return sentBody(fetchMock, call).messages
    .map((message: any) => (Array.isArray(message.content) ? message.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n') : message.content))
    .join('\n');
};
/** 이미지가 붙는 마지막 user 메시지 */
const userParts = (fetchMock: any, call = 0) => sentBody(fetchMock, call).messages.at(-1).content;

describe('translateGridImageOpenAI (주력 엔진)', () => {
  beforeEach(() => {
    resetUsageTotals();
    resetCacheWarmState();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('격자 이미지를 직접 보내고 칸별 원문·번역을 한 번에 받는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse(JSON.stringify({ cells: [{ id: 1, jp: 'あ', ko: '가' }] })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const results = await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,GRID'], 1);

    const body = sentBody(fetchMock);
    expect(body.model).toBe('gpt-5.6-terra');
    expect(body.messages.at(-1).content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,GRID', detail: 'high' } });
    expect(results).toEqual([{ id: 1, original_text: 'あ', translated_text: '가' }]);
    // 요청은 이 한 번뿐 (다른 엔진을 거치지 않음)
    expect(realCalls(fetchMock)).toHaveLength(1);
    // 캐시 준비 요청 1번 + 본 요청 1번
    expect(getUsageTotals().openai).toEqual({ calls: 2, inputTokens: 2400, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 180, reasoningTokens: 0 });
    expect(getUsageTotals().gemini.calls).toBe(0);
  });

  it('격자가 여러 장이면 한 요청에 순서대로 싣는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"cells":[]}'));
    vi.stubGlobal('fetch', fetchMock);
    await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,A', 'data:image/jpeg;base64,B'], 30);
    expect(realCalls(fetchMock)).toHaveLength(1);
    const images = userParts(fetchMock).slice(1).map((part: any) => part.image_url.url);
    expect(images).toEqual(['data:image/jpeg;base64,A', 'data:image/jpeg;base64,B']);
  });

  it('단어장과 앞 페이지 맥락을 프롬프트에 함께 싣는다 (Gemini와 동일한 지침)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"cells":[]}'));
    vi.stubGlobal('fetch', fetchMock);

    await translateGridImageOpenAI('sol', 'sk-test', ['data:image/jpeg;base64,GRID'], 3,
      { glossary: { 拳王: '권왕' }, context: '# 앞 페이지 맥락\n- 주인공은 반말을 쓴다' });

    const prompt = sentPrompt(fetchMock);
    expect(prompt).toContain('拳王 -> 권왕');
    expect(prompt).toContain('주인공은 반말을 쓴다');
    expect(prompt).toContain('번역 지침');
    // 응답 형태는 json_schema(strict)가 강제하므로 프롬프트에는 각 필드의 뜻만 짧게 남는다
    expect(prompt).toContain('jp = 일본어 원문');
    expect(sentBody(fetchMock).response_format.json_schema.schema.properties.cells.items.required).toEqual(['id', 'jp', 'ko']);
    expect(sentBody(fetchMock).model).toBe('gpt-6.1-sol');
  });

  it.each([
    ['terra', 'gpt-5.6-terra'],
    ['sol', 'gpt-6.1-sol'],
    ['luna', 'gpt-6-luna'],
  ] as const)('헤더에서 고른 %s는 %s 모델로 보낸다 (세대가 섞여 있어 표로 매핑)', async (version, model) => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"cells":[]}'));
    vi.stubGlobal('fetch', fetchMock);
    await translateGridImageOpenAI(version, 'sk-test', ['data:image/jpeg;base64,GRID'], 1);
    expect(sentBody(fetchMock).model).toBe(model);
  });

  it('cells 키가 없으면 빈 배열을 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('{}')));
    expect(await translateGridImageOpenAI('sol', 'sk-test', ['data:image/jpeg;base64,GRID'], 3)).toEqual([]);
  });
});

describe('translateFullPageOpenAI (말풍선을 못 찾았을 때)', () => {
  beforeEach(() => {
    resetUsageTotals();
    resetCacheWarmState();
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
    resetCacheWarmState();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('작품 노트와 단어장 후보를 요청 한 번으로 받는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"notes":"- 주인공: 반말","glossary":[{"original":"雷神流","translated":"뇌신류"}]}'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await summarizeWorkNotesOpenAI('luna', 'sk-test', [{ original: 'あ', translated: '가' }], '- 기존 노트', '', ['リョウ']);

    expect(result).toEqual({ notes: '- 주인공: 반말', glossary: [{ original: '雷神流', translated: '뇌신류' }] });
    expect(realCalls(fetchMock)).toHaveLength(1);
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
    resetCacheWarmState();
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

describe('격자 응답의 unsure 목록', () => {
  beforeEach(() => {
    resetUsageTotals();
    resetCacheWarmState();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('스키마가 unsure를 요구하고, 해당 칸에 표시가 붙는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify({ cells: [{ id: 1, jp: 'あ', ko: '가' }], unsure: [1] })));
    vi.stubGlobal('fetch', fetchMock);
    const results = await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,GRID'], 1);
    expect(sentBody(fetchMock).response_format.json_schema.schema.required).toEqual(['cells', 'unsure']);
    expect(results[0].unsure).toBe(true);
  });
});

describe('[실험] 장면 이미지 함께 보내기', () => {
  beforeEach(() => {
    resetUsageTotals();
    resetCacheWarmState();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('장면 이미지는 격자 뒤에 detail low로 붙이고, 사용량은 "모델 · 장면" 줄로 따로 집계한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"cells":[],"unsure":[]}'));
    vi.stubGlobal('fetch', fetchMock);
    await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,GRID'], 1, { sceneImages: ['data:image/jpeg;base64,SCENE'] });

    const content = userParts(fetchMock);
    expect(content.slice(1).map((part: any) => [part.image_url.url, part.image_url.detail])).toEqual([
      ['data:image/jpeg;base64,GRID', 'high'],
      ['data:image/jpeg;base64,SCENE', 'low'],
    ]);
    expect(sentPrompt(fetchMock)).toContain('장면 이미지');
    // 캐시 준비 요청(장면 이미지 없음)은 모델 이름 줄로, 본 요청은 '· 장면' 줄로
    expect(Object.keys(getUsageByModel('session'))).toContain('gpt-5.6-terra · 장면');
  });

  it('장면 이미지가 없으면 프롬프트에도 안내가 없고 모델 이름 그대로 집계한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"cells":[],"unsure":[]}'));
    vi.stubGlobal('fetch', fetchMock);
    await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,GRID'], 1);
    expect(sentPrompt(fetchMock)).not.toContain('장면 이미지');
    expect(Object.keys(getUsageByModel('session'))).toEqual(['gpt-5.6-terra']);
  });
});

describe('prompt_cache_key (같은 작품 요청을 같은 서버로)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetUsageTotals();
    resetCacheWarmState();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('같은 작품이면 같은 키, 다른 작품이면 다른 키를 보낸다 (작품 이름은 그대로 보내지 않음)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"cells":[],"unsure":[]}'));
    vi.stubGlobal('fetch', fetchMock);
    setPromptCacheScope('武田信玄');
    await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,A'], 1);
    await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,B'], 1);
    setPromptCacheScope('陽だまりの樹');
    await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,C'], 1);

    const keys = [0, 1, 2].map(i => sentBody(fetchMock, i).prompt_cache_key);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[0]).toMatch(/^manga-[0-9a-z]+$/);
    expect(keys[0]).not.toContain('武田');
  });

  it('모델이 거절하면 기억해 두고 빼서 다시 보낸다', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 400, headers: new Headers(),
        text: async () => '{"error":{"message":"Unrecognized request argument supplied: prompt_cache_key"}}',
      })
      .mockResolvedValue(okResponse('번역'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await retranslateTextOpenAI('terra', 'sk-test', '原文')).toBe('번역');
    expect(sentBody(fetchMock, 0).prompt_cache_key).toMatch(/^manga-[0-9a-z]+$/);
    expect(sentBody(fetchMock, 1).prompt_cache_key).toBeUndefined();
    await retranslateTextOpenAI('terra', 'sk-test', '原文');
    expect(sentBody(fetchMock, 2).prompt_cache_key).toBeUndefined();
  });
});

describe('캐시 경계 (GPT-5.6 이후: 고정 부분 끝에만 캐시 지점)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetUsageTotals();
    resetCacheWarmState();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('지침·단어장·노트는 developer 메시지 끝에 캐시 지점, 매번 바뀌는 글과 이미지는 user 메시지, 자동 지점은 끔', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"cells":[],"unsure":[]}'));
    vi.stubGlobal('fetch', fetchMock);
    await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,GRID'], 2, {
      glossary: { 拳王: '권왕' }, context: '## 작품 노트\n- 반말', recentContext: '## 직전까지의 번역\n- あ → 가',
    });
    const body = sentBody(fetchMock);
    expect(body.prompt_cache_options).toEqual({ mode: 'explicit' });
    const [developer, user] = body.messages;
    expect(developer.role).toBe('developer');
    expect(developer.content[0].prompt_cache_breakpoint).toEqual({ mode: 'explicit' });
    expect(developer.content[0].text).toContain('拳王 -> 권왕');
    expect(developer.content[0].text).toContain('## 작품 노트');
    expect(developer.content[0].text).not.toContain('직전까지의 번역');
    expect(user.role).toBe('user');
    expect(user.content[0].text).toContain('직전까지의 번역');
    expect(user.content[0].text).toContain('정확히 2개');
    expect(user.content[1].image_url.url).toBe('data:image/jpeg;base64,GRID');
  });

  it('같은 작품이면 developer 메시지가 글자 하나까지 같다 (그래야 캐시를 다시 씀)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"cells":[],"unsure":[]}'));
    vi.stubGlobal('fetch', fetchMock);
    const shared = { glossary: { 拳王: '권왕' }, context: '## 작품 노트' };
    await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,A'], 3, { ...shared, recentContext: '- 1', pageCellCounts: [1, 2] });
    await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,B'], 5, { ...shared, recentContext: '- 2', sceneImages: ['data:image/jpeg;base64,S'] });
    expect(sentBody(fetchMock, 1).messages[0]).toEqual(sentBody(fetchMock, 0).messages[0]);
  });

  it('모델이 캐시 지점 설정을 거절하면 기억해 두고 빼서 다시 보낸다', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 400, headers: new Headers(),
        text: async () => '{"error":{"message":"Unknown parameter: prompt_cache_options"}}',
      })
      .mockResolvedValue(okResponse('{"cells":[],"unsure":[]}'));
    vi.stubGlobal('fetch', fetchMock);

    // 페이지 전체 인식은 캐시 준비 없이 바로 보냄
    await translateFullPageOpenAI('terra', 'sk-test', 'data:image/jpeg;base64,A');
    const retried = sentBody(fetchMock, 1);
    expect(retried.prompt_cache_options).toBeUndefined();
    expect(retried.messages[0].content[0].prompt_cache_breakpoint).toBeUndefined();
    expect(retried.messages[0].role).toBe('developer');

    await translateFullPageOpenAI('terra', 'sk-test', 'data:image/jpeg;base64,B');
    expect(sentBody(fetchMock, 2).prompt_cache_options).toBeUndefined();
  });

  it('캐시에 새로 쓴 토큰을 따로 기록한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"cells":[],"unsure":[]}', {
      prompt_tokens: 2000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 1400 },
    } as any));
    vi.stubGlobal('fetch', fetchMock);
    await translateFullPageOpenAI('terra', 'sk-test', 'data:image/jpeg;base64,A');
    expect(getUsageTotals().openai.cacheWriteTokens).toBe(1400);
  });
});

describe('캐시 준비 (이미지 요청은 캐시에 쓰지 않으므로 글만 있는 요청으로 먼저 써 둠)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetUsageTotals();
    resetCacheWarmState();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  const reply = (cached: number) => okResponse('{"cells":[],"unsure":[]}', {
    prompt_tokens: 3000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: cached },
  } as any);

  it('같은 고정 부분이면 준비는 한 번만, 같은 고정 부분·응답 형식으로 이미지 없이 보낸다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(2300));
    vi.stubGlobal('fetch', fetchMock);
    const options = { glossary: { 準備: '준비' }, context: '## 노트 A' };
    await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,A'], 1, options);
    await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,B'], 2, options);

    const warmups = fetchMock.mock.calls.filter(isWarmup).map((call: any[]) => JSON.parse(call[1].body));
    expect(warmups).toHaveLength(1);
    const real = sentBody(fetchMock, 0);
    expect(warmups[0].messages[0]).toEqual(real.messages[0]);
    expect(warmups[0].response_format).toEqual(real.response_format);
    expect(JSON.stringify(warmups[0].messages)).not.toContain('image_url');
    // 준비가 본 요청보다 먼저
    expect(isWarmup(fetchMock.mock.calls[0])).toBe(true);
  });

  it('고정 부분(단어장·노트)이 바뀌면 다시 준비한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(2300));
    vi.stubGlobal('fetch', fetchMock);
    await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,A'], 1, { context: '## 노트 B1' });
    await translateGridImageOpenAI('terra', 'sk-test', ['data:image/jpeg;base64,A'], 1, { context: '## 노트 B2' });
    expect(fetchMock.mock.calls.filter(isWarmup)).toHaveLength(2);
  });

  it('준비해도 이미지 요청이 연달아 캐시를 못 읽으면 그 모델은 준비를 멈춘다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(0));
    vi.stubGlobal('fetch', fetchMock);
    for (let i = 0; i < 10; i++) {
      await translateGridImageOpenAI('luna', 'sk-test', ['data:image/jpeg;base64,A'], 1, { context: `## 노트 C${i}` });
    }
    // 처음 8번은 준비, 그 뒤로는 안 함
    expect(fetchMock.mock.calls.filter(isWarmup)).toHaveLength(8);
    expect(realCalls(fetchMock)).toHaveLength(10);
  });
});
