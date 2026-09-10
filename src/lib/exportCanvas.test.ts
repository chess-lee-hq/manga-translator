import { describe, expect, it } from 'vitest';
import { getDisplayBox, layoutBubbleText, wrapText } from './exportCanvas';

// 글자당 10px 고정폭으로 가정
const measure = (t: string) => Array.from(t).length * 10;

describe('wrapText', () => {
  it('keep-all 모드는 공백 단위로 줄바꿈한다', () => {
    expect(wrapText('안녕 하세요 반가워요', 50, measure, true)).toEqual(['안녕', '하세요', '반가워요']);
  });

  it('한 단어가 너무 길면 글자 단위로 자른다', () => {
    expect(wrapText('가나다라마바사', 30, measure, true)).toEqual(['가나다', '라마바', '사']);
  });

  it('break-all 모드는 공백과 무관하게 글자 단위로 채운다', () => {
    expect(wrapText('안녕 하세요', 30, measure, false)).toEqual(['안녕', '하세요']);
  });

  it('줄바꿈 문자를 유지한다', () => {
    expect(wrapText('첫줄\n둘째', 100, measure, true)).toEqual(['첫줄', '둘째']);
  });
});

describe('layoutBubbleText', () => {
  const measureAt = (t: string, size: number) => Array.from(t).length * size;

  it('박스 안에 들어가는 가장 큰 글자 크기를 고른다', () => {
    const layout = layoutBubbleText('가나', 100, 60, true, measureAt, 10, 40);
    expect(layout.fontSize).toBe(35);
    expect(layout.lines).toEqual(['가나']);
    expect(layout.width).toBe(100);
    expect(layout.height).toBe(60);
  });

  it('최소 크기로도 넘치면 박스를 가로 2배까지 키운다', () => {
    const layout = layoutBubbleText('가나다라마바사아자차', 20, 20, true, measureAt, 10, 12);
    expect(layout.fontSize).toBe(10);
    expect(layout.width).toBeGreaterThan(20);
    expect(layout.width).toBeLessThanOrEqual(40);
    expect(layout.height).toBeGreaterThan(20);
  });
});

describe('getDisplayBox', () => {
  it('편집하지 않은 박스는 중심 기준으로 확장한다', () => {
    const [ymin, xmin, ymax, xmax] = getDisplayBox({ box_2d: [100, 100, 200, 200] });
    expect(xmax - xmin).toBeCloseTo(130);
    expect(ymax - ymin).toBeCloseTo(110);
    expect((xmin + xmax) / 2).toBeCloseTo(150);
  });

  it('직접 편집한 박스는 그대로 쓴다', () => {
    expect(getDisplayBox({ box_2d: [1, 2, 3, 4], is_edited_box: true })).toEqual([1, 2, 3, 4]);
  });
});
