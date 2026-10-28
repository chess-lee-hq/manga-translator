import type { TextMask } from './textPixels';

export interface BoundingBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  confidence: number;
  classId: number;
  /** 이어진 말풍선을 번역 전에 나눈 칸끼리 같은 번호 (번역 프롬프트에 "이어지는 말"로 알려 줌) */
  joinGroup?: number;
  /** 글자 픽셀 모델이 찾은 이 칸의 원문 글자 획 (번역 결과의 text_mask로 저장) */
  textMask?: TextMask;
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

const SPLIT_LINE = { minOverlap: 0.3, minAcross: 0.8 } as const;

/**
 * 긴 글자 줄 하나를 YOLO가 위·아래(또는 좌·우) 두 박스로 겹쳐 잡은 경우 하나로 합칩니다.
 * (세로 해설 「其の外、ちりぢりに…討死候」『信長公記』가 앞부분·뒷부분 두 칸으로 번역돼 내용이 겹쳤음)
 * 같은 줄 = 글자 박스(classId 3)끼리 줄 폭 방향으로 거의 겹치고(좁은 쪽 폭의 80% 이상), 서로 작은 쪽 넓이의 30% 이상 겹침.
 * 나란한 다른 말풍선은 폭 방향으로 이렇게 겹치지 않고, 완전히 겹친 중복은 NMS가 이미 버림
 */
export function mergeSplitTextLines(boxes: BoundingBox[]): BoundingBox[] {
  const out = [...boxes];
  const sameLine = (a: BoundingBox, b: BoundingBox) => {
    if (a.classId !== 3 || b.classId !== 3 || containmentRatio(a, b) < SPLIT_LINE.minOverlap) return false;
    const tall = a.ymax - a.ymin >= a.xmax - a.xmin && b.ymax - b.ymin >= b.xmax - b.xmin;
    const wide = a.ymax - a.ymin < a.xmax - a.xmin && b.ymax - b.ymin < b.xmax - b.xmin;
    if (!tall && !wide) return false;
    const [lo1, hi1, lo2, hi2] = tall ? [a.xmin, a.xmax, b.xmin, b.xmax] : [a.ymin, a.ymax, b.ymin, b.ymax];
    const across = Math.min(hi1, hi2) - Math.max(lo1, lo2);
    return across >= Math.min(hi1 - lo1, hi2 - lo2) * SPLIT_LINE.minAcross;
  };
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length && !merged; j++) {
        if (!sameLine(out[i], out[j])) continue;
        const [a, b] = [out[i], out[j]];
        out[i] = { ...a, xmin: Math.min(a.xmin, b.xmin), ymin: Math.min(a.ymin, b.ymin), xmax: Math.max(a.xmax, b.xmax), ymax: Math.max(a.ymax, b.ymax), confidence: Math.max(a.confidence, b.confidence) };
        out.splice(j, 1);
        merged = true;
      }
    }
  }
  return out;
}
