import { describe, expect, it } from 'vitest';
import { applyBreakHints, balancedWrap, BREAK_HINT, extractBreakHints, layoutTextOf, opticalShift, stripBreakHints } from './koreanLineBreak';

/** 글자 10, 공백 5, 문장부호 5 */
const m = (t: string) => Array.from(t).reduce((w, ch) => w + (ch === ' ' ? 5 : /[.,!?]/.test(ch) ? 5 : ch === BREAK_HINT ? 0 : 10), 0);

describe('balancedWrap', () => {
  it('앞줄만 꽉 채우지 않고 줄 길이를 고르게 나눈다', () => {
    // 앞줄부터 채우면 "가나다 라마바 사아" / "자" (마지막 한 글자)
    const lines = balancedWrap('가나다 라마바 사아 자', [100, 100], m, false);
    expect(lines).toEqual(['가나다 라마바', '사아 자']);
  });

  it('가운데가 넓은 말풍선이면 가운데 줄이 가장 길다', () => {
    const lines = balancedWrap('9동 3층 서쪽 통로 엘리베이터 부근입니다. 들것 급히 요망!', [100, 160, 100], m, false)!;
    expect(lines).toHaveLength(3);
    expect(m(lines[1])).toBeGreaterThanOrEqual(m(lines[0]));
    expect(m(lines[1])).toBeGreaterThanOrEqual(m(lines[2]));
  });

  it('AI가 추천한 자리(띄어쓰기)에서 우선 끊는다', () => {
    const plain = balancedWrap('가나 다라 마바 사아 자', [80, 80], m, false);
    const hinted = balancedWrap(applyBreakHints('가나 다라 마바 | 사아 자'), [80, 80], m, false);
    expect(plain).toEqual(['가나 다라', '마바 사아 자']);
    expect(hinted).toEqual(['가나 다라 마바', '사아 자']);
  });

  it('줄 수는 가장 적게 쓴다', () => {
    expect(balancedWrap('가나 다라', [100, 100, 100], m, false)).toEqual(['가나 다라']);
  });

  it('어절을 꼭 잘라야 하면 어미 앞에서 자르고, 한 글자나 문장부호만 떨어뜨리지 않는다', () => {
    const lines = balancedWrap('괜찮으십니까?', [45, 45], m, true);
    expect(lines).toEqual(['괜찮으십', '니까?']);
    expect(balancedWrap('괜찮으십니까?', [45, 45], m, false)).toBeNull();
  });

  it('문단 줄바꿈은 지킨다', () => {
    expect(balancedWrap('가나\n다라', [200, 200], m, false)).toEqual(['가나', '다라']);
  });

  it('들어가지 않으면 null', () => {
    expect(balancedWrap('가나다라 마바사아', [30, 30], m, false)).toBeNull();
  });
});

describe('applyBreakHints / stripBreakHints', () => {
  it('띄어쓰기 자리 표시만 보이지 않는 추천 자리로, 어절 안·앞뒤 표시는 지운다', () => {
    expect(applyBreakHints('통로 | 엘리베이터')).toBe(`통로 ${BREAK_HINT}엘리베이터`);
    expect(applyBreakHints('괜찮|으십니까')).toBe('괜찮으십니까');
    expect(applyBreakHints('| 가나 |')).toBe('가나');
    expect(stripBreakHints(applyBreakHints('가 | 나'))).toBe('가 나');
  });
});

describe('opticalShift', () => {
  it('줄 끝 문장부호만큼 오른쪽으로 밀어 글자가 가운데로 보이게 한다', () => {
    expect(opticalShift('요망.', m)).toBeCloseTo(2.5);
    expect(opticalShift('요망!', m)).toBeCloseTo(1.25);
    expect(opticalShift('요망', m)).toBe(0);
    expect(opticalShift('?', m)).toBe(0);
  });
});

describe('extractBreakHints / layoutTextOf', () => {
  it('번역문에서는 표시를 떼고, 줄바꿈 추천은 따로 둔다', () => {
    const { text, hints } = extractBreakHints('통로 | 엘리베이터 부근');
    expect(text).toBe('통로 엘리베이터 부근');
    expect(layoutTextOf({ translated_text: text, line_hints: hints })).toBe(hints);
  });

  it('번역문을 고치면 예전 추천은 무시한다', () => {
    const { hints } = extractBreakHints('통로 | 엘리베이터 부근');
    expect(layoutTextOf({ translated_text: '통로 근처', line_hints: hints })).toBe('통로 근처');
  });

  it('표시가 없으면 추천도 없다', () => {
    expect(extractBreakHints('가나다')).toEqual({ text: '가나다' });
    expect(extractBreakHints('가|나')).toEqual({ text: '가나' });
  });
});
