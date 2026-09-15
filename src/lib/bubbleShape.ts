/**
 * 원본 만화의 흰 말풍선 모양 찾기 (모델 없이 이미지 픽셀만 사용)
 *
 * 글자 영역 안의 흰 픽셀에서 시작해 흰색을 바깥으로 채워 나가면 말풍선 테두리에서 멈춥니다.
 * 채워진 영역 + 그 안에 갇힌 글자 획 = 말풍선 안쪽 모양입니다.
 *
 * 확실하지 않으면 null을 돌려주고, 호출하는 쪽은 지금의 둥근 사각형 덮기로 되돌아갑니다.
 * - 흰색이 탐색 범위 끝까지 번짐 (테두리가 끊겼거나 말풍선이 없는 글자)
 * - 말풍선이 글자 영역에 비해 너무 큼 (그림의 흰 배경으로 번짐)
 * - 글자 영역 배경이 흰색이 아님 (스크린톤·그림 위 글자)
 * - 채운 영역 밖에 원문 글자 획이 남음 (글자가 테두리에 걸침)
 * - 다른 말풍선의 글자까지 같은 영역에 들어옴 (붙은 말풍선의 경계가 끊김)
 */

export interface PixelBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export interface PixelRegion {
  /** RGBA 픽셀 (ImageData.data와 같은 배열) */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** 이 영역이 원본 이미지에서 시작하는 위치 */
  x: number;
  y: number;
}

/** 말풍선 안쪽 모양. 좌표는 페이지 기준 0~1000 정규화 */
export interface BubbleShape {
  /** 첫 행의 위쪽 y */
  top: number;
  /** 행 하나의 높이 */
  rowHeight: number;
  /** 위에서부터 행마다 안쪽의 [왼쪽 x, 오른쪽 x]. 비어 있는 행은 null */
  rows: ([number, number] | null)[];
  /** 면적 가중 중심 (글자 덩어리를 놓을 기준점) */
  centerX: number;
  centerY: number;
}

export const BUBBLE_RULE = {
  /** 탐색 범위: 글자 영역에서 가로·세로로 각각 이만큼(글자 영역 긴 변 대비) 넓힘 */
  searchMarginRatio: 1.1,
  /** 픽셀 격자의 긴 변 칸 수 상한 (크면 정밀하지만 느림) */
  maxGridCells: 320,
  /** 글자 영역 배경의 밝기(상위 10%)가 이보다 어두우면 흰 말풍선이 아님 */
  minPaperLuma: 190,
  /** 흰색 판정: 배경 밝기에서 이만큼 어두워도 흰색으로 봄 */
  whiteTolerance: 55,
  minWhiteLuma: 150,
  /** 말풍선 면적이 글자 영역의 이 배수를 넘으면 번진 것으로 봄 */
  maxAreaRatio: 12,
  /** 글자 영역 안의 어두운 칸 중 채운 영역 밖에 남아도 되는 비율 */
  maxUncoveredInk: 0.04,
} as const;

/** 픽셀을 읽어올 탐색 범위 (원본 이미지 px, 페이지 밖은 잘라냄) */
export function searchRegionFor(box: PixelBox, imageWidth: number, imageHeight: number): PixelBox {
  const margin = Math.max(box.xmax - box.xmin, box.ymax - box.ymin) * BUBBLE_RULE.searchMarginRatio;
  return {
    xmin: Math.max(0, Math.floor(box.xmin - margin)),
    ymin: Math.max(0, Math.floor(box.ymin - margin)),
    xmax: Math.min(imageWidth, Math.ceil(box.xmax + margin)),
    ymax: Math.min(imageHeight, Math.ceil(box.ymax + margin)),
  };
}

