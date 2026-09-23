import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from './testing/memoryStorage';

vi.stubGlobal('localStorage', new MemoryStorage());

/**
 * Gemini는 SDK 없이 REST(fetch)로 부르므로 fetch를 가로챕니다.
 * 각 테스트는 generateContent에 "모델이 돌려줄 글"만 정해 두고, 요청 내용은 generateContent 호출 인자로 확인합니다.
 */
const generateContent = vi.fn();
const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  const model = String(url).split('/models/')[1].split(':')[0];
  const reply = await generateContent({ model, contents: body.contents, config: body.generationConfig, headers: init.headers, url });
  const parts = reply?.parts ?? [{ text: reply?.text ?? '' }];
  return new Response(JSON.stringify({ candidates: [{ content: { parts } }], usageMetadata: {} }), { status: 200 });
});
vi.stubGlobal('fetch', fetchMock);

const { retranslateTextGemini, shortenTranslationGemini, summarizeWorkNotes, translateGridImage, translateMangaImage } = await import('./gemini');

const lastRequest = () => generateContent.mock.calls.at(-1)![0];
const imageParts = () => lastRequest().contents[0].parts.filter((p: any) => p.inlineData);
const promptText = () => lastRequest().contents[0].parts[0].text as string;

describe('Gemini REST 호출', () => {
  beforeEach(() => {
    generateContent.mockReset();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('키는 주소가 아니라 x-goog-api-key 헤더로 보낸다', async () => {
    generateContent.mockResolvedValue({ text: '번역' });
    await retranslateTextGemini('g-key', '原文', '3.6');
    expect(lastRequest().url).not.toContain('g-key');
    expect((lastRequest().headers as Record<string, string>)['x-goog-api-key']).toBe('g-key');
    expect(lastRequest().model).toBe('gemini-3.6-flash');
  });

  it('생각(thought) 파트는 답에서 뺀다', async () => {
    generateContent.mockResolvedValue({ parts: [{ text: '속으로 생각한 내용', thought: true }, { text: '진짜 답' }] });
    expect(await retranslateTextGemini('g-key', '原文', '3.6')).toBe('진짜 답');
  });

  it('HTTP 오류는 상태 코드가 담긴 안내로 바뀐다', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"API key not valid"}}', { status: 400 }));
    await expect(retranslateTextGemini('g-key', '原文', '3.6')).rejects.toThrow();
  });
});

