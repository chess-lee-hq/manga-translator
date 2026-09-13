import { describe, expect, it } from 'vitest';
import { mapGridToPages, mapGridToResults } from './translatePage';
import type { BoundingBox } from './yoloPostprocess';

const box = (over: Partial<BoundingBox> = {}) =>
  ({ xmin: 0, ymin: 0, xmax: 100, ymax: 200, confidence: 1, classId: 3, ...over }) as BoundingBox;
const cell = (id: number, pageId = 'page', over: Partial<BoundingBox> = {}) => ({ id, pageId, box: box(over) });

describe('mapGridToResults', () => {
  const cells = [cell(1), cell(2, 'page', { xmin: 200, xmax: 400, ymin: 300, ymax: 600 })];

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

describe('mapGridToPages — 여러 페이지를 묶은 격자 되돌리기', () => {
  // 1~2번은 A 페이지(1000×2000), 3번은 B 페이지(500×1000)
  const cells = [
    cell(1, 'A'),
    cell(2, 'A', { xmin: 200, xmax: 400, ymin: 300, ymax: 600 }),
    cell(3, 'B'),
  ];
  const sizeOf = (id: string) => (id === 'A' ? { width: 1000, height: 2000 } : { width: 500, height: 1000 });

  it('칸을 원래 페이지별로 나누고 각 페이지 크기로 좌표를 환산한다', () => {
    const byPage = mapGridToPages([
      { id: 1, original_text: 'あ', translated_text: '가' },
      { id: 2, original_text: 'い', translated_text: '나' },
      { id: 3, original_text: 'う', translated_text: '다' },
    ], cells, sizeOf);

    expect([...byPage.keys()].sort()).toEqual(['A', 'B']);
    expect(byPage.get('A')!.map(r => r.translated_text)).toEqual(['가', '나']);
    // 같은 픽셀 박스라도 페이지 크기가 다르면 정규화 좌표가 달라야 함
    expect(byPage.get('A')![0].box_2d).toEqual([0, 0, 100, 100]);
    expect(byPage.get('B')![0].box_2d).toEqual([0, 0, 200, 200]);
  });

  it('중복 칸 번호는 첫 번째만 쓰고, 모르는 번호는 버린다', () => {
    const byPage = mapGridToPages([
      { id: 3, original_text: 'う', translated_text: '다' },
      { id: 3, original_text: 'う', translated_text: '다(중복)' },
      { id: 99, original_text: 'x', translated_text: '없는 칸' },
    ], cells, sizeOf);
    expect(byPage.get('B')!.map(r => r.translated_text)).toEqual(['다']);
    expect(byPage.has('A')).toBe(false);
  });
});
