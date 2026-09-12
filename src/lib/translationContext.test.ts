import { describe, expect, it } from 'vitest';
import type { TranslationCache, TranslationResult, UploadedImage } from '../types';
import { buildCacheKey } from './cacheKey';
import { buildContextInstruction, collectRecentPairs } from './translationContext';

const page = (name: string): UploadedImage => ({
  src: '', file: new File([], name), mimeType: 'image/jpeg', sortKey: name, width: 800, height: 1200, isSpread: false,
});
const line = (original: string, translated: string): TranslationResult => ({
  id: original, original_text: original, translated_text: translated, box_2d: [0, 0, 10, 10],
});

const images = [page('1.jpg'), page('2.jpg'), page('3.jpg')];
const cacheFor = (entries: Record<number, TranslationResult[]>): TranslationCache =>
  Object.fromEntries(Object.entries(entries).map(([i, rs]) => [buildCacheKey(images[Number(i)].file.name, images[Number(i)].file.size), rs]));

describe('collectRecentPairs', () => {
  it('앞 페이지 대사를 읽는 순서대로 모은다', () => {
    const cache = cacheFor({ 0: [line('あ', '가'), line('い', '나')], 1: [line('う', '다')] });
    expect(collectRecentPairs(images, cache, 2)).toEqual([
      { original: 'あ', translated: '가' },
      { original: 'い', translated: '나' },
      { original: 'う', translated: '다' },
    ]);
  });

  it('아직 번역되지 않은 페이지는 건너뛴다', () => {
    const cache = cacheFor({ 0: [line('あ', '가')] });
    expect(collectRecentPairs(images, cache, 2)).toEqual([{ original: 'あ', translated: '가' }]);
  });

  it('최대 개수만큼 가까운 대사만 남긴다', () => {
    const cache = cacheFor({ 0: [line('a', '1'), line('b', '2'), line('c', '3')] });
    expect(collectRecentPairs(images, cache, 1, 2)).toEqual([
      { original: 'b', translated: '2' },
      { original: 'c', translated: '3' },
    ]);
  });

  it('요미가나를 지우고 자리표시 문구는 제외한다', () => {
    const cache = cacheFor({ 0: [line('漢字(かんじ)', '한자'), line('x', '번역 중...')] });
    expect(collectRecentPairs(images, cache, 1)).toEqual([{ original: '漢字', translated: '한자' }]);
  });

  it('현재 페이지와 그 뒤는 참고하지 않는다', () => {
    const cache = cacheFor({ 0: [line('a', '1')], 2: [line('c', '3')] });
    expect(collectRecentPairs(images, cache, 1)).toEqual([{ original: 'a', translated: '1' }]);
  });
});

describe('buildContextInstruction', () => {
  it('노트와 대사가 모두 없으면 빈 문자열', () => {
    expect(buildContextInstruction(undefined, [])).toBe('');
    expect(buildContextInstruction('   ', [])).toBe('');
  });

  it('작품 노트와 직전 대사를 함께 넣는다', () => {
    const text = buildContextInstruction('- 주인공은 반말', [{ original: 'あ', translated: '가' }]);
    expect(text).toContain('이어지는 맥락');
    expect(text).toContain('- 주인공은 반말');
    expect(text).toContain('- あ → 가');
  });
});
