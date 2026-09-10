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
