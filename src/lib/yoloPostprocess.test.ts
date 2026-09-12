import { describe, expect, it } from 'vitest';
import { calculateIoU, containmentRatio, mergeDetections, nonMaxSuppression, postprocess } from './yoloPostprocess';

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

const bbox = (xmin: number, ymin: number, xmax: number, ymax: number, confidence: number, classId = 3) => ({ xmin, ymin, xmax, ymax, confidence, classId });

describe('nonMaxSuppression (중복 박스 정리)', () => {
  it('큰 박스에 거의 들어간 작은 박스는 IoU가 낮아도 버린다', () => {
    const big = bbox(0, 0, 100, 100, 0.9);
    const inside = bbox(10, 10, 40, 40, 0.8);
    expect(calculateIoU(big, inside)).toBeLessThan(0.45);
    expect(containmentRatio(big, inside)).toBeCloseTo(1);
    expect(nonMaxSuppression([big, inside], 0.45)).toEqual([big]);
  });

  it('클래스가 다르면 겹쳐도 남긴다', () => {
    expect(nonMaxSuppression([bbox(0, 0, 100, 100, 0.9, 3), bbox(10, 10, 40, 40, 0.8, 2)], 0.45)).toHaveLength(2);
  });

  it('살짝만 겹치는 박스는 둘 다 남긴다', () => {
    expect(nonMaxSuppression([bbox(0, 0, 100, 100, 0.9), bbox(90, 90, 200, 200, 0.8)], 0.45)).toHaveLength(2);
  });
});

describe('mergeDetections (원본 + 색 반전 결과 합치기)', () => {
  it('같은 글자를 두 번 잡으면 신뢰도 높은 쪽만 남기고, 새로 찾은 글자는 더한다', () => {
    const merged = mergeDetections([
      [bbox(0, 0, 100, 100, 0.9)],
      [bbox(2, 2, 98, 98, 0.7), bbox(300, 300, 400, 400, 0.6)],
    ], 0.45);
    expect(merged).toHaveLength(2);
    expect(merged[0].confidence).toBeCloseTo(0.9);
    expect(merged[1].xmin).toBe(300);
  });
});
