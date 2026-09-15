import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationSettings } from '../types';

const translateGridImage = vi.fn();
const translateGridImageOpenAI = vi.fn();

vi.mock('./gemini', () => ({ translateGridImage }));
vi.mock('./openai', () => ({ translateGridImageOpenAI, translateFullPageOpenAI: vi.fn(), retranslateTextOpenAI: vi.fn() }));

const { mergeChunkResponses, retryRequesterFor } = await import('./translatePage');

const settings = (over: Partial<TranslationSettings> = {}): TranslationSettings => ({
  openaiKey: 'sk-test', openAiVersion: 'terra', googleKey: '', geminiVersion: '3.6', glossary: {}, ...over,
});
const grid = { dataUrl: 'data:image/png;base64,GRID', cells: [{ id: 1, pageId: 'p', box: { xmin: 0, ymin: 0, xmax: 1, ymax: 1, confidence: 1, classId: 3 } }] };
const answer = [{ id: 1, original_text: 'あ', translated_text: '가' }];

describe('품질 검사 재요청 엔진', () => {
  beforeEach(() => {
    translateGridImage.mockReset();
    translateGridImageOpenAI.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('Gemini 키가 없으면 첫 요청 모델과 관계없이 OpenAI Sol로 다시 읽는다', async () => {
    translateGridImageOpenAI.mockResolvedValue(answer);
    expect(await retryRequesterFor(settings())(grid, undefined)).toEqual(answer);
    expect(translateGridImageOpenAI.mock.calls[0][0]).toBe('sol');
    expect(translateGridImage).not.toHaveBeenCalled();
  });

  it('Gemini 키가 있으면 Gemini로 PNG 격자를 보내고 재요청 안내를 붙인다', async () => {
    translateGridImage.mockResolvedValue(answer);
    await retryRequesterFor(settings({ googleKey: 'g-key', geminiVersion: '3.7', context: '맥락' }))(grid, [1]);
    const [key, base64, mime, expected, version, options] = translateGridImage.mock.calls[0];
    expect([key, base64, mime, expected, version]).toEqual(['g-key', 'GRID', 'image/png', 1, '3.7']);
    expect(options.pageCellCounts).toEqual([1]);
    expect(options.context).toMatch(/^맥락/);
    expect(options.context.length).toBeGreaterThan('맥락'.length);
    expect(translateGridImageOpenAI).not.toHaveBeenCalled();
  });

  it('Gemini 요청이 실패하면 OpenAI Sol로 넘긴다', async () => {
    translateGridImage.mockRejectedValue(new Error('Gemini 요청 한도 초과(429)'));
    translateGridImageOpenAI.mockResolvedValue(answer);
    expect(await retryRequesterFor(settings({ googleKey: 'g-key' }))(grid, undefined)).toEqual(answer);
    expect(translateGridImageOpenAI.mock.calls[0][0]).toBe('sol');
  });
});

describe('mergeChunkResponses', () => {
  it('나눠 보낸 격자의 칸 번호를 이어 붙이고 범위 밖 번호는 버린다', () => {
    const merged = mergeChunkResponses(
      [
        [{ id: 2, original_text: 'い', translated_text: '나' }, { id: 1, original_text: 'あ', translated_text: '가' }, { id: 7, original_text: 'x', translated_text: 'x' }],
        [{ id: 1, original_text: 'う', translated_text: '다' }],
      ],
      [3, 1],
    );
    expect(merged.map(t => [t.id, t.translated_text])).toEqual([[2, '나'], [1, '가'], [4, '다']]);
  });
});
