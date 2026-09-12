import { describe, expect, it } from 'vitest';
import { layoutVerticalText, resolveTextDirection } from './overlayLayout';

const bubble = (translated_text: string, text_direction?: 'horizontal' | 'vertical') => ({ translated_text, text_direction });

describe('resolveTextDirection', () => {
  // 최소 글자 10px, 여백 좌우 8px씩, 가로쓰기는 최대 2배(maxWidthRatio)까지 넓힐 수 있음
  // → 너비 20px 박스는 넓혀도(40px) 한 줄에 2.4자밖에 못 들어감 → 세로쓰기
  it('가로쓰기 최대 확장 너비로도 한 줄에 3글자도 못 들어가면 세로쓰기', () => {
    expect(resolveTextDirection(bubble('세로로 긴 글자'), 20, 300, 10, 1)).toBe('vertical');
  });

  // 너비 40px 박스는 넓히면(80px) 6.4자가 들어가므로, 원본 박스가 좁아도 짧은 번역문은 가로쓰기로 충분함
  it('원본 박스가 좁아도 넓혀서 쓸 수 있으면 가로쓰기 (번역문이 짧을 때 세로쓰기로 잘못 판정되던 문제)', () => {
    expect(resolveTextDirection(bubble('너무 변한게 없어'), 40, 300, 10, 1)).toBe('horizontal');
  });

  it('가로 폭이 넉넉하면 가로쓰기', () => {
    expect(resolveTextDirection(bubble('평범한 대사입니다'), 120, 300, 10, 1)).toBe('horizontal');
    expect(resolveTextDirection(bubble('평범한 대사입니다'), 200, 150, 10, 1)).toBe('horizontal');
  });

  it('한 글자뿐이면 가로쓰기', () => {
    expect(resolveTextDirection(bubble('쾅'), 20, 300, 10, 1)).toBe('horizontal');
  });

  it('직접 고른 방향이 자동 판별보다 우선', () => {
    expect(resolveTextDirection(bubble('평범한 대사입니다', 'vertical'), 200, 150, 10, 1)).toBe('vertical');
    expect(resolveTextDirection(bubble('세로로 긴 글자', 'horizontal'), 20, 300, 10, 1)).toBe('horizontal');
  });
});

describe('layoutVerticalText', () => {
  it('박스 높이에 맞춰 한 열로 세우고, 흰 상자는 최소한 박스 크기', () => {
    // 6글자 → 글자 20px이면 칸 21px × 6 = 126 + 여백 8 = 134 ≤ 300, 열 너비 22 + 16 = 38 ≤ 40
    const layout = layoutVerticalText('가나다라마바', 40, 300, 10, 28, 1);
    expect(layout.columns).toHaveLength(1);
    expect(layout.columns[0]).toEqual(['가', '나', '다', '라', '마', '바']);
    expect(layout.fontSize).toBeLessThanOrEqual(28);
    expect(layout.width).toBeGreaterThanOrEqual(40);
    expect(layout.height).toBeGreaterThanOrEqual(300);
  });

  it('한 열에 안 들어가면 왼쪽으로 열을 늘린다 (첫 열이 오른쪽)', () => {
    const layout = layoutVerticalText('가나다라마바사아자차카타파하', 40, 60, 10, 12, 1);
    expect(layout.columns.length).toBeGreaterThan(1);
    expect(layout.columns[0][0]).toBe('가');
    expect(layout.columns.flat().join('')).toBe('가나다라마바사아자차카타파하');
  });

  it('줄바꿈은 새 열로 시작한다', () => {
    const layout = layoutVerticalText('가나\n다라', 60, 300, 10, 20, 1);
    expect(layout.columns).toEqual([['가', '나'], ['다', '라']]);
  });

  it('좁은 박스에서는 글자 크기를 줄여 맞춘다', () => {
    const wide = layoutVerticalText('가나다', 80, 300, 10, 28, 1);
    const narrow = layoutVerticalText('가나다', 30, 300, 10, 28, 1);
    expect(narrow.fontSize).toBeLessThan(wide.fontSize);
  });
});
