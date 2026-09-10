import type { BoundingBox } from './yolo';

/**
 * Sorts manga panels (frames) and texts (speech bubbles) into the correct reading order.
 * Follows Japanese manga rules: Right-to-Left, Top-to-Bottom.
 * 
 * @param boxes All detected bounding boxes (frames and texts)
 * @returns Sorted text bounding boxes
 */
export function sortTextByReadingOrder(boxes: BoundingBox[]): BoundingBox[] {
  const frames = boxes.filter(b => b.classId === 2);
  let texts = boxes.filter(b => b.classId === 3);

  // If no frames detected, just sort texts globally
  if (frames.length === 0) {
    return sortMangaBoxesByTier(texts, b => [b.ymin, b.xmin, b.ymax, b.xmax]);
  }

  // 1. Assign each text to the frame it overlaps most with
  const frameMap = new Map<BoundingBox, BoundingBox[]>();
  frames.forEach(f => frameMap.set(f, []));
  const orphans: BoundingBox[] = [];

  for (const text of texts) {
    let bestFrame: BoundingBox | null = null;
    let maxOverlapArea = 0;

    for (const frame of frames) {
      const overlapArea = calculateIntersectionArea(text, frame);
      if (overlapArea > maxOverlapArea) {
        maxOverlapArea = overlapArea;
        bestFrame = frame;
      }
    }

    if (bestFrame && maxOverlapArea > 0) {
      frameMap.get(bestFrame)!.push(text);
    } else {
      orphans.push(text);
    }
  }

  // 2. Sort the frames
  const sortedFrames = sortMangaBoxesByTier(frames, b => [b.ymin, b.xmin, b.ymax, b.xmax]);

  // 3. Sort texts inside each frame and collect
  const result: BoundingBox[] = [];
  for (const frame of sortedFrames) {
    const frameTexts = frameMap.get(frame) || [];
    if (frameTexts.length > 0) {
      const sortedFrameTexts = sortMangaBoxesByTier(frameTexts, b => [b.ymin, b.xmin, b.ymax, b.xmax]);
      result.push(...sortedFrameTexts);
    }
  }

  // 4. Handle orphans (texts that didn't overlap with any frame)
  // Just sort them and append, or try to inject them based on coordinates?
  // Usually orphans are outside panels. We will just sort them and put them at the end.
  // A better way would be merging them into the global sort, but this is okay for now.
  if (orphans.length > 0) {
    result.push(...sortMangaBoxesByTier(orphans, b => [b.ymin, b.xmin, b.ymax, b.xmax]));
  }

  return result;
}

/**
 * Sorts a list of boxes using a Top-to-Bottom, Right-to-Left heuristic, grouping by Y-tiers using relative height.
 */
export function sortMangaBoxesByTier<T>(
  boxes: T[], 
  getCoords: (b: T) => [number, number, number, number] // [ymin, xmin, ymax, xmax]
): T[] {
  if (boxes.length <= 1) return [...boxes];

  // 1. 초기 계산 및 Y 중심값 기준 오름차순 정렬 (위에서 아래로)
  const items = boxes.map(b => {
    const [ymin, xmin, ymax, xmax] = getCoords(b);
    return {
      original: b,
      centerY: (ymin + ymax) / 2,
      centerX: (xmin + xmax) / 2,
      height: ymax - ymin
    };
  });
  
  items.sort((a, b) => a.centerY - b.centerY);

  // 2. Y축 중심값 차이 기반으로 행(tier) 순차 그룹핑
  const tiers: (typeof items)[] = [];
  let currentTier = [items[0]];
  
  for (let i = 1; i < items.length; i++) {
    const curr = items[i];
    const prev = currentTier[currentTier.length - 1]; // 이전 박스 기준 (이미 Y정렬되어 있으므로)
    
    const yDiff = Math.abs(curr.centerY - prev.centerY);
    
    // 상대적 임계값: 두 상자 평균 높이의 1/3 (상수화)
    const TIER_THRESHOLD_RATIO = 3; 
    const threshold = (curr.height + prev.height) / TIER_THRESHOLD_RATIO;

    if (yDiff <= threshold) {
      currentTier.push(curr);
    } else {
      tiers.push(currentTier);
      currentTier = [curr];
    }
  }
  tiers.push(currentTier);

  // 3. 각 행(tier) 내부를 X 중심값 기준 내림차순(우측에서 좌측으로) 단일 정렬하여 flat 배열로 병합
  const result: T[] = [];
  for (const tier of tiers) {
    tier.sort((a, b) => b.centerX - a.centerX);
    for (const t of tier) {
      result.push(t.original);
    }
  }
  
  return result;
}

function calculateIntersectionArea(b1: BoundingBox, b2: BoundingBox): number {
  const xLeft = Math.max(b1.xmin, b2.xmin);
  const yTop = Math.max(b1.ymin, b2.ymin);
  const xRight = Math.min(b1.xmax, b2.xmax);
  const yBottom = Math.min(b1.ymax, b2.ymax);

  if (xRight < xLeft || yBottom < yTop) return 0;
  return (xRight - xLeft) * (yBottom - yTop);
}
