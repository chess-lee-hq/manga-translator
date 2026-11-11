import { describe, expect, it } from 'vitest';
import { sanitizeResults } from './results';

describe('sanitizeResults', () => {
  it('AI가 넣은 줄바꿈 추천(|)은 번역문에서 떼어 line_hints로 옮기고, 맞지 않는 예전 추천은 버린다', () => {
    const [fresh, stale] = sanitizeResults([
      { box_2d: [0, 0, 10, 10], translated_text: '9동 통로 | 엘리베이터 부근' },
      { box_2d: [0, 0, 10, 10], translated_text: '고친 번역', line_hints: '예전 \u200B번역' },
    ])!;
    expect(fresh.translated_text).toBe('9동 통로 엘리베이터 부근');
    expect(fresh.line_hints).toBe('9동 통로 \u200B엘리베이터 부근');
    expect(stale.line_hints).toBeUndefined();
    // 다시 읽어도(저장 → 불러오기) 그대로
    expect(sanitizeResults([fresh])![0].line_hints).toBe(fresh.line_hints);
  });

  it('배열이 아니면 null을 반환한다', () => {
    expect(sanitizeResults(null)).toBeNull();
    expect(sanitizeResults({})).toBeNull();
  });

  it('좌표가 깨진 항목을 제거하고 id를 보장한다', () => {
    const cleaned = sanitizeResults([
      { original_text: 'a', translated_text: '가', box_2d: [1, 2, 3, 4] },
      null,
      { original_text: 'b', translated_text: '나' },
      { id: 'keep', translated_text: '다', box_2d: [1, 2, 3, 4] },
      { id: 'bad', translated_text: '라', box_2d: [1, 2, 'x', 4] },
    ]);
    expect(cleaned).toHaveLength(2);
    expect(cleaned![0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(cleaned![1]).toMatchObject({ id: 'keep', original_text: '', translated_text: '다' });
  });
});

describe('sanitizeResults — 빈 번역 자동 정리', () => {
  it('번역문이 비었거나 공백뿐인 항목은 버린다 (그림을 글자로 잘못 인식한 빈 자리)', () => {
    const cleaned = sanitizeResults([
      { id: 'keep', original_text: 'あ', translated_text: '가', box_2d: [1, 2, 3, 4] },
      { id: 'empty', original_text: 'い', translated_text: '', box_2d: [1, 2, 3, 4] },
      { id: 'blank', original_text: 'う', translated_text: '   ', box_2d: [1, 2, 3, 4] },
    ]);
    expect(cleaned?.map(r => r.id)).toEqual(['keep']);
  });

  it('표시 설정은 알려진 값만 남긴다', () => {
    const [result] = sanitizeResults([
      { id: 'a', translated_text: '가', box_2d: [1, 2, 3, 4], display_mode: 'tag', text_direction: 'vertical' },
    ])!;
    expect(result).toMatchObject({ display_mode: 'tag', text_direction: 'vertical' });
    const [odd] = sanitizeResults([
      { id: 'b', translated_text: '가', box_2d: [1, 2, 3, 4], display_mode: 'weird', text_direction: 'diagonal' },
    ])!;
    expect(odd.display_mode).toBeUndefined();
    expect(odd.text_direction).toBeUndefined();
  });

  it('작은 딱지 수동 위치(tag_pos)는 숫자 2개짜리만 남긴다', () => {
    const [ok] = sanitizeResults([
      { id: 'a', translated_text: '가', box_2d: [1, 2, 3, 4], tag_pos: [100, 200] },
    ])!;
    expect(ok.tag_pos).toEqual([100, 200]);
    const [missing, bad, wrongLength] = sanitizeResults([
      { id: 'b', translated_text: '가', box_2d: [1, 2, 3, 4] },
      { id: 'c', translated_text: '가', box_2d: [1, 2, 3, 4], tag_pos: [100, 'x'] },
      { id: 'd', translated_text: '가', box_2d: [1, 2, 3, 4], tag_pos: [100, 200, 300] },
    ])!;
    expect(missing.tag_pos).toBeUndefined();
    expect(bad.tag_pos).toBeUndefined();
    expect(wrongLength.tag_pos).toBeUndefined();
  });

  it('딱지 크기 배율(tag_scale)은 허용 범위 안으로 잘라 저장한다', () => {
    const [normal, tooBig, tooSmall, notNumber] = sanitizeResults([
      { id: 'a', translated_text: '가', box_2d: [1, 2, 3, 4], tag_scale: 1.5 },
      { id: 'b', translated_text: '가', box_2d: [1, 2, 3, 4], tag_scale: 99 },
      { id: 'c', translated_text: '가', box_2d: [1, 2, 3, 4], tag_scale: 0.01 },
      { id: 'd', translated_text: '가', box_2d: [1, 2, 3, 4], tag_scale: 'big' },
    ])!;
    expect(normal.tag_scale).toBe(1.5);
    expect(tooBig.tag_scale).toBe(3);
    expect(tooSmall.tag_scale).toBe(0.5);
    expect(notNumber.tag_scale).toBeUndefined();
  });
});

describe('sanitizeResults — 말풍선 맞춤 설정', () => {
  it('fit_bubble은 true/false만 남긴다', () => {
    const [on, off, junk] = sanitizeResults([
      { box_2d: [0, 0, 1, 1], translated_text: 'a', fit_bubble: true },
      { box_2d: [0, 0, 1, 1], translated_text: 'b', fit_bubble: false },
      { box_2d: [0, 0, 1, 1], translated_text: 'c', fit_bubble: 'yes' },
    ])!;
    expect([on.fit_bubble, off.fit_bubble, junk.fit_bubble]).toEqual([true, false, undefined]);
  });
});
