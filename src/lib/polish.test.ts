import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationSettings } from '../types';

const polishTranslationsOpenAI = vi.fn();
vi.mock('./openai', () => ({ polishTranslationsOpenAI }));
vi.mock('./gemini', () => ({ polishTranslationsGemini: vi.fn() }));

const { acceptChanges, chunkForPolish, runPolishPass } = await import('./polish');

const r = (id: string, jp: string, ko: string) => ({ id, original_text: jp, translated_text: ko, box_2d: [0, 0, 1, 1] as [number, number, number, number] });
const sources = [
  { imgIndex: 0, key: 'p0', results: [r('a', '本気か', '진심이야?'), r('b', 'うん', '응')] },
  { imgIndex: 1, key: 'p1', results: [r('c', '晴信様', '하루노부 공'), r('d', '', '번역 중...')] },
  { imgIndex: 2, key: 'p2', results: [r('e', '行くぞ', '가자')] },
];
const settings: TranslationSettings = {
  mainEngine: 'openai', openaiKey: 'sk-test', openAiVersion: 'terra', googleKey: '', geminiVersion: '3.6', glossary: {},
};

describe('chunkForPolish', () => {
  it('페이지 중간에서 자르지 않고, 임시 문구는 뺀다', () => {
    const chunks = chunkForPolish(sources, 3);
    expect(chunks.map(c => c.map(e => e.result.id))).toEqual([['a', 'b', 'c'], ['e']]);
  });
});

describe('acceptChanges', () => {
  const chunk = chunkForPolish(sources)[0];

  it('실제로 바뀐 제안만, 말줄임표 규칙을 맞춰 남긴다', () => {
    const proposals = acceptChanges(chunk, [
      { i: 3, ko: '하루노부 님……', why: '호칭 통일' },
      { i: 2, ko: '응 ', why: '공백' },
    ]);
    expect(proposals).toEqual([{ key: 'p1', id: 'c', imgIndex: 1, original: '晴信様', before: '하루노부 공', after: '하루노부 님..', why: '호칭 통일' }]);
  });

  it('없는 줄 번호, 일본어가 남은 번역, 지나치게 길어진 번역은 버린다', () => {
    expect(acceptChanges(chunk, [
      { i: 9, ko: '???', why: '' },
      { i: 1, ko: '本気야?', why: '' },
      { i: 2, ko: '응, 나도 그렇게 생각해. 정말로 그래.', why: '' },
    ])).toEqual([]);
  });
});

describe('runPolishPass', () => {
  beforeEach(() => {
    polishTranslationsOpenAI.mockReset();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('메인 엔진에 줄 번호·쪽 번호와 함께 텍스트만 보내고 제안을 모은다', async () => {
    polishTranslationsOpenAI.mockResolvedValue([{ i: 4, ko: '가자고', why: '말투' }]);
    const progress = vi.fn();
    const { proposals } = await runPolishPass(sources, { ...settings, context: '노트' }, progress);
    const [, , lines, options] = polishTranslationsOpenAI.mock.calls[0];
    expect(lines.map((l: any) => [l.i, l.page, l.ko])).toEqual([[1, 1, '진심이야?'], [2, 1, '응'], [3, 2, '하루노부 공'], [4, 3, '가자']]);
    expect(options.context).toBe('노트');
    expect(proposals.map(p => [p.id, p.after])).toEqual([['e', '가자고']]);
    expect(progress).toHaveBeenLastCalledWith(1, 1);
  });

  it('키가 없으면 요청 없이 오류', async () => {
    await expect(runPolishPass(sources, { ...settings, openaiKey: '' })).rejects.toThrow('API 키');
    expect(polishTranslationsOpenAI).not.toHaveBeenCalled();
  });
});
