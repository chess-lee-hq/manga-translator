import { describe, expect, it } from 'vitest';
import { postprocess } from './yoloPostprocess';

// 출력 [1, 8, 3]: 행 = cx, cy, w, h, class0..3 / 열 = 후보
const rows = [
  [100, 105, 100], // cx
  [100, 100, 100], // cy
  [50, 50, 50], // w
  [50, 50, 50], // h
  [0, 0, 0], // body
  [0, 0, 0], // face
  [0, 0, 0.5], // frame
  [0.9, 0.8, 0], // text
];
const data = Float32Array.from(rows.flat());
const dims = [1, 8, 3];
const identity = { xRatio: 1, yRatio: 1, padW: 0, padH: 0 };

describe('postprocess', () => {
  it('같은 클래스의 겹치는 박스는 NMS로 하나만 남기고, 다른 클래스는 유지한다', () => {
    const boxes = postprocess(data, dims, identity, 0.25, 0.45);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toMatchObject({ classId: 3, xmin: 75, ymin: 75, xmax: 125, ymax: 125 });
    expect(boxes[0].confidence).toBeCloseTo(0.9);
    expect(boxes[1].classId).toBe(2);
  });

  it('레터박스 여백과 배율을 되돌린다', () => {
    const [text] = postprocess(data, dims, { xRatio: 2, yRatio: 2, padW: 10, padH: 20 }, 0.25, 0.45);
    expect(text).toMatchObject({ xmin: 130, ymin: 110, xmax: 230, ymax: 210 });
  });

  it('신뢰도 기준 미만은 버린다', () => {
    expect(postprocess(data, dims, identity, 0.95, 0.45)).toEqual([]);
  });
});