const lumaAt = (data: Uint8ClampedArray, i: number) => {
  // 투명 픽셀은 종이(흰색)로 봄
  if (data[i + 3] < 128) return 255;
  return (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
};

/**
 * 탐색 범위의 픽셀에서 말풍선 모양을 찾습니다.
 * @param box 글자 영역 (원본 이미지 px)
 * @param otherCenters 같은 페이지 다른 글자 영역의 중심 (원본 이미지 px) — 이 점이 모양 안에 들어오면 실패
 */
export function detectBubbleShape(
  region: PixelRegion,
  box: PixelBox,
  imageWidth: number,
  imageHeight: number,
  otherCenters: { x: number; y: number }[] = [],
): BubbleShape | null {
  const { data, width, height } = region;
  if (width < 4 || height < 4) return null;

  // 1) 글자 영역 배경 밝기 (상위 10%) — 누렇게 스캔된 종이도 흰색으로 인정
  const bx0 = Math.max(0, Math.floor(box.xmin - region.x));
  const by0 = Math.max(0, Math.floor(box.ymin - region.y));
  const bx1 = Math.min(width, Math.ceil(box.xmax - region.x));
  const by1 = Math.min(height, Math.ceil(box.ymax - region.y));
  if (bx1 - bx0 < 2 || by1 - by0 < 2) return null;

  const histogram = new Uint32Array(256);
  let boxPixels = 0;
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      histogram[lumaAt(data, (y * width + x) * 4)]++;
      boxPixels++;
    }
  }
  let paper = 255;
  for (let count = 0; paper > 0; paper--) {
    count += histogram[paper];
    if (count >= boxPixels * 0.1) break;
  }
  if (paper < BUBBLE_RULE.minPaperLuma) return null;
  const whiteThreshold = Math.max(BUBBLE_RULE.minWhiteLuma, paper - BUBBLE_RULE.whiteTolerance);

  // 2) 작은 격자로 줄이되 칸 안의 가장 어두운 픽셀을 씀 → 가는 테두리가 끊기지 않음
  const block = Math.max(1, Math.ceil(Math.max(width, height) / BUBBLE_RULE.maxGridCells));
  const gw = Math.ceil(width / block);
  const gh = Math.ceil(height / block);
  const white = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let darkest = 255;
      const yEnd = Math.min(height, (gy + 1) * block);
      const xEnd = Math.min(width, (gx + 1) * block);
      for (let y = gy * block; y < yEnd && darkest >= whiteThreshold; y++) {
        for (let x = gx * block; x < xEnd; x++) {
          const l = lumaAt(data, (y * width + x) * 4);
          if (l < darkest) darkest = l;
        }
      }
      white[gy * gw + gx] = darkest >= whiteThreshold ? 1 : 0;
    }
  }

  const gbx0 = Math.floor(bx0 / block);
  const gby0 = Math.floor(by0 / block);
  const gbx1 = Math.max(gbx0 + 1, Math.ceil(bx1 / block));
  const gby1 = Math.max(gby0 + 1, Math.ceil(by1 / block));

  // 3) 글자 영역 안쪽의 흰 칸에서 시작해 흰색을 채움 (상하좌우 연결)
  //    검출 박스가 조금 크게 잡혀 모서리가 말풍선 밖에 걸쳐도 시작점이 바깥에 생기지 않도록 안쪽 60%만 씀
  const insetX = Math.floor((gbx1 - gbx0) * 0.2);
  const insetY = Math.floor((gby1 - gby0) * 0.2);
  const mask = new Uint8Array(gw * gh);
  const stack: number[] = [];
  for (let gy = gby0 + insetY; gy < gby1 - insetY; gy++) {
    for (let gx = gbx0 + insetX; gx < gbx1 - insetX; gx++) {
      const i = gy * gw + gx;
      if (white[i] && !mask[i]) {
        mask[i] = 1;
        stack.push(i);
      }
    }
  }
  if (stack.length === 0) return null;

  let filled = stack.length;
  const boxCells = (gbx1 - gbx0) * (gby1 - gby0);
  const maxCells = boxCells * BUBBLE_RULE.maxAreaRatio;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const gx = i % gw;
    const gy = (i - gx) / gw;
    // 탐색 범위 끝에 닿음 = 테두리 없이 번짐
    if (gx === 0 || gy === 0 || gx === gw - 1 || gy === gh - 1) return null;
    for (const n of [i - 1, i + 1, i - gw, i + gw]) {
      if (white[n] && !mask[n]) {
        mask[n] = 1;
        stack.push(n);
        if (++filled > maxCells) return null;
      }
    }
  }

  // 4) 채운 영역에 갇힌 칸(글자 획·획 사이 구멍)을 모양에 포함: 바깥에서 닿지 않는 칸 = 안쪽
  const outside = new Uint8Array(gw * gh);
  for (let gx = 0; gx < gw; gx++) {
    for (const gy of [0, gh - 1]) {
      const i = gy * gw + gx;
      if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); }
    }
  }
  for (let gy = 0; gy < gh; gy++) {
    for (const gx of [0, gw - 1]) {
      const i = gy * gw + gx;
      if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); }
    }
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const gx = i % gw;
    const gy = (i - gx) / gw;
    if (gx > 0 && !mask[i - 1] && !outside[i - 1]) { outside[i - 1] = 1; stack.push(i - 1); }
    if (gx < gw - 1 && !mask[i + 1] && !outside[i + 1]) { outside[i + 1] = 1; stack.push(i + 1); }
    if (gy > 0 && !mask[i - gw] && !outside[i - gw]) { outside[i - gw] = 1; stack.push(i - gw); }
    if (gy < gh - 1 && !mask[i + gw] && !outside[i + gw]) { outside[i + gw] = 1; stack.push(i + gw); }
  }
  const inside = (i: number) => !outside[i];

  // 5) 원문 글자 획이 모양 밖에 남으면 흰색으로 다 못 덮으므로 실패
  let ink = 0;
  let uncovered = 0;
  for (let gy = gby0; gy < gby1; gy++) {
    for (let gx = gbx0; gx < gbx1; gx++) {
      const i = gy * gw + gx;
      if (white[i]) continue;
      ink++;
      if (!inside(i)) uncovered++;
    }
  }
  if (ink > 0 && uncovered / ink > BUBBLE_RULE.maxUncoveredInk) return null;

  // 6) 다른 말풍선의 글자가 같은 모양에 들어오면 붙은 말풍선으로 번진 것
  for (const c of otherCenters) {
    const gx = Math.floor((c.x - region.x) / block);
    const gy = Math.floor((c.y - region.y) / block);
    if (gx >= 0 && gy >= 0 && gx < gw && gy < gh && inside(gy * gw + gx)) return null;
  }

  // 7) 행마다 안쪽의 왼쪽·오른쪽 끝 → 정규화 좌표
  const toNormX = (gx: number) => ((region.x + gx * block) / imageWidth) * 1000;
  const toNormY = (gy: number) => ((region.y + gy * block) / imageHeight) * 1000;
  let firstRow = -1;
  let lastRow = -1;
  const spans: ([number, number] | null)[] = [];
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  for (let gy = 0; gy < gh; gy++) {
    let left = -1;
    let right = -1;
    for (let gx = 0; gx < gw; gx++) {
      if (!inside(gy * gw + gx)) continue;
      if (left < 0) left = gx;
      right = gx;
      area++;
      sumX += gx + 0.5;
      sumY += gy + 0.5;
    }
    if (left < 0) {
      spans.push(null);
      continue;
    }
    if (firstRow < 0) firstRow = gy;
    lastRow = gy;
    spans.push([toNormX(left), toNormX(right + 1)]);
  }
  if (firstRow < 0 || area === 0) return null;

  return {
    top: toNormY(firstRow),
    rowHeight: toNormY(firstRow + 1) - toNormY(firstRow),
    rows: spans.slice(firstRow, lastRow + 1),
    centerX: toNormX(sumX / area),
    centerY: toNormY(sumY / area),
  };
}

