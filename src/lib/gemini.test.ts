import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
  Type: { ARRAY: 'ARRAY', OBJECT: 'OBJECT', INTEGER: 'INTEGER', STRING: 'STRING' },
}));

const { retranslateTextGemini, shortenTranslationGemini, summarizeWorkNotes, translateGridImage, translateMangaImage } = await import('./gemini');

const lastRequest = () => generateContent.mock.calls.at(-1)![0];
const imageParts = () => lastRequest().contents[0].parts.filter((p: any) => p.inlineData);
const promptText = () => lastRequest().contents[0].parts[0].text as string;

describe('translateGridImage (재인식 보조 엔진)', () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContent.mockResolvedValue({ text: '[{"id":1,"original_text":"あ","translated_text":"가"}]' });
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('격자 한 장만, 넘겨받은 이미지 형식 그대로 보낸다 (고해상도 재요청은 PNG)', async () => {
    await translateGridImage('key', 'GRID', 'image/png', 1, '3.6');
    expect(imageParts().map((p: any) => p.inlineData)).toEqual([{ data: 'GRID', mimeType: 'image/png' }]);
  });

  it('여러 페이지에서 모은 칸이면 페이지 경계를 프롬프트에 알린다', async () => {
    await translateGridImage('key', 'GRID', 'image/png', 3, '3.6', { pageCellCounts: [2, 1] });
    expect(promptText()).toContain('1번째 페이지: 1~2번');
    expect(promptText()).toContain('2번째 페이지: 3~3번');
  });

  it('단어장과 앞 페이지 맥락을 프롬프트에 함께 싣는다 (엔진이 달라도 동일한 지침)', async () => {
    await translateGridImage('key', 'GRID', 'image/jpeg', 2, '3.6', {
      glossary: { 拳王: '권왕' },
      context: '# 앞 페이지 맥락\n- 주인공은 반말을 쓴다',
    });
    expect(promptText()).toContain('拳王 -> 권왕');
    expect(promptText()).toContain('주인공은 반말을 쓴다');
    expect(promptText()).toContain('번역 지침');
    expect(promptText()).toContain('정확히 2개를 순서대로');
  });

  it('번역문까지 받도록 응답 스키마를 요구한다', async () => {
    await translateGridImage('key', 'GRID', 'image/jpeg', 1, '3.6');
    expect(lastRequest().config.responseSchema.items.required).toEqual(['id', 'original_text', 'translated_text']);
  });
});

describe('메인 엔진으로 골랐을 때만 쓰는 Gemini 함수들', () => {
  beforeEach(() => {
    generateContent.mockReset();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('translateMangaImage: 말풍선을 못 찾은 페이지 전체를 좌표까지 함께 읽는다', async () => {
    generateContent.mockResolvedValue({ text: '[{"original_text":"あ","translated_text":"가","box_2d":[0,0,100,100]}]' });
    const results = await translateMangaImage('key', 'FULL', 'image/jpeg', '3.7', { 拳王: '권왕' }, '맥락');
    expect(results).toEqual([{ original_text: 'あ', translated_text: '가', box_2d: [0, 0, 100, 100] }]);
    expect(lastRequest().model).toBe('gemini-3.7-flash');
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
    expect(lastRequest().contents as string).toContain('5자 이내');
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
