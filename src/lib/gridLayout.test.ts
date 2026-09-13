import { describe, expect, it } from 'vitest';
import { chooseGridColumns, estimateVisionTokens } from './gridLayout';

describe('estimateVisionTokens', () => {
  it('작은 이미지는 512 타일 1개', () => {
    expect(estimateVisionTokens(300, 300)).toBe(1 * 170 + 85);
  });

  it('짧은 변이 768을 넘으면 768로 줄여서 계산한다', () => {
    // 900x1200 → 짧은 변(900)을 768로 줄이면 768x1024 → 2x2 = 4타일
    expect(estimateVisionTokens(900, 1200)).toBe(4 * 170 + 85);
  });

  it('긴 변이 2048을 넘으면 2048로 먼저 줄인다', () => {
    const tokens = estimateVisionTokens(4096, 512);
    // 4096x512 → 긴 변 2048로 줄이면 2048x256 → 짧은 변(256)은 768 미만이라 그대로
    expect(tokens).toBe(Math.ceil(2048 / 512) * Math.ceil(256 / 512) * 170 + 85);
  });
});

describe('chooseGridColumns', () => {
  it('칸이 1개면 1열', () => {
    expect(chooseGridColumns(1, 300)).toBe(1);
  });

  it('선택한 열 수로 모든 칸이 빠짐없이 배치된다 (낭비 칸은 있어도 됨)', () => {
    for (let n = 1; n <= 16; n++) {
      const columns = chooseGridColumns(n, 300);
      const rows = Math.ceil(n / columns);
      expect(columns).toBeGreaterThanOrEqual(1);
      expect(columns * rows).toBeGreaterThanOrEqual(n);
    }
  });

  it('실제로 후보 중 토큰이 최소인 열 수를 고른다 (전수조사와 비교)', () => {
    for (let n = 1; n <= 12; n++) {
      const columns = chooseGridColumns(n, 300);
      const chosenTokens = estimateVisionTokens(columns * 300, Math.ceil(n / columns) * 300);
      for (let c = 1; c <= n; c++) {
        const tokens = estimateVisionTokens(c * 300, Math.ceil(n / c) * 300);
        expect(tokens).toBeGreaterThanOrEqual(chosenTokens);
      }
    }
  });
});

describe('묶음 처리 토큰 절감 (추정식 기준)', () => {
  const PROMPT_TOKENS = 1000; // 지침 + 단어장 + 맥락 (요청당 1회)
  const costOf = (cellCount: number) => {
    const columns = chooseGridColumns(cellCount, 300);
    const rows = Math.ceil(cellCount / columns);
    return estimateVisionTokens(columns * 300, rows * 300) + PROMPT_TOKENS;
  };

  it('6칸 페이지 3장은 따로 보내는 것보다 한 번에 묶는 편이 싸다', () => {
    const separate = costOf(6) * 3;
    const batched = costOf(18);
    expect(batched).toBeLessThan(separate);
    // 대략 절반 이하로 떨어져야 묶는 의미가 있음
    expect(batched).toBeLessThan(separate * 0.6);
  });
});