/** 원본 이미지를 한 번 그려두고 글자 영역마다 픽셀을 읽어 모양을 찾습니다. */
export function createPixelReader(image: HTMLImageElement | HTMLCanvasElement) {
  const width = image instanceof HTMLImageElement ? image.naturalWidth || image.width : image.width;
  const height = image instanceof HTMLImageElement ? image.naturalHeight || image.height : image.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx?.drawImage(image, 0, 0, width, height);
  return {
    width,
    height,
    read(rect: PixelBox): PixelRegion | null {
      if (!ctx) return null;
      const w = rect.xmax - rect.xmin;
      const h = rect.ymax - rect.ymin;
      if (w <= 0 || h <= 0) return null;
      return { data: ctx.getImageData(rect.xmin, rect.ymin, w, h).data, width: w, height: h, x: rect.xmin, y: rect.ymin };
    },
  };
}

/** 한 페이지의 글자 영역마다 말풍선 모양을 찾습니다. 찾지 못한 항목은 null */
export function detectPageBubbleShapes(
  image: HTMLImageElement | HTMLCanvasElement,
  results: { id: string; box_2d: [number, number, number, number] }[],
): Record<string, BubbleShape | null> {
  const reader = createPixelReader(image);
  const { width, height } = reader;
  const boxes = results.map(r => {
    const [ymin, xmin, ymax, xmax] = r.box_2d;
    return { xmin: (xmin / 1000) * width, ymin: (ymin / 1000) * height, xmax: (xmax / 1000) * width, ymax: (ymax / 1000) * height };
  });
  const centers = boxes.map(b => ({ x: (b.xmin + b.xmax) / 2, y: (b.ymin + b.ymax) / 2 }));

  const shapes: Record<string, BubbleShape | null> = {};
  results.forEach((result, i) => {
    const region = reader.read(searchRegionFor(boxes[i], width, height));
    shapes[result.id] = region ? detectBubbleShape(region, boxes[i], width, height, centers.filter((_, j) => j !== i)) : null;
  });
  return shapes;
}
