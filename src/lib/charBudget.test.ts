import { describe, expect, it } from 'vitest';
import { buildLengthHint, sampleSentence } from './charBudget';
import { buildGridPromptParts } from './translationPrompt';

describe('charBudget', () => {
  it('흉내 대사는 공백 빼고 n글자, 3글자마다 띄어쓰기', () => {
    expect(sampleSentence(7)).toBe('가나다 가나다 가');
    expect(sampleSentence(7).replace(/\s/g, '')).toHaveLength(7);
    expect(sampleSentence(3)).toBe('가나다');
  });

  it('한도가 있는 칸만 프롬프트 안내에 넣는다', () => {
    const hint = buildLengthHint([{ id: 1, charLimit: 14 }, { id: 2, charLimit: null }, { id: 3, charLimit: 6 }]);
    expect(hint).toContain('#1 14자 · #3 6자');
    expect(hint).not.toContain('#2');
    expect(buildLengthHint([{ id: 1 }])).toBe('');
  });

  it('글자 수 안내는 캐시가 걸리지 않는 뒷부분(매번 바뀌는 구간)에 들어간다', () => {
    const parts = buildGridPromptParts({ expectedCells: 3, glossary: [], lengthHint: buildLengthHint([{ id: 1, charLimit: 9 }]) } as never);
    expect(parts.volatile).toContain('#1 9자');
    expect(parts.stable).not.toContain('칸별 글자 수');
  });
});
