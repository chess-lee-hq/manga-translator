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

describe('translateGridImage', () => {
  beforeEach(() => {
    generateContent.mockReset();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('Gemini가 번역까지 맡을 때는 전체 페이지와 격자 두 장을 보낸다', async () => {
    generateContent.mockResolvedValue({ text: '[{"id":1,"original_text":"あ","translated_text":"가"}]' });

    const results = await translateGridImage('key', 'GRID', 'image/jpeg', 1, '3.6', { fullBase64Image: 'FULL' });

    expect(imageParts().map((p: any) => p.inlineData.data)).toEqual(['FULL', 'GRID']);
    expect(results[0].translated_text).toBe('가');
  });

  it('ocrOnly면 격자 한 장만 보내고 번역은 요청하지 않는다 (토큰 절약)', async () => {
    generateContent.mockResolvedValue({ text: '[{"id":1,"original_text":"あ"}]' });

    const results = await translateGridImage('key', 'GRID', 'image/jpeg', 1, '3.6', {
      fullBase64Image: 'FULL', // ocrOnly면 전체 페이지는 무시해야 함
      ocrOnly: true,
      glossary: { あ: '가' },
      context: '앞 페이지 맥락',
    });

    expect(imageParts().map((p: any) => p.inlineData.data)).toEqual(['GRID']);
    expect(promptText()).toContain('번역은 하지 마');
    expect(promptText()).not.toContain('앞 페이지 맥락');
    // 응답 스키마에서도 번역문을 빼서 출력 토큰을 아낌
    expect(lastRequest().config.responseSchema.items.required).toEqual(['id', 'original_text']);
    // 번역은 OpenAI가 채우므로 빈 문자열로 넘김
    expect(results).toEqual([{ id: 1, original_text: 'あ', translated_text: '' }]);
  });

  it('전체 페이지 이미지를 주지 않으면 격자 한 장만 보낸다', async () => {
    generateContent.mockResolvedValue({ text: '[]' });
    await translateGridImage('key', 'GRID', 'image/jpeg', 2, '3.6');
    expect(imageParts()).toHaveLength(1);
    expect(promptText()).toContain('첨부한 이미지는');
  });
});
