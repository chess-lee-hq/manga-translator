import { describe, expect, it } from 'vitest';
import { buildGridPrompt, READING_RULES } from './translationPrompt';

describe('원문 읽기 규칙', () => {
  it('요미가나를 만들어 붙이라고 요구하지 않고, 인쇄된 루비는 빼라고 지시한다', () => {
    expect(READING_RULES).not.toContain('요미가나를 적어');
    expect(READING_RULES).toContain('루비');
    expect(buildGridPrompt({ expectedCells: 1, output: 'cells' })).not.toContain('漢字(かんじ)');
  });
});
