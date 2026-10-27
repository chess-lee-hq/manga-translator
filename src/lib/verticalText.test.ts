import { describe, expect, it } from 'vitest';
import { layoutVerticalText, resolveTextDirection, verticalCells, type VerticalCell } from './overlayLayout';

const texts = (columns: VerticalCell[][]) => columns.map(column => column.map(cell => cell.text));

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
    expect(texts(layout.columns)[0]).toEqual(['가', '나', '다', '라', '마', '바']);
    expect(layout.fontSize).toBeLessThanOrEqual(28);
    expect(layout.width).toBeGreaterThanOrEqual(40);
    expect(layout.height).toBeGreaterThanOrEqual(300);
  });

  it('한 열에 안 들어가면 왼쪽으로 열을 늘린다 (첫 열이 오른쪽)', () => {
    const layout = layoutVerticalText('가나다라마바사아자차카타파하', 40, 60, 10, 12, 1);
    expect(layout.columns.length).toBeGreaterThan(1);
    expect(layout.columns[0][0].text).toBe('가');
    expect(texts(layout.columns).flat().join('')).toBe('가나다라마바사아자차카타파하');
  });

  it('줄바꿈은 새 열로 시작한다', () => {
    const layout = layoutVerticalText('가나\n다라', 60, 300, 10, 20, 1);
    expect(texts(layout.columns)).toEqual([['가', '나'], ['다', '라']]);
  });

  it('좁은 박스에서는 글자 크기를 줄여 맞춘다', () => {
    const wide = layoutVerticalText('가나다', 80, 300, 10, 28, 1);
    const narrow = layoutVerticalText('가나다', 30, 300, 10, 28, 1);
    expect(narrow.fontSize).toBeLessThan(wide.fontSize);
  });
});

describe('verticalCells — 세로쓰기 칸 나누기', () => {
  const cells = (text: string) => verticalCells(text).map(c => `${c.text}:${c.kind}${c.size !== 1 ? `:${c.size}` : ''}`);

  it('느낌표·물음표도 한 글자처럼 한 칸씩 세운다', () => {
    expect(cells('뭐야?!')).toEqual(['뭐:upright', '야:upright', '?:upright', '!:upright']);
  });

  it('마침표·쉼표는 칸 오른쪽 위로 옮길 표시를 붙인다', () => {
    expect(cells('그래, 알았어.')).toEqual(['그:upright', '래:upright', ',:corner', ' :upright:0.5', '알:upright', '았:upright', '어:upright', '.:corner']);
  });

  it('말줄임(..)은 두 점을 한 칸에 눕힌다 (점이 더 많아도 한 칸)', () => {
    expect(cells('그건..')).toEqual(['그:upright', '건:upright', '..:rotate']);
    expect(cells('음...')).toEqual(['음:upright', '..:rotate']);
  });

  it('물결·장음·괄호는 눕히고, 연속 공백은 반 칸 하나로, 앞뒤 공백은 버린다', () => {
    expect(cells(' 좋아~  (진짜) ')).toEqual(['좋:upright', '아:upright', '~:rotate', ' :upright:0.5', '(:rotate', '진:upright', '짜:upright', '):rotate']);
  });

  it('세로 상자 배치에서 띄어쓰기는 반 칸만 차지한다', () => {
    // 칸 21px (글자 20px). "가 나"는 2.5칸 = 52.5px + 여백 8 → 높이 61이면 한 열에 들어감
    const layout = layoutVerticalText('가 나', 40, 61, 20, 20, 1);
    expect(layout.columns).toHaveLength(1);
  });
});

describe('layoutVerticalText — 마지막 열에 한두 글자만 남으면 한 줄로', () => {
  it('「시나노국 기소 골짜기」가 두 열(…골짜/기)로 갈리지 않고 상자를 세로로 늘려 한 열', () => {
    // 세로 9칸 남짓 들어가는 좁은 상자 (10글자 + 띄어쓰기 2)
    const layout = layoutVerticalText('시나노국 기소 골짜기', 30, 130, 10, 12, 1);
    expect(layout.columns).toHaveLength(1);
    expect(layout.height).toBeGreaterThan(130);
  });

  it('남는 글자가 많으면 그대로 여러 열', () => {
    const layout = layoutVerticalText('가나다라마바사아자차카타파하', 60, 80, 10, 12, 1);
    expect(layout.columns.length).toBeGreaterThanOrEqual(2);
  });
});
