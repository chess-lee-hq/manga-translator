import { describe, expect, it } from 'vitest';
import { isLikelySfx, layoutTags, resolveDisplayMode, TAG_SCALE_MAX, TAG_SCALE_MIN, wantsBubbleFit } from './bubbleDisplay';
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

  it('tag_pos가 있으면 자동 배치를 건너뛰고 그 자리를 쓴다', () => {
    const withPos = { ...sfxAt('a', [400, 400, 500, 500]), tag_pos: [100, 200] as [number, number] };
    const tags = layoutTags([withPos], 1000, 1000, 1, measure);
    expect(tags.a.rect.x).toBeCloseTo(200); // 200/1000 * 1000
    expect(tags.a.rect.y).toBeCloseTo(100); // 100/1000 * 1000
  });

  it('tag_pos로 페이지 밖을 가리켜도 안쪽으로 당겨진다', () => {
    const withPos = { ...sfxAt('a', [400, 400, 500, 500]), tag_pos: [-50, 990] as [number, number] };
    const tags = layoutTags([withPos], 1000, 1000, 1, measure);
    expect(tags.a.rect.x).toBeLessThanOrEqual(1000 - tags.a.rect.width);
    expect(tags.a.rect.y).toBeGreaterThanOrEqual(0);
  });

  it('tag_pos로 고정한 딱지도 뒤에 자동 배치되는 딱지가 피해간다', () => {
    // a는 다른 원문(작은 상자)에서 왔지만, b가 자동으로 가려던 자리(436.8, 506)에 직접 옮겨둠
    const pinned = { ...sfxAt('a', [10, 10, 60, 60]), display_mode: 'tag' as const, tag_pos: [436.8, 506] as [number, number] };
    const tags = layoutTags([pinned, sfxAt('b', [400, 400, 500, 500])], 1000, 1000, 1, measure);
    expect(tags.a.rect.x).toBeCloseTo(506);
    expect(tags.a.rect.y).toBeCloseTo(436.8);
    expect(tags.b.rect.x).toBeCloseTo(346); // 오른쪽이 a로 막혀 왼쪽으로 옮김
  });

  it('tag_scale로 딱지 크기를 키우거나 줄인다', () => {
    const base = layoutTags([sfxAt('a', [400, 400, 500, 500])], 1000, 1000, 1, measure);
    const big = layoutTags([{ ...sfxAt('a', [400, 400, 500, 500]), tag_scale: 2 }], 1000, 1000, 1, measure);
    const small = layoutTags([{ ...sfxAt('a', [400, 400, 500, 500]), tag_scale: 0.5 }], 1000, 1000, 1, measure);
    expect(big.a.fontSize).toBeCloseTo(base.a.fontSize * 2);
    expect(big.a.rect.width).toBeCloseTo(base.a.rect.width * 2);
    expect(small.a.fontSize).toBeCloseTo(base.a.fontSize * 0.5);
    expect(big.a.scale).toBe(2);
    expect(base.a.scale).toBe(1);
  });

  it('tag_scale은 허용 범위 밖이면 안쪽으로 잘린다', () => {
    const tooBig = layoutTags([{ ...sfxAt('a', [400, 400, 500, 500]), tag_scale: 99 }], 1000, 1000, 1, measure);
    const tooSmall = layoutTags([{ ...sfxAt('a', [400, 400, 500, 500]), tag_scale: 0.01 }], 1000, 1000, 1, measure);
    expect(tooBig.a.scale).toBe(TAG_SCALE_MAX);
    expect(tooSmall.a.scale).toBe(TAG_SCALE_MIN);
  });
});

describe('wantsBubbleFit (원본 말풍선 모양에 맞춰 넣을 대상)', () => {
  const speech = { translated_text: '진심으로 하는 말이야?', original_text: '本気で言ってるのか', box_2d: [100, 100, 300, 200] as [number, number, number, number] };

  it('덮기 방식이면 기본으로 켜고, 박스를 직접 고쳤거나 세로쓰기를 고르면 끈다', () => {
    expect(wantsBubbleFit(bubble(speech))).toBe(true);
    expect(wantsBubbleFit(bubble({ ...speech, is_edited_box: true }))).toBe(false);
    expect(wantsBubbleFit(bubble({ ...speech, text_direction: 'vertical' }))).toBe(false);
    expect(wantsBubbleFit(bubble({ ...speech, display_mode: 'tag' }))).toBe(false);
  });

  it('사용자가 직접 켜고 끈 값이 자동 판단보다 우선 (단, 작은 딱지는 항상 제외)', () => {
    expect(wantsBubbleFit(bubble({ ...speech, fit_bubble: false }))).toBe(false);
    expect(wantsBubbleFit(bubble({ ...speech, is_edited_box: true, fit_bubble: true }))).toBe(true);
    expect(wantsBubbleFit(bubble({ ...speech, display_mode: 'tag', fit_bubble: true }))).toBe(false);
  });
});
