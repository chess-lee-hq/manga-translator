import { describe, expect, it } from 'vitest';
import { buildGridPrompt, buildShortenPrompt, READING_RULES } from './translationPrompt';

describe('원문 읽기 규칙', () => {
  it('요미가나를 만들어 붙이라고 요구하지 않고, 인쇄된 루비는 빼라고 지시한다', () => {
    expect(READING_RULES).not.toContain('요미가나를 적어');
    expect(READING_RULES).toContain('루비');
    expect(buildGridPrompt({ expectedCells: 1, output: 'cells' })).not.toContain('漢字(かんじ)');
  });
});

describe('짧게 다시 번역 프롬프트', () => {
  it('목표 글자 수·지금 번역문·원문과 말투 유지 지시를 담는다', () => {
    const prompt = buildShortenPrompt('本気で言ってるのか', '진심으로 하는 말이야?', 8, { glossary: { 本気: '진심' } });
    expect(prompt).toContain('8자 이내');
    expect(prompt).toContain('진심으로 하는 말이야?');
    expect(prompt).toContain('本気で言ってるのか');
    expect(prompt).toContain('말투');
    expect(prompt).toContain('本気 -> 진심');
  });
});
