import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationSettings, UploadedImage } from '../types';

const translateGridImageOpenAI = vi.fn();
const translateGridImage = vi.fn();
const createGridImage = vi.fn(async (_sources: unknown, _options: unknown) => ({ images: ['data:image/png;base64,G'], cells: [{ id: 1, pageId: 'reread', box: {} }] }));

vi.mock('./openai', () => ({ translateGridImageOpenAI, translateFullPageOpenAI: vi.fn(), retranslateTextOpenAI: vi.fn(), shortenTranslationOpenAI: vi.fn() }));
vi.mock('./gemini', () => ({ translateGridImage, translateMangaImage: vi.fn(), retranslateTextGemini: vi.fn(), shortenTranslationGemini: vi.fn() }));
vi.mock('./imageUtils', async () => ({
  ...(await vi.importActual<typeof import('./imageUtils')>('./imageUtils')),
  loadImage: vi.fn(async () => ({ width: 800, height: 1200 })),
  createGridImage,
}));

const { rereadBubble } = await import('./translatePage');

const settings: TranslationSettings = {
  mainEngine: 'openai', openaiKey: 'sk-test', openAiVersion: 'terra', googleKey: '', geminiVersion: '3.6', glossary: {},
};
const page = { src: 'data:image/png;base64,X', mimeType: 'image/png', width: 800, height: 1200 } as UploadedImage;

describe('rereadBubble — 말풍선 하나를 이미지에서 다시 읽기', () => {
  beforeEach(() => {
    translateGridImageOpenAI.mockReset();
    createGridImage.mockClear();
  });

  it('2배 해상도 PNG 한 칸으로, 재요청 엔진(보조 키가 없으면 6 Sol)에 보낸다', async () => {
    translateGridImageOpenAI.mockResolvedValue([{ id: 1, original_text: '本当か', translated_text: '정말이야?' }]);
    const result = await rereadBubble(page, [100, 100, 200, 300], settings);
    expect(result).toEqual({ originalText: '本当か', translatedText: '정말이야?' });
    expect(createGridImage.mock.calls[0][1]).toMatchObject({ cellSize: 600, format: 'png' });
    expect(translateGridImageOpenAI.mock.calls[0][0]).toBe('sol');
  });

  it('다시 읽은 번역에도 문제가 남으면 검토 표시를 함께 돌려준다', async () => {
    translateGridImageOpenAI.mockResolvedValue([{ id: 1, original_text: '本当か', translated_text: '本当か', unsure: true }]);
    expect((await rereadBubble(page, [100, 100, 200, 300], settings)).review).toBe('번역 안 됨');
  });

  it('글자를 못 읽으면 오류', async () => {
    translateGridImageOpenAI.mockResolvedValue([{ id: 1, original_text: '', translated_text: '' }]);
    await expect(rereadBubble(page, [100, 100, 200, 300], settings)).rejects.toThrow('읽지 못했');
  });
});
