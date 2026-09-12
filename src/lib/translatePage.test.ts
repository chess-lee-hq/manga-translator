import { describe, expect, it } from 'vitest';
import { mapGridToResults } from './translatePage';
import type { BoundingBox } from './yoloPostprocess';

const cell = (id: number, box: Partial<BoundingBox> = {}) => ({
  id,
  box: { xmin: 0, ymin: 0, xmax: 100, ymax: 200, confidence: 1, classId: 3, ...box } as BoundingBox,
});

describe('mapGridToResults', () => {
  const cells = [cell(1), cell(2, { xmin: 200, xmax: 400, ymin: 300, ymax: 600 })];

  it('칸의 픽셀 좌표를 0~1000 좌표로 바꾼다', () => {
    const [first] = mapGridToResults([{ id: 1, original_text: 'あ', translated_text: '가' }], cells, 1000, 2000);
    expect(first.box_2d).toEqual([0, 0, 100, 100]);
  });

  it('같은 칸 번호가 두 번 오면 첫 번째만 쓴다 (중복 번역 방지)', () => {
    const results = mapGridToResults([
      { id: 1, original_text: 'あ', translated_text: '가' },
      { id: 1, original_text: 'あ', translated_text: '가(중복)' },
      { id: 2, original_text: 'い', translated_text: '나' },
    ], cells, 1000, 2000);
    expect(results.map(r => r.translated_text)).toEqual(['가', '나']);
  });

  it('없는 칸 번호는 버린다', () => {
    expect(mapGridToResults([{ id: 99, original_text: 'x', translated_text: 'y' }], cells, 1000, 2000)).toEqual([]);
  });
});
