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
    return sortMangaBoxes(texts);
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
  const sortedFrames = sortMangaBoxes(frames);

  // 3. Sort texts inside each frame and collect
  const result: BoundingBox[] = [];
  for (const frame of sortedFrames) {
    const frameTexts = frameMap.get(frame) || [];
    if (frameTexts.length > 0) {
      const sortedFrameTexts = sortMangaBoxes(frameTexts);
      result.push(...sortedFrameTexts);
    }
  }

  // 4. Handle orphans (texts that didn't overlap with any frame)
  // Just sort them and append, or try to inject them based on coordinates?
  // Usually orphans are outside panels. We will just sort them and put them at the end.
  // A better way would be merging them into the global sort, but this is okay for now.
  if (orphans.length > 0) {
    result.push(...sortMangaBoxes(orphans));
  }

  return result;
}

/**
 * Sorts a list of boxes using a Top-to-Bottom, Right-to-Left heuristic.
 */
function sortMangaBoxes(boxes: BoundingBox[]): BoundingBox[] {
  return [...boxes].sort((a, b) => {
    const aCenterY = (a.ymin + a.ymax) / 2;
    const bCenterY = (b.ymin + b.ymax) / 2;
    const yDiff = Math.abs(aCenterY - bCenterY);
    
    const aHeight = a.ymax - a.ymin;
    const bHeight = b.ymax - b.ymin;
    
    // If y difference is larger than roughly 1/3 of their average height, they are on different vertical tiers.
    const threshold = (aHeight + bHeight) / 3;
    
    if (yDiff > threshold) {
      return aCenterY - bCenterY; // Top to bottom
    } else {
      // Same tier, sort right to left
      const aCenterX = (a.xmin + a.xmax) / 2;
      const bCenterX = (b.xmin + b.xmax) / 2;
      return bCenterX - aCenterX; // Right to left
    }
  });
}

function calculateIntersectionArea(b1: BoundingBox, b2: BoundingBox): number {
  const xLeft = Math.max(b1.xmin, b2.xmin);
  const yTop = Math.max(b1.ymin, b2.ymin);
  const xRight = Math.min(b1.xmax, b2.xmax);
  const yBottom = Math.min(b1.ymax, b2.ymax);

  if (xRight < xLeft || yBottom < yTop) return 0;
  return (xRight - xLeft) * (yBottom - yTop);
}
