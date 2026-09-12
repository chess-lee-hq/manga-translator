import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
  Type: { ARRAY: 'ARRAY', OBJECT: 'OBJECT', INTEGER: 'INTEGER', STRING: 'STRING' },
}));

const { translateGridImage } = await import('./gemini');

const lastRequest = () => generateContent.mock.calls.at(-1)![0];
const imageParts = () => lastRequest().contents[0].parts.filter((p: any) => p.inlineData);
const promptText = () => lastRequest().contents[0].parts[0].text as string;

describe('translateGridImage (보조 엔진)', () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContent.mockResolvedValue({ text: '[{"id":1,"original_text":"あ","translated_text":"가"}]' });
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('페이지 전체 이미지를 주면 두 장, 주지 않으면 격자 한 장만 보낸다', async () => {
    await translateGridImage('key', 'GRID', 'image/jpeg', 1, '3.6', { fullBase64Image: 'FULL' });
    expect(imageParts().map((p: any) => p.inlineData.data)).toEqual(['FULL', 'GRID']);

    await translateGridImage('key', 'GRID', 'image/jpeg', 1, '3.6');
    expect(imageParts().map((p: any) => p.inlineData.data)).toEqual(['GRID']);
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
