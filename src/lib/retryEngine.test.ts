import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationSettings } from '../types';

const translateGridImage = vi.fn();
const translateGridImageOpenAI = vi.fn();

vi.mock('./gemini', () => ({ translateGridImage }));
vi.mock('./openai', () => ({ translateGridImageOpenAI, translateFullPageOpenAI: vi.fn(), retranslateTextOpenAI: vi.fn() }));

const { firstRequesterFor, retryPlan, retryRequesterFor } = await import('./translatePage');

const settings = (over: Partial<TranslationSettings> = {}): TranslationSettings => ({
  mainEngine: 'openai', openaiKey: 'sk-test', openAiVersion: 'terra', googleKey: '', geminiVersion: '3.6', glossary: {}, ...over,
});
const grid = { images: ['data:image/png;base64,GRID'], cells: [{ id: 1, pageId: 'p', box: { xmin: 0, ymin: 0, xmax: 1, ymax: 1, confidence: 1, classId: 3 } }] };
const answer = [{ id: 1, original_text: 'あ', translated_text: '가' }];

describe('품질 검사 재요청 엔진 (메인 = OpenAI)', () => {
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

  it('Gemini 키가 있으면 Gemini로 PNG 격자를 보내고 재요청 표시를 켠다', async () => {
    translateGridImage.mockResolvedValue(answer);
    await retryRequesterFor(settings({ googleKey: 'g-key', geminiVersion: '3.7', context: '맥락' }))(grid, [1]);
    const [key, images, expected, version, options] = translateGridImage.mock.calls[0];
    expect([key, images, expected, version]).toEqual(['g-key', [{ data: 'GRID', mimeType: 'image/png' }], 1, '3.7']);
    expect(options.pageCellCounts).toEqual([1]);
    expect(options.retry).toBe(true);
    expect(translateGridImageOpenAI).not.toHaveBeenCalled();
  });

  it('재요청에는 작품 노트·단어장은 그대로 두고 직전 대사만 뺀다 (앞부분이 같아야 캐시가 걸림)', async () => {
    translateGridImage.mockResolvedValue(answer);
    const withContext = settings({ googleKey: 'g-key', context: '## 작품 노트', recentContext: '## 직전까지의 번역' });

    await firstRequesterFor(withContext)(grid, undefined);
    const first = translateGridImageOpenAI.mock.calls[0][4];
    expect(first.context).toBe('## 작품 노트');
    expect(first.recentContext).toBe('## 직전까지의 번역');

    await retryRequesterFor(withContext)(grid, undefined);
    const retryOptions = translateGridImage.mock.calls[0][4];
    expect(retryOptions.context).toBe('## 작품 노트');
    expect(retryOptions.glossary).toEqual(withContext.glossary);
    expect(retryOptions.recentContext).toBeUndefined();
  });

  it('Gemini 요청이 실패하면 OpenAI Sol로 넘긴다', async () => {
    translateGridImage.mockRejectedValue(new Error('Gemini 요청 한도 초과(429)'));
    translateGridImageOpenAI.mockResolvedValue(answer);
    expect(await retryRequesterFor(settings({ googleKey: 'g-key' }))(grid, undefined)).toEqual(answer);
    expect(translateGridImageOpenAI.mock.calls[0][0]).toBe('sol');
  });
});

describe('품질 검사 재요청 엔진 (메인 = Gemini, 역할을 뒤집은 경우)', () => {
  beforeEach(() => {
    translateGridImage.mockReset();
    translateGridImageOpenAI.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('OpenAI 키가 없으면 Gemini 3.7(더 강한 모델)로 다시 읽는다', async () => {
    translateGridImage.mockResolvedValue(answer);
    await retryRequesterFor(settings({ mainEngine: 'gemini', openaiKey: '', googleKey: 'g-key', geminiVersion: '3.6' }))(grid, undefined);
    expect(translateGridImage.mock.calls[0][3]).toBe('3.7');
    expect(translateGridImageOpenAI).not.toHaveBeenCalled();
  });

  it('OpenAI 키가 있으면 OpenAI(고른 버전)로 다시 읽는다', async () => {
    translateGridImageOpenAI.mockResolvedValue(answer);
    await retryRequesterFor(settings({ mainEngine: 'gemini', openaiKey: 'sk-key', openAiVersion: 'sol', googleKey: 'g-key' }))(grid, [1]);
    const [version, key] = translateGridImageOpenAI.mock.calls[0];
    expect([version, key]).toEqual(['sol', 'sk-key']);
    expect(translateGridImage).not.toHaveBeenCalled();
  });

  it('OpenAI 요청이 실패하면 Gemini 3.7로 넘긴다', async () => {
    translateGridImageOpenAI.mockRejectedValue(new Error('OpenAI API Error 429'));
    translateGridImage.mockResolvedValue(answer);
    const result = await retryRequesterFor(settings({ mainEngine: 'gemini', openaiKey: 'sk-key', googleKey: 'g-key' }))(grid, undefined);
    expect(result).toEqual(answer);
    expect(translateGridImage.mock.calls[0][3]).toBe('3.7');
  });
});

describe('firstRequesterFor (1차 번역은 항상 메인 엔진으로)', () => {
  beforeEach(() => {
    translateGridImage.mockReset();
    translateGridImageOpenAI.mockReset();
  });

  it('메인이 OpenAI면 1차 요청도 OpenAI로 간다', async () => {
    translateGridImageOpenAI.mockResolvedValue(answer);
    await firstRequesterFor(settings({ googleKey: 'g-key' }))(grid, undefined);
    expect(translateGridImageOpenAI.mock.calls[0][0]).toBe('terra');
    expect(translateGridImage).not.toHaveBeenCalled();
  });

  it('메인을 Gemini로 바꾸면 1차 요청도 Gemini로 간다 (OpenAI 키가 있어도)', async () => {
    translateGridImage.mockResolvedValue(answer);
    await firstRequesterFor(settings({ mainEngine: 'gemini', googleKey: 'g-key', geminiVersion: '3.6' }))(grid, undefined);
    const [key, , , version] = translateGridImage.mock.calls[0];
    expect([key, version]).toEqual(['g-key', '3.6']);
    expect(translateGridImageOpenAI).not.toHaveBeenCalled();
  });
});

describe('retryPlan', () => {
  it('고해상도 재요청 칸을 한 장에 최대 3칸씩 세로 한 줄로 나눈다', () => {
    expect(retryPlan(7)).toEqual([{ count: 3, columns: 1 }, { count: 3, columns: 1 }, { count: 1, columns: 1 }]);
    expect(retryPlan(2)).toEqual([{ count: 2, columns: 1 }]);
  });
});
