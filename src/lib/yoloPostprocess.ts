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

export function nonMaxSuppression(boxes: BoundingBox[], iouThreshold: number): BoundingBox[] {
  const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
  const result: BoundingBox[] = [];
  for (const box of sorted) {
    const overlapsKept = result.some(kept => kept.classId === box.classId && calculateIoU(box, kept) > iouThreshold);
    if (!overlapsKept) result.push(box);
  }
  return result;
}

export function calculateIoU(b1: BoundingBox, b2: BoundingBox): number {
  const xLeft = Math.max(b1.xmin, b2.xmin);
  const yTop = Math.max(b1.ymin, b2.ymin);
  const xRight = Math.min(b1.xmax, b2.xmax);
  const yBottom = Math.min(b1.ymax, b2.ymax);

  if (xRight < xLeft || yBottom < yTop) return 0;
  const intersection = (xRight - xLeft) * (yBottom - yTop);
  const area1 = (b1.xmax - b1.xmin) * (b1.ymax - b1.ymin);
  const area2 = (b2.xmax - b2.xmin) * (b2.ymax - b2.ymin);
  return intersection / (area1 + area2 - intersection);
}
