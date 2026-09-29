import { describe, expect, it } from 'vitest';
import { findGlossaryMisses, findInconsistentLines, type ConsistencyPage } from './consistency';

const r = (id: string, original_text: string, translated_text: string) => ({ id, original_text, translated_text, box_2d: [0, 0, 1, 1] as [number, number, number, number] });
const pages: ConsistencyPage[] = [
  { imgIndex: 0, key: 'p0', results: [r('a', '本気(ほんき)か！', '진심이야!'), r('b', '晴信様', '하루노부 님'), r('x', 'あ', '아')] },
  { imgIndex: 1, key: 'p1', results: [r('c', '本気か……', '진심이야..'), r('d', '晴信様', '하루노부 공')] },
  { imgIndex: 2, key: 'p2', results: [r('e', '本気か', '정말이냐'), r('f', '晴信が来た', '하루노부가 왔다'), r('g', '晴信？', '하루노부?')] },
];

describe('findInconsistentLines', () => {
  it('요미가나·문장부호만 다른 원문은 같은 것으로 묶고, 번역이 둘 이상이면 알려준다', () => {
    const groups = findInconsistentLines(pages);
    const honki = groups.find(g => g.original === '本気か')!;
    expect(honki.variants.map(v => [v.translated, v.refs.length])).toEqual([['진심이야!', 2], ['정말이냐', 1]]);
    expect(groups.find(g => g.original === '晴信様')!.variants).toHaveLength(2);
  });

  it('한 글자 원문과 넘긴 원문은 빼고, 번역이 모두 같으면 문제로 보지 않는다', () => {
    const groups = findInconsistentLines(pages, ['晴信様']);
    expect(groups.map(g => g.original)).toEqual(['本気か']);
  });
});

describe('findGlossaryMisses', () => {
  it('단어장 원문이 있는데 번역에 단어장 표기가 없는 줄만', () => {
    const misses = findGlossaryMisses(pages, { 晴信: '하루노부', 本気: '진심' });
    expect(misses.map(m => [m.term, m.refs.map(ref => ref.id)])).toEqual([['本気', ['e']]]);
  });
});
