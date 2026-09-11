import { describe, expect, it } from 'vitest';
import { getExportScale } from './exportCanvas';
import { estimateFontRatios, getDisplayBox, layoutOverlayText, overlayFontSize, wrapText } from './overlayLayout';

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

describe('estimateFontRatios / overlayFontSize (화면 오버레이 공식)', () => {
  it('글자 수와 박스 비율로 글자 크기를 정하고 최소·최대로 제한한다', () => {
    // 4글자, 가로:세로 = 1 → 한 줄 2글자, 2줄
    const ratios = estimateFontRatios({ translated_text: '가나다라' }, [0, 0, 100, 100]);
    expect(ratios.maxCqi).toBeCloseTo(42.5);
    expect(ratios.maxCqh).toBeCloseTo(39.13, 2);
    expect(overlayFontSize(ratios, 200, 200, 13, 28)).toBe(28);
    expect(overlayFontSize(ratios, 20, 20, 13, 28)).toBe(13);
    expect(overlayFontSize(ratios, 40, 40, 13, 28)).toBeCloseTo(15.652, 2);
  });
});

describe('layoutOverlayText (화면 CSS 배치 재현)', () => {
  // 글자 20px(줄 높이 23px), 여백 좌우 8px·상하 4px
  it('짧은 글은 박스 크기 그대로 한 줄', () => {
    expect(layoutOverlayText('안녕', 100, 50, 20, true, measure, 1)).toEqual({ lines: ['안녕'], width: 100, height: 50 });
  });

  it('박스 너비(여백 제외) 안에서 공백 단위로 줄바꿈하고, 넘치면 높이가 늘어난다', () => {
    expect(layoutOverlayText('안녕 하세요 반가워요', 80, 40, 20, true, measure, 1)).toEqual({
      lines: ['안녕 하세요', '반가워요'],
      width: 80,
      height: 54,
    });
  });

  it('끊을 수 없는 긴 단어는 상자를 넓혀 한 줄로 둔다', () => {
    expect(layoutOverlayText('가나다라마바사아', 50, 40, 20, true, measure, 1)).toEqual({
      lines: ['가나다라마바사아'],
      width: 96,
      height: 40,
    });
  });

  it('박스 2배로도 모자라면 2배 너비에서 글자 단위로 자른다', () => {
    expect(layoutOverlayText('가나다라마바사아자차카타파하거', 50, 40, 20, true, measure, 1)).toEqual({
      lines: ['가나다라마바사아', '자차카타파하거'],
      width: 100,
      height: 54,
    });
  });

  it('단어 묶음 해제(break-all)는 공백과 무관하게 글자 단위로 채운다', () => {
    expect(layoutOverlayText('안녕 하세요', 40, 40, 20, false, measure, 1)).toEqual({
      lines: ['안녕', '하세', '요'],
      width: 40,
      height: 77,
    });
  });
});

describe('getExportScale', () => {
  it('작은 원본은 목표 높이(2400px)까지 키우되 최대 3배', () => {
    expect(getExportScale(800, 1200)).toBe(2);
    expect(getExportScale(400, 600)).toBe(3);
  });

  it('충분히 큰 원본은 그대로', () => {
    expect(getExportScale(2000, 3000)).toBe(1);
  });

  it('출력 픽셀 수 상한을 넘지 않는다', () => {
    const scale = getExportScale(5000, 1500);
    expect(5000 * 1500 * scale * scale).toBeLessThanOrEqual(16_000_000 + 1);
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
