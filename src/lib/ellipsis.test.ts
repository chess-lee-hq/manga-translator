import { describe, expect, it } from 'vitest';
import { normalizeEllipsis } from './ellipsis';
import { sanitizeResults } from './results';
import { TRANSLATION_RULES } from './translationPrompt';

describe('normalizeEllipsis (말줄임표는 점 2개로)', () => {
  it('점이 3개 이상이면 개수와 상관없이 ".."', () => {
    expect(normalizeEllipsis('그래...')).toBe('그래..');
    expect(normalizeEllipsis('......뭐?')).toBe('..뭐?');
    expect(normalizeEllipsis('아니.......... 괜찮아')).toBe('아니.. 괜찮아');
  });

  it('말줄임 문자(…·‥)와 일본식 점(・・・, 。。。, 전각 ．．．)도 ".."', () => {
    expect(normalizeEllipsis('그래……')).toBe('그래..');
    expect(normalizeEllipsis('뭐…')).toBe('뭐..');
    expect(normalizeEllipsis('음‥')).toBe('음..');
    expect(normalizeEllipsis('・・・정말?')).toBe('..정말?');
    expect(normalizeEllipsis('그게。。。')).toBe('그게..');
    expect(normalizeEllipsis('에．．．')).toBe('에..');
    expect(normalizeEllipsis('앗.…!')).toBe('앗..!');
  });

  it('마침표 하나, 점 2개, 이름 사이 가운뎃점 하나는 그대로', () => {
    expect(normalizeEllipsis('알았어. 가자.')).toBe('알았어. 가자.');
    expect(normalizeEllipsis('음..')).toBe('음..');
    expect(normalizeEllipsis('앨리스·마가렛')).toBe('앨리스·마가렛');
  });

  it('새 번역·예전 기록을 거르는 sanitizeResults에서도 적용', () => {
    const [result] = sanitizeResults([{ box_2d: [0, 0, 1, 1], original_text: 'そう……', translated_text: '그렇구나……' }])!;
    expect(result.translated_text).toBe('그렇구나..');
    expect(result.original_text).toBe('そう……');
  });

  it('번역 지침에 점 2개 규칙이 들어 있다', () => {
    expect(TRANSLATION_RULES).toContain('점 2개(..)');
  });
});
