import { describe, expect, it } from 'vitest';
import { applyCorrection, buildCorrectionSection, mergeCorrections, type Correction } from './corrections';

const T1 = new Date('2026-09-14T10:00:00Z');
const T2 = new Date('2026-09-14T11:00:00Z');

describe('applyCorrection', () => {
  it('AI 번역을 고치면 최신 항목으로 앞에 쌓인다', () => {
    const list = applyCorrection([], '待って', '기다려라', '잠깐만', T1);
    expect(list).toEqual([{ original: '待って', before: '기다려라', after: '잠깐만', at: T1.toISOString() }]);
  });

  it('같은 원문을 다시 고치면 처음 AI 번역은 유지하고 수정본만 바꾼다', () => {
    let list = applyCorrection([], '待って', '기다려라', '잠깐만', T1);
    list = applyCorrection(list, '待って', '잠깐만', '잠깐!', T2);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ before: '기다려라', after: '잠깐!' });
  });

  it('AI 번역으로 되돌리면 교정 기록에서 뺀다', () => {
    let list = applyCorrection([], '待って', '기다려라', '잠깐만', T1);
    list = applyCorrection(list, '待って', '잠깐만', '기다려라', T2);
    expect(list).toEqual([]);
  });

  it('내용이 그대로거나, 임시 문구를 고친 경우는 교정이 아니다', () => {
    expect(applyCorrection([], '待って', '기다려', '기다려 ')).toEqual([]);
    expect(applyCorrection([], '待って', '번역 중...', '기다려')).toEqual([]);
    expect(applyCorrection([], '...', '가', '나')).toEqual([]);
    expect(applyCorrection([], '待って', '기다려', '')).toEqual([]);
  });

  it('최대 60개까지만 보관한다', () => {
    let list: Correction[] = [];
    for (let i = 0; i < 70; i++) list = applyCorrection(list, `原文${i}`, `AI${i}`, `수정${i}`);
    expect(list).toHaveLength(60);
    expect(list[0].original).toBe('原文69');
  });
});

describe('mergeCorrections', () => {
  it('같은 원문은 더 최근에 고친 쪽을 남기고 최신순으로 정렬한다', () => {
    const a = [{ original: 'あ', before: '가', after: '가1', at: T1.toISOString() }];
    const b = [{ original: 'あ', before: '가', after: '가2', at: T2.toISOString() }, { original: 'い', before: '나', after: '나1', at: T1.toISOString() }];
    const merged = mergeCorrections(a, b);
    expect(merged.map(c => c.after)).toEqual(['가2', '나1']);
  });
});

describe('buildCorrectionSection', () => {
  it('최근 교정부터 최대 개수만큼 넣고, 요미가나는 떼고, 긴 문장은 자른다', () => {
    const list: Correction[] = Array.from({ length: 10 }, (_, i) => ({ original: `漢字(かんじ)${i}`, before: 'b', after: 'a', at: '' }));
    list[0] = { ...list[0], after: '가'.repeat(100) };
    const text = buildCorrectionSection(list, 8);
    expect(text.split('\n').filter(l => l.startsWith('- '))).toHaveLength(8);
    expect(text).toContain('漢字0');
    expect(text).not.toContain('かんじ');
    expect(text).toContain('…');
  });

  it('교정이 없으면 빈 문자열', () => {
    expect(buildCorrectionSection([])).toBe('');
  });
});
