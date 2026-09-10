import { describe, expect, it } from 'vitest';
import { buildTranslationQueue, getSpreadStartIndex, getVisibleIndices } from './pageLayout';

// p: 세로 페이지, S: 가로 펼침면
const pages = (spec: string) => Array.from(spec).map(c => ({ isSpread: c === 'S' }));

describe('getVisibleIndices', () => {
  it('1장 모드는 현재 페이지만', () => {
    expect(getVisibleIndices(pages('ppp'), 1, '1page')).toEqual([1]);
  });

  it('2장 모드는 현재+다음 페이지', () => {
    expect(getVisibleIndices(pages('pppp'), 0, '2page')).toEqual([0, 1]);
  });

  it('펼침면은 혼자 보인다', () => {
    expect(getVisibleIndices(pages('pSp'), 1, '2page')).toEqual([1]);
    expect(getVisibleIndices(pages('pSp'), 0, '2page')).toEqual([0]);
  });

  it('마지막 장과 범위 밖', () => {
    expect(getVisibleIndices(pages('ppp'), 2, '2page')).toEqual([2]);
    expect(getVisibleIndices(pages('pp'), 5, '1page')).toEqual([]);
  });
});

describe('getSpreadStartIndex', () => {
  it('2장 묶음의 시작 페이지를 찾는다', () => {
    const p = pages('pppp');
    expect(getSpreadStartIndex(p, 1, '2page')).toBe(0);
    expect(getSpreadStartIndex(p, 3, '2page')).toBe(2);
  });

  it('펼침면이 끼면 묶음이 밀린다', () => {
    const p = pages('pSpp');
    expect(getSpreadStartIndex(p, 0, '2page')).toBe(0);
    expect(getSpreadStartIndex(p, 1, '2page')).toBe(1);
    expect(getSpreadStartIndex(p, 3, '2page')).toBe(2);
  });

  it('1장 모드는 그대로', () => {
    expect(getSpreadStartIndex(pages('pppp'), 3, '1page')).toBe(3);
  });
});

describe('buildTranslationQueue', () => {
  it('보이는 페이지 뒤로 미리 번역할 페이지를 붙인다', () => {
    expect(buildTranslationQueue([0, 1], 5, 2)).toEqual([0, 1, 2, 3]);
  });

  it('마지막 페이지를 넘지 않는다', () => {
    expect(buildTranslationQueue([3, 4], 5, 10)).toEqual([3, 4]);
    expect(buildTranslationQueue([], 5, 10)).toEqual([]);
  });
});
