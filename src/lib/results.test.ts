import { describe, expect, it } from 'vitest';
import { sanitizeResults } from './results';

describe('sanitizeResults', () => {
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
});
