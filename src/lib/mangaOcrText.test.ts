import { describe, expect, it } from 'vitest';
import { decodeOcrTokens, isOcrMismatch, textSimilarity } from './mangaOcrText';

describe('decodeOcrTokens', () => {
  it('특수 토큰을 빼고, ## 조각과 공백을 붙이고, 말줄임표를 점으로', () => {
    const vocab = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', '[MASK]', '本', '##気', 'か', '…'];
    expect(decodeOcrTokens([2, 5, 6, 7, 8, 3], vocab)).toBe('本気か...');
  });
});

describe('isOcrMismatch', () => {
  it('요미가나·문장부호·작은 가나 차이는 같은 원문으로 본다', () => {
    expect(isOcrMismatch('本気(ほんき)か……！', '本気か')).toBe(false);
    expect(isOcrMismatch('ちょっと待って', 'ちよつと待つて')).toBe(false);
    expect(textSimilarity('本気か', '本気か')).toBe(1);
  });

  it('절반 넘게 다르면 불일치', () => {
    expect(isOcrMismatch('木当に行くのか', 'お前は誰だ')).toBe(true);
  });

  it('짧은 원문이나 로컬 OCR이 아무것도 못 읽은 경우는 판단하지 않는다', () => {
    expect(isOcrMismatch('ドン', 'バン')).toBe(false);
    expect(isOcrMismatch('本当に行くのか', '')).toBe(false);
  });
});