describe('translateGridImage (재인식 보조 엔진)', () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContent.mockResolvedValue({ text: '{"cells":[{"id":1,"jp":"あ","ko":"가"}]}' });
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('격자 한 장만, 넘겨받은 이미지 형식 그대로 보낸다 (고해상도 재요청은 PNG)', async () => {
    await translateGridImage('key', [{ data: 'GRID', mimeType: 'image/png' }], 1, '3.6');
    expect(imageParts().map((p: any) => p.inlineData)).toEqual([{ data: 'GRID', mimeType: 'image/png' }]);
  });

  it('격자가 여러 장이면 한 요청에 순서대로 싣는다', async () => {
    await translateGridImage('key', [{ data: 'A', mimeType: 'image/jpeg' }, { data: 'B', mimeType: 'image/jpeg' }], 30, '3.6');
    expect(imageParts().map((p: any) => p.inlineData.data)).toEqual(['A', 'B']);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('여러 페이지에서 모은 칸이면 페이지 경계를 프롬프트에 알린다', async () => {
    await translateGridImage('key', [{ data: 'GRID', mimeType: 'image/png' }], 3, '3.6', { pageCellCounts: [2, 1] });
    expect(promptText()).toContain('1번째 페이지: 1~2번');
    expect(promptText()).toContain('2번째 페이지: 3~3번');
  });

  it('단어장과 앞 페이지 맥락을 프롬프트에 함께 싣는다 (엔진이 달라도 동일한 지침)', async () => {
    await translateGridImage('key', [{ data: 'GRID', mimeType: 'image/jpeg' }], 2, '3.6', {
      glossary: { 拳王: '권왕' },
      context: '# 앞 페이지 맥락\n- 주인공은 반말을 쓴다',
    });
    expect(promptText()).toContain('拳王 -> 권왕');
    expect(promptText()).toContain('주인공은 반말을 쓴다');
    expect(promptText()).toContain('번역 지침');
    expect(promptText()).toContain('정확히 2개를 순서대로');
  });

  it('번역문까지 받도록 응답 스키마를 요구한다', async () => {
    await translateGridImage('key', [{ data: 'GRID', mimeType: 'image/jpeg' }], 1, '3.6');
    expect(lastRequest().config.responseSchema.properties.cells.items.required).toEqual(['id', 'jp', 'ko']);
  });
});

describe('메인 엔진으로 골랐을 때만 쓰는 Gemini 함수들', () => {
  beforeEach(() => {
    generateContent.mockReset();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('translateMangaImage: 말풍선을 못 찾은 페이지 전체를 좌표까지 함께 읽는다', async () => {
    generateContent.mockResolvedValue({ text: '{"cells":[{"box":[0,0,100,100],"jp":"あ","ko":"가"}]}' });
    const results = await translateMangaImage('key', 'FULL', 'image/jpeg', '3.8', { glossary: { 拳王: '권왕' }, context: '맥락' });
    expect(results).toEqual([{ original_text: 'あ', translated_text: '가', box_2d: [0, 0, 100, 100] }]);
    expect(lastRequest().model).toBe('gemini-3.8-flash');
    expect(promptText()).toContain('拳王 -> 권왕');
  });

  it('retranslateTextGemini: 번역문 한 줄만 돌려준다', async () => {
    generateContent.mockResolvedValue({ text: ' 진심이야? ' });
    expect(await retranslateTextGemini('key', '本気か', '3.6')).toBe('진심이야?');
  });

  it('shortenTranslationGemini: 목표 글자 수를 프롬프트에 담아 요청한다', async () => {
    generateContent.mockResolvedValue({ text: '진심이야' });
    const result = await shortenTranslationGemini('key', '3.6', '本気か', '진심으로 하는 말이야?', 5);
    expect(result).toBe('진심이야');
    expect(promptText()).toContain('5자 이내');
  });

  it('summarizeWorkNotes: 노트와 단어장 후보를 함께 파싱한다', async () => {
    generateContent.mockResolvedValue({ text: '{"notes":"- 반말","glossary":[{"original":"拳王","translated":"권왕"}]}' });
    const result = await summarizeWorkNotes('key', '3.6', [{ original: 'あ', translated: '가' }]);
    expect(result).toEqual({ notes: '- 반말', glossary: [{ original: '拳王', translated: '권왕' }] });
  });

  it('summarizeWorkNotes: 대사가 없으면 요청 없이 기존 노트를 그대로 돌려준다', async () => {
    expect(await summarizeWorkNotes('key', '3.6', [], '이전 노트')).toEqual({ notes: '이전 노트', glossary: [] });
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe('추론 줄이기 (thinkingBudget)', () => {
  beforeEach(() => {
    generateContent.mockReset();
    localStorage.clear();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('켜면 thinking 예산 0을 보내고, 거절되면 기억해 두고 설정 없이 다시 보낸다', async () => {
    localStorage.setItem('manga-reduce-reasoning', 'true');
    generateContent.mockResolvedValue({ text: '번역' });
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"Thinking budget is not supported for this model."}}', { status: 400 }));

    expect(await retranslateTextGemini('g-key', '原文', '3.6')).toBe('번역');
    expect(lastRequest().config?.thinkingConfig).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('manga-reasoning-unsupported')!)).toEqual(['gemini-3.6-flash']);
  });

  it('켜져 있고 지원하면 thinkingConfig를 싣는다', async () => {
    localStorage.setItem('manga-reduce-reasoning', 'true');
    generateContent.mockResolvedValue({ text: '번역' });
    await retranslateTextGemini('g-key', '原文', '3.6');
    expect(lastRequest().config.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });
});
