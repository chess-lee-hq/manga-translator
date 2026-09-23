import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationSettings, UploadedImage } from '../types';

const detectSpeechBubbles = vi.fn();
const translateFullPageOpenAI = vi.fn();
const translateGridImageOpenAI = vi.fn();
const loadImage = vi.fn(async () => ({ width: 800, height: 1200, naturalWidth: 800, naturalHeight: 1200 }));

vi.mock('./yolo', () => ({ detectSpeechBubbles }));
vi.mock('./openai', () => ({ translateFullPageOpenAI, translateGridImageOpenAI, retranslateTextOpenAI: vi.fn(), shortenTranslationOpenAI: vi.fn() }));
vi.mock('./gemini', () => ({ translateGridImage: vi.fn(), translateMangaImage: vi.fn(), retranslateTextGemini: vi.fn(), shortenTranslationGemini: vi.fn() }));
vi.mock('./imageUtils', async () => ({
  ...(await vi.importActual<typeof import('./imageUtils')>('./imageUtils')),
  loadImage,
  readFileAsDataURL: vi.fn(async () => 'data:image/png;base64,X'),
  createGridImage: vi.fn(async () => null),
}));

const { translatePage, translatePageBatch } = await import('./translatePage');

const settings: TranslationSettings = {
  mainEngine: 'openai', openaiKey: 'sk-test', openAiVersion: 'terra', googleKey: '', geminiVersion: '3.6', glossary: {},
};
const page = { src: 'data:image/png;base64,X', mimeType: 'image/png', width: 800, height: 1200 } as UploadedImage;

describe('빈 페이지는 요청 없이 건너뛴다', () => {
  beforeEach(() => {
    detectSpeechBubbles.mockReset();
    translateFullPageOpenAI.mockReset();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('말풍선도 없고 어두운 픽셀도 사실상 없으면 API를 아예 호출하지 않는다', async () => {
    detectSpeechBubbles.mockResolvedValue({ boxes: [], darkRatio: 0.0004 });
    expect(await translatePage(page, settings)).toEqual([]);
    expect(translateFullPageOpenAI).not.toHaveBeenCalled();
  });

  it('말풍선을 못 찾았어도 글자·그림이 있으면 페이지 전체 인식으로 넘어간다', async () => {
    detectSpeechBubbles.mockResolvedValue({ boxes: [], darkRatio: 0.02 });
    translateFullPageOpenAI.mockResolvedValue([]);
    await translatePage(page, settings);
    expect(translateFullPageOpenAI).toHaveBeenCalledTimes(1);
  });

  it('글자 몇 자 수준(경계 근처)도 건너뛰지 않는다 — 놓치는 쪽이 더 나쁨', async () => {
    detectSpeechBubbles.mockResolvedValue({ boxes: [], darkRatio: 0.002 });
    translateFullPageOpenAI.mockResolvedValue([]);
    await translatePage(page, settings);
    expect(translateFullPageOpenAI).toHaveBeenCalledTimes(1);
  });
});

describe('미리 번역(묶음)에서도 말풍선을 못 찾은 페이지를 버리지 않는다', () => {
  beforeEach(() => {
    detectSpeechBubbles.mockReset();
    translateFullPageOpenAI.mockReset();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('글자·그림이 있는 페이지는 페이지 전체 인식, 빈 페이지는 요청 없이 0건', async () => {
    // 페이지 순서대로: 잉크 있는 0박스 페이지, 빈 페이지
    detectSpeechBubbles
      .mockResolvedValueOnce({ boxes: [], darkRatio: 0.03 })
      .mockResolvedValueOnce({ boxes: [], darkRatio: 0.0002 });
    translateFullPageOpenAI.mockResolvedValue([{ original_text: 'ナレーション', translated_text: '나레이션', box_2d: [100, 100, 200, 300] }]);

    const byPage = await translatePageBatch([{ id: 'ink', img: page }, { id: 'blank', img: page }], settings);

    expect(translateFullPageOpenAI).toHaveBeenCalledTimes(1);
    expect(byPage.get('ink')?.map(r => r.translated_text)).toEqual(['나레이션']);
    expect(byPage.get('blank')).toEqual([]);
  });
});
