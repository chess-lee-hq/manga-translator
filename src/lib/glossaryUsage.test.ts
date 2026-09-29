import { describe, expect, it } from 'vitest';
import { countGlossaryUsage } from './glossaryUsage';

describe('countGlossaryUsage', () => {
  it('요미가나·띄어쓰기를 무시하고, 단어가 들어 있는 대사 줄 수를 센다', () => {
    const counts = countGlossaryUsage(
      ['権(ごん)さん', '晴信', '川坊'],
      ['権さん、待って', '晴信(はるのぶ)様', '晴信 が来た', '権(ごん)さんだ'],
    );
    expect(counts).toEqual({ '権(ごん)さん': 2, 晴信: 2, 川坊: 0 });
  });
});
