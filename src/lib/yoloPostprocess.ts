export interface BoundingBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  confidence: number;
  classId: number;
}

/** 640×640 레터박스 입력을 원본 이미지 좌표로 되돌리기 위한 정보 */
export interface LetterboxInfo {
  xRatio: number;
  yRatio: number;
  padW: number;
  padH: number;
}

/** 큰 박스 안에 작은 박스가 거의 들어가 있으면(같은 글자를 두 번 잡은 경우) 작은 쪽을 버리는 기준 */
const CONTAINMENT_THRESHOLD = 0.7;

/**
 * YOLOv8 출력 [1, 4+클래스 수, 후보 수]를 원본 이미지 좌표의 박스로 바꾸고 클래스별 NMS를 적용합니다.
 * 클래스: 0 body, 1 face, 2 frame, 3 text
 */
export function postprocess(
  data: ArrayLike<number>,
  dims: readonly number[],
  letterbox: LetterboxInfo,
  confThreshold: number,
  iouThreshold: number,
): BoundingBox[] {
  const numRows = dims[1];
  const numCols = dims[2];
  const numClasses = numRows - 4;
  const { xRatio, yRatio, padW, padH } = letterbox;
  const boxes: BoundingBox[] = [];

  for (let col = 0; col < numCols; col++) {
    let maxScore = 0;
    let classId = -1;
    for (let c = 0; c < numClasses; c++) {
      const score = data[(4 + c) * numCols + col];
      if (score > maxScore) {
        maxScore = score;
        classId = c;
      }
    }
    if (maxScore <= confThreshold) continue;

    const cx = data[col];
    const cy = data[numCols + col];
    const w = data[2 * numCols + col];
    const h = data[3 * numCols + col];

    boxes.push({
      xmin: (cx - w / 2 - padW) * xRatio,
      ymin: (cy - h / 2 - padH) * yRatio,
      xmax: (cx + w / 2 - padW) * xRatio,
      ymax: (cy + h / 2 - padH) * yRatio,
      confidence: maxScore,
      classId,
    });
  }

  return nonMaxSuppression(boxes, iouThreshold);
}

/**
 * 같은 클래스끼리 겹치는 박스를 정리합니다.
 * IoU가 크거나, 한쪽이 다른 쪽에 거의 들어가 있으면(= 같은 글자를 크게·작게 두 번 잡은 경우) 신뢰도가 낮은 쪽을 버립니다.
 */
export function nonMaxSuppression(boxes: BoundingBox[], iouThreshold: number): BoundingBox[] {
  const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
  const result: BoundingBox[] = [];
  for (const box of sorted) {
    const duplicated = result.some(kept =>
      kept.classId === box.classId
      && (calculateIoU(box, kept) > iouThreshold || containmentRatio(box, kept) > CONTAINMENT_THRESHOLD));
    if (!duplicated) result.push(box);
  }
  return result;
}

/** 여러 번(원본·색 반전 등) 검출한 결과를 합치고 겹치는 박스를 정리합니다. */
export function mergeDetections(passes: BoundingBox[][], iouThreshold: number): BoundingBox[] {
  return nonMaxSuppression(passes.flat(), iouThreshold);
}

function intersectionArea(b1: BoundingBox, b2: BoundingBox): number {
  const width = Math.min(b1.xmax, b2.xmax) - Math.max(b1.xmin, b2.xmin);
  const height = Math.min(b1.ymax, b2.ymax) - Math.max(b1.ymin, b2.ymin);
  return width > 0 && height > 0 ? width * height : 0;
}

const boxArea = (b: BoundingBox) => Math.max(0, b.xmax - b.xmin) * Math.max(0, b.ymax - b.ymin);

export function calculateIoU(b1: BoundingBox, b2: BoundingBox): number {
  const intersection = intersectionArea(b1, b2);
  const union = boxArea(b1) + boxArea(b2) - intersection;
  return union > 0 ? intersection / union : 0;
}

/** 겹친 넓이 ÷ 두 박스 중 작은 쪽 넓이. 한쪽이 다른 쪽에 완전히 들어가 있으면 1 */
export function containmentRatio(b1: BoundingBox, b2: BoundingBox): number {
  const smaller = Math.min(boxArea(b1), boxArea(b2));
  return smaller > 0 ? intersectionArea(b1, b2) / smaller : 0;
}
