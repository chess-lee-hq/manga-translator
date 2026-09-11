import { describe, expect, it } from 'vitest';
import { isLikelySfx, layoutTags, resolveDisplayMode } from './bubbleDisplay';
import type { TranslationResult } from './gemini';

const bubble = (over: Partial<TranslationResult>): TranslationResult => ({
  id: 'x',
  original_text: '',
  translated_text: '',
  box_2d: [0, 0, 100, 100],
  ...over,
});
// 글자당 fontSize px 고정폭
const measure = (text: string, fontSize: number) => Array.from(text).length * fontSize;

describe('isLikelySfx', () => {
  it('짧은 번역 + 아주 큰 원문 글씨는 효과음으로 본다', () => {
    expect(isLikelySfx(bubble({ original_text: 'ドン', translated_text: '쾅!', box_2d: [100, 100, 350, 400] }))).toBe(true);
  });

  it('긴 대사는 글씨가 커도 덮기', () => {
    expect(isLikelySfx(bubble({ original_text: 'お前は何を言っているんだ', translated_text: '너 지금 무슨 소리야', box_2d: [100, 100, 400, 400] }))).toBe(false);
  });

  it('작은 영역의 짧은 대사는 덮기', () => {
    expect(isLikelySfx(bubble({ original_text: 'え？', translated_text: '응?', box_2d: [100, 100, 160, 140] }))).toBe(false);
  });

  it('영역이 커도 원문 글자가 많아 한 글자가 작으면 덮기', () => {
    expect(isLikelySfx(bubble({ original_text: 'ゴゴゴゴゴゴゴゴ', translated_text: '우르릉', box_2d: [100, 100, 150, 400] }))).toBe(false);
  });
});

describe('resolveDisplayMode', () => {
  it('직접 고른 방식이 자동 판별보다 우선한다', () => {
    const sfx = bubble({ original_text: 'ドン', translated_text: '쾅!', box_2d: [100, 100, 350, 400] });
    expect(resolveDisplayMode(sfx)).toBe('tag');
    expect(resolveDisplayMode({ ...sfx, display_mode: 'cover' })).toBe('cover');
    expect(resolveDisplayMode(bubble({ translated_text: '긴 대사입니다 정말로요', display_mode: 'tag' }))).toBe('tag');
  });
});

describe('layoutTags', () => {
  // 페이지 1000×1000px, 배율 1 → 글자 16px, 여백 8/4px, 간격 6px, '쾅!' = 폭 48 × 높이 26.4
  const sfxAt = (id: string, box_2d: [number, number, number, number]) => bubble({ id, original_text: 'ドン', translated_text: '쾅!', box_2d });

  it('기본은 원문 영역 바깥 오른쪽, 세로 가운데', () => {
    const tags = layoutTags([sfxAt('a', [400, 400, 500, 500])], 1000, 1000, 1, measure);
    expect(tags.a.lines).toEqual(['쾅!']);
    expect(tags.a.rect.x).toBeCloseTo(506);
    expect(tags.a.rect.y).toBeCloseTo(436.8);
    expect(tags.a.rect.width).toBeCloseTo(48);
    expect(tags.a.rect.height).toBeCloseTo(26.4);
  });

  it('오른쪽이 페이지 밖이면 왼쪽 바깥에 둔다', () => {
    const tags = layoutTags([sfxAt('a', [400, 900, 500, 1000])], 1000, 1000, 1, measure);
    expect(tags.a.rect.x).toBeCloseTo(846);
  });

  it('오른쪽에 다른 말풍선이 있으면 피한다', () => {
    const dialogue = bubble({ id: 'd', translated_text: '여기는 긴 대사가 들어가는 자리', box_2d: [400, 510, 500, 700], is_edited_box: true });
    const tags = layoutTags([sfxAt('a', [400, 400, 500, 500]), dialogue], 1000, 1000, 1, measure);
    expect(tags.a.rect.x).toBeCloseTo(346);
    expect(tags.d).toBeUndefined();
  });

  it('딱지끼리 겹치지 않게 다음 후보로 옮긴다', () => {
    const tags = layoutTags([sfxAt('a', [400, 400, 500, 500]), sfxAt('b', [400, 400, 500, 500])], 1000, 1000, 1, measure);
    expect(tags.a.rect.x).toBeCloseTo(506);
    expect(tags.b.rect.x).toBeCloseTo(346);
  });

  it('배율에 비례해 커진다', () => {
    const tags = layoutTags([sfxAt('a', [400, 400, 500, 500])], 2000, 2000, 2, measure);
    expect(tags.a.rect.x).toBeCloseTo(1012);
    expect(tags.a.rect.width).toBeCloseTo(96);
  });
});
