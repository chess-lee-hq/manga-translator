/**
 * 원본 만화의 흰 말풍선 모양 찾기 (모델 없이 이미지 픽셀만 사용)
 *
 * 글자 영역 안의 흰 픽셀에서 시작해 흰색을 바깥으로 채워 나가면 말풍선 테두리에서 멈춥니다.
 * 채워진 영역 + 그 안에 갇힌 글자 획 = 말풍선 안쪽 모양입니다.
 *
 * 확실하지 않으면 모양 없이 "왜 못 찾았는지"를 돌려줍니다. (detectBubble)
 * 호출하는 쪽은 그 이유로 말풍선이 아예 없는 글자인지(→ 옆에 작게 붙임), 말풍선은 있는데 모양만 못 딴 것인지(→ 타원으로 덮음) 가릅니다.
 * - 흰색이 탐색 범위 끝까지 번짐 (테두리가 끊겼거나 말풍선이 없는 글자)
 * - 말풍선이 글자 영역에 비해 너무 큼 (그림의 흰 배경으로 번짐)
 * - 글자 영역 배경이 흰색이 아님 (스크린톤·그림 위 글자)
 * - 채운 영역 밖에 원문 글자 획이 남음 (글자가 테두리에 걸침)
 * 붙은 말풍선(두 말풍선이 이어져 한 영역)은 대사마다 동시에 채워 나가 가까운 쪽으로 나눔 → 말풍선마다 자기 모양
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
  /**
   * 글자를 놓아도 되는 구간: 행마다 안쪽이 가장 길게 이어진 구간 (rows와 같은 길이).
   * 혹이 달린 말풍선은 한 행에 안쪽이 둘로 나뉘는데 rows는 그 사이(테두리 밖 오목한 곳)까지 한 구간으로 잡으므로,
   * 글자는 이 구간에만 놓고 흰색은 rows 전체를 칠함. 없으면 rows
   */
  safeRows?: ([number, number] | null)[];
  /** 면적 가중 중심 (글자 덩어리를 놓을 기준점) */
  centerX: number;
  centerY: number;
}

/**
 * 모양을 못 찾은 이유.
 * - not-paper: 글자 배경이 흰색이 아님 (스크린톤·그림 위 글자) → 말풍선 없음
 * - leak: 흰색이 탐색 범위 끝까지 번짐 (흰 바탕 위 말풍선 없는 글자, 또는 테두리가 크게 끊김) → 말풍선 없음으로 봄
 * - too-big: 채운 영역이 글자에 비해 너무 큼 (큰 말풍선에 작은 글자, 또는 넓은 흰 배경)
 * - uncovered-ink: 글자 획이 모양 밖에 남음 (글자가 테두리에 걸침)
 * - no-enclosure: 흰색이 글자 획 사이 좁은 틈에만 갇히고 글자를 둘러싼 흰 영역이 없음
 *   (그림 위 흰 테두리 글자·속이 흰 큰 글씨 — 배경 밝기 검사를 흰 획 때문에 통과해도 말풍선은 없음)
 * - merged: 붙은 말풍선을 대사별로 나눴는데 내 몫이 너무 작음
 * - tiny / no-seed: 영역이 너무 작거나 글자 영역 안에 흰 칸이 없음
 */
export type BubbleFailure = 'not-paper' | 'leak' | 'too-big' | 'uncovered-ink' | 'no-enclosure' | 'merged' | 'tiny' | 'no-seed';

/** 이어진 말풍선(연리지)의 한 칸 */
export interface BubbleLobe {
  shape: BubbleShape;
  /** 원문 글자 중 이 칸에 있는 비율 (번역문을 나눌 때 기준) */
  inkShare: number;
  /** 이 칸의 원문 글자 영역 (원본 이미지 px) */
  box: PixelBox;
}

export type BubbleDetection = (
  /** lobes: 글자 영역 하나가 잘록하게 이어진 말풍선 두 칸에 걸쳐 있음 (읽는 순서: 오른쪽→왼쪽, 위→아래) */
  | { shape: BubbleShape; failure?: undefined; lobes?: BubbleLobe[] }
  /**
   * uncovered-ink(글자 획 일부가 말풍선 밖)일 때도 찾은 말풍선 안쪽은 알려줌:
   * - interior: 말풍선 안쪽 전체 (번역문을 놓을 자리 — 글자 영역이 한쪽에 치우쳐도 말풍선 가운데에)
   * - erase: 그중 글자 영역 범위 (interior를 못 쓸 때 원문만 지울 자리)
   */
  | { shape: null; failure: BubbleFailure; erase?: BubbleShape; interior?: BubbleShape }
) & {
  /** 원문 글자 한 자의 크기 (페이지 높이 기준 0~1000). 번역문 글자 크기를 원본에 맞추는 데 씀 */
  glyph?: number;
  /** 원문 글자 획만 골라 지울 마스크 (원본 해상도) — 말풍선을 통째로 칠하지 않고 글자만 지움 */
  glyphMask?: GlyphMask;
};

/**
 * 원문 글자 획 마스크. 좌표는 원본 이미지 px. data는 width×height (1 = 지울 픽셀)
 * coverage: 글자 영역 안 어두운 픽셀 중 마스크가 덮은 비율 — 낮으면(글자가 테두리·그림에 붙어 한 덩어리) 예전 방식으로 함께 칠함
 */
export interface GlyphMask {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
  /** 지운 자리를 칠할 종이 색 (글자 주변 밝은 픽셀의 가운데값) */
  color: [number, number, number];
  coverage: number;
  /** 원본 이미지 크기 (화면에서 비율로 놓을 때) */
  imageWidth: number;
  imageHeight: number;
}

/** 말풍선이 아예 없는 글자로 보는 실패 (덮지 않고 옆에 작게 붙임) */
export const NO_BUBBLE_FAILURES: ReadonlySet<BubbleFailure> = new Set(['not-paper', 'leak', 'no-enclosure']);

const BUBBLE_RULE = {
  /** 탐색 범위: 글자 영역에서 가로·세로로 각각 이만큼(글자 영역 긴 변 대비) 넓힘 */
  searchMarginRatio: 1.1,
  /**
   * 흰색이 탐색 범위 끝까지 번졌을 때 다시 볼 넓은 범위 (글자 영역 긴 변 대비, 페이지 짧은 변 대비 중 큰 쪽).
   * 큰 말풍선에 작은 글자·홀쭉한 말풍선 위쪽에만 쓴 글자는 말풍선이 첫 범위보다 커서 "번짐"으로 잘못 보였음
   */
  wideSearchMarginRatio: 3.5,
  wideSearchPageRatio: 0.12,
  /** 넓게 다시 볼 때 허용하는 말풍선 크기 (글자 영역 대비). 이보다 크게 번지면 말풍선이 아니라 넓은 배경(컷 전체 등) */
  wideMaxAreaRatio: 60,
  /** 픽셀 격자의 긴 변 칸 수 상한 (크면 정밀하지만 느림) */
  maxGridCells: 320,
  /** 글자 영역 배경의 밝기(상위 10%)가 이보다 어두우면 흰 말풍선이 아님 */
  minPaperLuma: 190,
  /** 흰색 판정: 배경 밝기에서 이만큼 어두워도 흰색으로 봄 */
  whiteTolerance: 55,
  minWhiteLuma: 150,
  /**
   * 채운 영역 중 배경보다 이만큼 이상 어두운 칸이 dimMaxRatio를 넘으면 말풍선 안쪽이 아니라 밝은 회색 배경(컷 바탕)까지 번진 것
   * → 이 값으로 흰색 기준을 엄격하게 해 다시 채움 (말풍선 안쪽은 종이색으로 고르기 때문)
   */
  strictTolerance: 25,
  dimMaxRatio: 0.3,
  /** 말풍선 면적이 글자 영역의 이 배수를 넘으면 번진 것으로 봄 */
  maxAreaRatio: 12,
  /**
   * 채운 영역 바로 바깥 이 거리(원본 px) 안의 어두운 칸은 말풍선 테두리로 봄.
   * 검출 박스가 말풍선보다 조금 크게 잡혀 테두리선이 박스 안에 들어와도 "글자가 테두리에 걸침"으로 오해하지 않도록
   */
  outlineBandPx: 8,
  /**
   * 이어진 말풍선 판정: 글자 묶음 사이 빈 틈에서 말풍선 폭(높이)이 양쪽 칸보다 이 비율 아래로 잘록하면 두 칸.
   * 틈이 글자 줄 사이 간격보다 확실히 넓으면(lobeWideGap배) 덜 잘록해도(lobeLooseNeck) 두 칸으로 봄
   */
  lobeNeck: 0.7,
  // 구름 모양 말풍선 하나의 울퉁불퉁한 테두리(실측 0.76)는 나누지 않도록
  lobeLooseNeck: 0.75,
  lobeWideGap: 1.5,
  /** 한쪽 칸에 원문 글자가 이 비율도 없으면 나누지 않음 */
  lobeMinInk: 0.22,
  /** 나눈 양쪽 글자 폭이 모두 글자 이만큼 이하면 한 줄을 쪼갠 것이므로 나누지 않음 */
  lobeSingleLineGlyphs: 1.6,
  /**
   * 글자 영역의 이 비율 이상이 말풍선 안이면, 밖에 남은 어두운 칸(uncoveredInkLoose까지)은 박스가 그림 쪽으로 삐져나온 것으로 봄
   * (예: 박스 아래 끝에 걸친 인물 머리) — 말풍선을 포기하지 않음
   */
  boxInsideLoose: 0.7,
  uncoveredInkLoose: 0.25,
  /** 글자 영역 안의 어두운 칸 중 채운 영역 밖에 남아도 되는 비율 */
  maxUncoveredInk: 0.04,
  /** 글자가 다 안 덮일 때, 채운 흰 영역이 글자 영역의 이 비율도 안 되면 둘러싼 말풍선이 없는 것으로 봄 */
  minEnclosureRatio: 0.6,
  /** 테두리의 작은 틈(손그림 말풍선·인쇄 번짐)을 메우는 두께 (격자 칸). 흰색이 새면 이만큼 테두리를 두껍게 해 한 번 더 시도 */
  gapCloseCells: 1,
} as const;

/** 픽셀을 읽어올 탐색 범위 (원본 이미지 px, 페이지 밖은 잘라냄) */
export function searchRegionFor(box: PixelBox, imageWidth: number, imageHeight: number, wide = false): PixelBox {
  const longSide = Math.max(box.xmax - box.xmin, box.ymax - box.ymin);
  const margin = wide
    ? Math.max(longSide * BUBBLE_RULE.wideSearchMarginRatio, Math.min(imageWidth, imageHeight) * BUBBLE_RULE.wideSearchPageRatio)
    : longSide * BUBBLE_RULE.searchMarginRatio;
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
 * 탐색 범위의 픽셀에서 말풍선 모양을 찾습니다. 못 찾으면 이유를 돌려줍니다.
 * 흰색이 새어 나가면(leak·too-big) 테두리의 작은 틈을 메우고 한 번 더 시도합니다.
 * @param box 글자 영역 (원본 이미지 px)
 * @param others 같은 페이지 다른 글자 영역 (원본 이미지 px) — 같은 흰 영역에 들어오면 붙은 말풍선으로 보고 영역을 나눔
 */
export function detectBubble(
  region: PixelRegion,
  box: PixelBox,
  imageWidth: number,
  imageHeight: number,
  others: PixelBox[] = [],
  maxAreaRatio: number = BUBBLE_RULE.maxAreaRatio,
): BubbleDetection {
  const first = detectOnce(region, box, imageWidth, imageHeight, others, 0, maxAreaRatio);
  if (first.shape || (first.failure !== 'leak' && first.failure !== 'too-big')) return first;
  const closed = detectOnce(region, box, imageWidth, imageHeight, others, BUBBLE_RULE.gapCloseCells, maxAreaRatio);
  return closed.shape ? closed : first;
}

/** 예전 호출 방식: 모양만 (못 찾으면 null) */
export function detectBubbleShape(
  region: PixelRegion,
  box: PixelBox,
  imageWidth: number,
  imageHeight: number,
  others: PixelBox[] = [],
): BubbleShape | null {
  return detectBubble(region, box, imageWidth, imageHeight, others).shape;
}

const fail = (failure: BubbleFailure): BubbleDetection => ({ shape: null, failure });

function detectOnce(
  region: PixelRegion,
  box: PixelBox,
  imageWidth: number,
  imageHeight: number,
  others: PixelBox[],
  closeCells: number,
  maxAreaRatio: number,
  strict = false,
): BubbleDetection {
  const { data, width, height } = region;
  if (width < 4 || height < 4) return fail('tiny');

  // 1) 글자 영역 배경 밝기 (상위 10%) — 누렇게 스캔된 종이도 흰색으로 인정
  const bx0 = Math.max(0, Math.floor(box.xmin - region.x));
  const by0 = Math.max(0, Math.floor(box.ymin - region.y));
  const bx1 = Math.min(width, Math.ceil(box.xmax - region.x));
  const by1 = Math.min(height, Math.ceil(box.ymax - region.y));
  if (bx1 - bx0 < 2 || by1 - by0 < 2) return fail('tiny');

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
  if (paper < BUBBLE_RULE.minPaperLuma) return fail('not-paper');
  const inkThreshold = Math.max(BUBBLE_RULE.minWhiteLuma, paper - BUBBLE_RULE.whiteTolerance);
  const whiteThreshold = strict ? Math.max(inkThreshold, paper - BUBBLE_RULE.strictTolerance) : inkThreshold;
  const dimLuma = paper - BUBBLE_RULE.strictTolerance;

  // 2) 작은 격자로 줄이되 칸 안의 가장 어두운 픽셀을 씀 → 가는 테두리가 끊기지 않음
  const block = Math.max(1, Math.ceil(Math.max(width, height) / BUBBLE_RULE.maxGridCells));
  const gw = Math.ceil(width / block);
  const gh = Math.ceil(height / block);
  const white = new Uint8Array(gw * gh);
  /** 흰 칸 중 배경보다 눈에 띄게 어두운(밝은 회색) 칸 */
  const dim = new Uint8Array(gw * gh);
  /** 글자 획 (엄격 모드에서도 밝은 회색 바탕은 획으로 치지 않음) */
  const ink = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let darkest = 255;
      const yEnd = Math.min(height, (gy + 1) * block);
      const xEnd = Math.min(width, (gx + 1) * block);
      for (let y = gy * block; y < yEnd && darkest >= inkThreshold; y++) {
        for (let x = gx * block; x < xEnd; x++) {
          const l = lumaAt(data, (y * width + x) * 4);
          if (l < darkest) darkest = l;
        }
      }
      white[gy * gw + gx] = darkest >= whiteThreshold ? 1 : 0;
      dim[gy * gw + gx] = darkest < dimLuma ? 1 : 0;
      ink[gy * gw + gx] = darkest < inkThreshold ? 1 : 0;
    }
  }

  // 틈 메우기: 흰 칸 중 closeCells 안에 어두운 칸이 있으면 막힌 칸으로 봄 (테두리가 두꺼워져 작은 틈이 닫힘)
  // 채운 모양은 그만큼 안쪽으로 줄지만 칸이 아주 작아(긴 변 320칸) 눈에 띄지 않음. 글자 획 판정은 ink를 씀
  const passable = closeCells > 0 ? closeGaps(white, gw, gh, closeCells) : white;

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
      if (passable[i] && !mask[i]) {
        mask[i] = 1;
        stack.push(i);
      }
    }
  }
  if (stack.length === 0) return fail('no-seed');

  let filled = stack.length;
  const boxCells = (gbx1 - gbx0) * (gby1 - gby0);
  const maxCells = boxCells * maxAreaRatio;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const gx = i % gw;
    const gy = (i - gx) / gw;
    // 탐색 범위 끝에 닿음 = 테두리 없이 번짐
    if (gx === 0 || gy === 0 || gx === gw - 1 || gy === gh - 1) return fail('leak');
    for (const n of [i - 1, i + 1, i - gw, i + gw]) {
      if (passable[n] && !mask[n]) {
        mask[n] = 1;
        stack.push(n);
        if (++filled > maxCells) return fail('too-big');
      }
    }
  }

  // 밝은 회색 배경까지 번졌으면 흰색 기준을 엄격하게 해 다시 (말풍선 안쪽만 남음)
  if (!strict) {
    let dimCells = 0;
    for (let i = 0; i < gw * gh; i++) if (mask[i] && dim[i]) dimCells++;
    if (dimCells > filled * BUBBLE_RULE.dimMaxRatio) {
      return detectOnce(region, box, imageWidth, imageHeight, others, closeCells, maxAreaRatio, true);
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
  const enclosedCell = (i: number) => !outside[i];

  // 5) 붙은 말풍선: 다른 대사의 글자 영역이 같은 영역 안에 있으면, 대사마다 동시에 채워 나가 먼저 닿은 쪽 몫으로 나눔
  //    (두 말풍선이 잘록하게 이어진 경우 대략 이어진 목 근처에서 갈림)
  const gridRect = (b: PixelBox) => {
    const x0 = Math.max(0, Math.floor((b.xmin - region.x) / block));
    const y0 = Math.max(0, Math.floor((b.ymin - region.y) / block));
    const x1 = Math.min(gw, Math.max(x0 + 1, Math.ceil((b.xmax - region.x) / block)));
    const y1 = Math.min(gh, Math.max(y0 + 1, Math.ceil((b.ymax - region.y) / block)));
    // 검출 박스가 조금 크게 잡혀도 이웃 말풍선 쪽을 먼저 차지하지 않도록 안쪽 60%만
    const ix = Math.floor((x1 - x0) * 0.2);
    const iy = Math.floor((y1 - y0) * 0.2);
    return { x0: x0 + ix, y0: y0 + iy, x1: Math.max(x0 + ix + 1, x1 - ix), y1: Math.max(y0 + iy + 1, y1 - iy) };
  };
  const centerCell = (b: PixelBox) => {
    const gx = Math.floor(((b.xmin + b.xmax) / 2 - region.x) / block);
    const gy = Math.floor(((b.ymin + b.ymax) / 2 - region.y) / block);
    return gx >= 0 && gy >= 0 && gx < gw && gy < gh ? gy * gw + gx : -1;
  };
  const rivals = others.filter(b => {
    const c = centerCell(b);
    return c >= 0 && enclosedCell(c);
  });
  let inside = enclosedCell;
  if (rivals.length > 0) {
    const owner = new Int16Array(gw * gh).fill(-1);
    const queue = new Int32Array(gw * gh);
    let head = 0;
    let tail = 0;
    [{ xmin: box.xmin, ymin: box.ymin, xmax: box.xmax, ymax: box.ymax }, ...rivals].forEach((b, k) => {
      const r = gridRect(b);
      for (let gy = r.y0; gy < r.y1; gy++) {
        for (let gx = r.x0; gx < r.x1; gx++) {
          const i = gy * gw + gx;
          if (enclosedCell(i) && owner[i] < 0) {
            owner[i] = k;
            queue[tail++] = i;
          }
        }
      }
    });
    // 안쪽 칸은 탐색 범위 가장자리에 닿지 않으므로(닿으면 위에서 leak) 이웃 칸 계산이 줄을 넘지 않음
    while (head < tail) {
      const i = queue[head++];
      for (const n of [i - 1, i + 1, i - gw, i + gw]) {
        if (owner[n] < 0 && enclosedCell(n)) {
          owner[n] = owner[i];
          queue[tail++] = n;
        }
      }
    }
    let mine = 0;
    for (let i = 0; i < gw * gh; i++) if (owner[i] === 0) mine++;
    if (mine < boxCells * BUBBLE_RULE.minEnclosureRatio) return fail('merged');
    inside = (i: number) => owner[i] === 0;
  }

  // 행마다 안쪽의 왼쪽·오른쪽 끝 → 정규화 좌표 (모양 만들기)
  const toNormX = (gx: number) => ((region.x + gx * block) / imageWidth) * 1000;
  const toNormY = (gy: number) => ((region.y + gy * block) / imageHeight) * 1000;
  const shapeOf = (keep: (i: number) => boolean): { shape: BubbleShape; area: number } | null => {
    let firstRow = -1;
    let lastRow = -1;
    const spans: ([number, number] | null)[] = [];
    const safe: ([number, number] | null)[] = [];
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    for (let gy = 0; gy < gh; gy++) {
      let left = -1;
      let right = -1;
      let runStart = -1;
      let bestStart = -1;
      let bestEnd = -1;
      for (let gx = 0; gx <= gw; gx++) {
        const on = gx < gw && keep(gy * gw + gx);
        if (on) {
          if (left < 0) left = gx;
          right = gx;
          area++;
          sumX += gx + 0.5;
          sumY += gy + 0.5;
          if (runStart < 0) runStart = gx;
        } else if (runStart >= 0) {
          if (gx - runStart > bestEnd - bestStart) {
            bestStart = runStart;
            bestEnd = gx;
          }
          runStart = -1;
        }
      }
      if (left < 0) {
        spans.push(null);
        safe.push(null);
        continue;
      }
      if (firstRow < 0) firstRow = gy;
      lastRow = gy;
      spans.push([toNormX(left), toNormX(right + 1)]);
      safe.push([toNormX(bestStart), toNormX(bestEnd)]);
    }
    if (firstRow < 0 || area === 0) return null;
    return {
      area,
      shape: {
        top: toNormY(firstRow),
        rowHeight: toNormY(firstRow + 1) - toNormY(firstRow),
        rows: spans.slice(firstRow, lastRow + 1),
        safeRows: safe.slice(firstRow, lastRow + 1),
        centerX: toNormX(sumX / area),
        centerY: toNormY(sumY / area),
      },
    };
  };
  // 테두리 띠: 안쪽 영역에서 outlineBandPx 안에 있는 칸 (여기 있는 어두운 칸은 글자가 아니라 테두리선)
  const bandCells = Math.max(1, Math.ceil(BUBBLE_RULE.outlineBandPx / block));
  const band = new Uint8Array(gw * gh);
  {
    let frontier: number[] = [];
    for (let i = 0; i < gw * gh; i++) if (inside(i)) frontier.push(i);
    for (let step = 0; step < bandCells && frontier.length > 0; step++) {
      const next: number[] = [];
      for (const i of frontier) {
        const gx = i % gw;
        const gy = (i - gx) / gw;
        const neighbors = [gx > 0 ? i - 1 : -1, gx < gw - 1 ? i + 1 : -1, gy > 0 ? i - gw : -1, gy < gh - 1 ? i + gw : -1];
        for (const n of neighbors) {
          if (n < 0 || band[n] || inside(n)) continue;
          band[n] = 1;
          next.push(n);
        }
      }
      frontier = next;
    }
  }

  // 6) 원문 글자 획이 모양 밖에 남으면 흰색으로 다 못 덮으므로 실패
  let inkCells = 0;
  let uncovered = 0;
  for (let gy = gby0; gy < gby1; gy++) {
    for (let gx = gbx0; gx < gbx1; gx++) {
      const i = gy * gw + gx;
      if (!ink[i] || band[i]) continue;
      inkCells++;
      if (!inside(i)) uncovered++;
    }
  }
  let boxInside = 0;
  for (let gy = gby0; gy < gby1; gy++) for (let gx = gbx0; gx < gbx1; gx++) if (inside(gy * gw + gx)) boxInside++;
  const overhang = boxInside >= boxCells * BUBBLE_RULE.boxInsideLoose && uncovered <= inkCells * BUBBLE_RULE.uncoveredInkLoose;
  if (inkCells > 0 && uncovered / inkCells > BUBBLE_RULE.maxUncoveredInk && !overhang) {
    // 둘러싼 영역(흰색 + 그 안에 갇힌 글자 획)이 글자 영역에 비해 작으면 말풍선이 아니라 글자 속 흰 틈만 채운 것
    let enclosed = 0;
    for (let i = 0; i < gw * gh; i++) if (enclosedCell(i)) enclosed++;
    if (enclosed < boxCells * BUBBLE_RULE.minEnclosureRatio) return fail('no-enclosure');
    // 말풍선은 있음: 원문만 지울 자리 = 말풍선 안쪽 중 글자 영역(+2칸) 범위
    const inBox = (i: number) => {
      const gx = i % gw;
      const gy = (i - gx) / gw;
      return gx >= gbx0 - 2 && gx < gbx1 + 2 && gy >= gby0 - 2 && gy < gby1 + 2;
    };
    const erase = shapeOf(i => inside(i) && inBox(i));
    const interior = shapeOf(inside);
    return erase
      ? { shape: null, failure: 'uncovered-ink', erase: erase.shape, ...(interior ? { interior: interior.shape } : {}) }
      : fail('uncovered-ink');
  }

  const whole = shapeOf(inside);
  if (!whole) return fail('no-seed');

  // 8) 이어진 말풍선: 글자 영역 하나가 잘록한 목을 사이에 둔 두 칸에 걸쳐 있으면 칸별로 나눔 (다른 대사와 나눈 경우는 제외)
  if (rivals.length === 0) {
    const lobes = findLobes();
    if (lobes) return { shape: whole.shape, lobes };
  }
  return { shape: whole.shape };

  function findLobes(): BubbleLobe[] | undefined {
    const counted = (i: number) => ink[i] && !band[i] && inside(i);
    let best: { axis: 'x' | 'y'; cut: number; ratio: number } | null = null;
    // 글자 한 자 크기 (격자 칸). 나눈 양쪽이 모두 한 줄짜리면 한 줄의 글자를 둘로 쪼갠 것이므로 나누지 않음
    // (예: 효과음 「キャッ!!」 세로 한 줄이 번개 모양 배경의 뾰족한 테두리 때문에 「キャ」「ッ!!」로 나뉘었음)
    const glyphPx = estimateGlyphSize(region, box);
    const glyphCells = glyphPx ? glyphPx / block : 0;
    for (const axis of ['x', 'y'] as const) {
      // a: 나누는 방향(열 또는 행), b: 그와 수직
      const [a0, a1] = axis === 'x' ? [gbx0, gbx1] : [gby0, gby1];
      const [b0, b1] = axis === 'x' ? [gby0, gby1] : [gbx0, gbx1];
      const bAll = axis === 'x' ? gh : gw;
      const at = (a: number, b: number) => (axis === 'x' ? b * gw + a : a * gw + b);
      const inkAt: number[] = [];
      for (let a = a0; a < a1; a++) {
        let n = 0;
        for (let b = b0; b < b1; b++) if (counted(at(a, b))) n++;
        inkAt.push(n);
      }
      const total = inkAt.reduce((x, y) => x + y, 0);
      const first = inkAt.findIndex(n => n > 0);
      const last = inkAt.length - 1 - [...inkAt].reverse().findIndex(n => n > 0);
      if (total === 0 || first < 0 || last <= first) continue;
      // 글자 묶음 사이 빈 틈들
      const gaps: { start: number; end: number }[] = [];
      for (let k = first + 1; k < last; k++) {
        if (inkAt[k] > 0) continue;
        const start = k;
        while (k < last && inkAt[k] === 0) k++;
        gaps.push({ start, end: k });
      }
      if (gaps.length === 0) continue;
      const widths = gaps.map(g => g.end - g.start).sort((x, y) => x - y);
      const median = widths[Math.floor(widths.length / 2)];
      // 말풍선 안쪽의 폭(나누는 방향에 수직인 길이)
      const lenAt = (k: number) => {
        let n = 0;
        for (let b = 0; b < bAll; b++) if (inside(at(a0 + k, b))) n++;
        return n;
      };
      for (const gap of gaps) {
        let before = 0;
        for (let k = first; k < gap.start; k++) before += inkAt[k];
        if (Math.min(before, total - before) < total * BUBBLE_RULE.lobeMinInk) continue;
        let neck = Infinity;
        for (let k = gap.start; k < gap.end; k++) neck = Math.min(neck, lenAt(k));
        let sideA = 0;
        for (let k = first; k < gap.start; k++) sideA = Math.max(sideA, lenAt(k));
        let sideB = 0;
        for (let k = gap.end; k <= last; k++) sideB = Math.max(sideB, lenAt(k));
        const ratio = neck / Math.max(1, Math.min(sideA, sideB));
        const wide = gaps.length > 1 && gap.end - gap.start >= median * BUBBLE_RULE.lobeWideGap;
        if (!(ratio < BUBBLE_RULE.lobeNeck || (wide && ratio < BUBBLE_RULE.lobeLooseNeck))) continue;
        if (glyphCells > 0) {
          // 자르는 선과 나란한 방향으로 본 양쪽 글자 폭: 둘 다 글자 1.6자 이하면 한 줄
          const across = (from: number, to: number) => {
            let lo = Infinity;
            let hi = -Infinity;
            for (let k = from; k < to; k++) {
              for (let b = b0; b < b1; b++) {
                if (!counted(at(a0 + k, b))) continue;
                lo = Math.min(lo, b);
                hi = Math.max(hi, b + 1);
              }
            }
            return hi - lo;
          };
          const single = (w: number) => w <= glyphCells * BUBBLE_RULE.lobeSingleLineGlyphs;
          if (single(across(first, gap.start)) && single(across(gap.end, last + 1))) continue;
        }
        if (!best || ratio < best.ratio) best = { axis, cut: a0 + Math.floor((gap.start + gap.end) / 2), ratio };
      }
    }
    if (!best) return undefined;
    const { axis, cut } = best;
    const coord = (i: number) => (axis === 'x' ? i % gw : Math.floor(i / gw));
    // 읽는 순서: 가로로 나뉘면 오른쪽 칸 먼저(세로쓰기 일본 만화), 세로로 나뉘면 위 칸 먼저
    const sides = axis === 'x'
      ? [(i: number) => coord(i) >= cut, (i: number) => coord(i) < cut]
      : [(i: number) => coord(i) < cut, (i: number) => coord(i) >= cut];
    let totalInk = 0;
    const lobes: BubbleLobe[] = [];
    const inks: number[] = [];
    for (const side of sides) {
      const part = shapeOf(i => inside(i) && side(i));
      if (!part || part.area < boxCells * BUBBLE_RULE.minEnclosureRatio * 0.5) return undefined;
      let n = 0;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let gy = gby0; gy < gby1; gy++) {
        for (let gx = gbx0; gx < gbx1; gx++) {
          const i = gy * gw + gx;
          if (!counted(i) || !side(i)) continue;
          n++;
          x0 = Math.min(x0, gx); y0 = Math.min(y0, gy); x1 = Math.max(x1, gx + 1); y1 = Math.max(y1, gy + 1);
        }
      }
      if (n === 0) return undefined;
      totalInk += n;
      inks.push(n);
      // 원문 글자 범위 + 약간의 여백 (원래 박스 밖으로는 넓히지 않음)
      const pad = 2 * block;
      lobes.push({
        shape: part.shape,
        inkShare: 0,
        box: {
          xmin: Math.max(box.xmin, region.x + x0 * block - pad),
          ymin: Math.max(box.ymin, region.y + y0 * block - pad),
          xmax: Math.min(box.xmax, region.x + x1 * block + pad),
          ymax: Math.min(box.ymax, region.y + y1 * block + pad),
        },
      });
    }
    lobes.forEach((lobe, k) => { lobe.inkShare = inks[k] / totalInk; });
    return lobes;
  }
}

/** 흰 칸 중 radius 칸 안(가로·세로)에 어두운 칸이 있으면 막힌 칸으로 바꾼 사본 */
function closeGaps(white: Uint8Array, gw: number, gh: number, radius: number): Uint8Array {
  const out = new Uint8Array(white);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (white[gy * gw + gx]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = gx + dx;
          const y = gy + dy;
          if (x >= 0 && y >= 0 && x < gw && y < gh) out[y * gw + x] = 0;
        }
      }
    }
  }
  return out;
}

/** 원문 글자 판정 밝기 (이보다 어두우면 획) */
const GLYPH_INK_LUMA = 140;

/** 원문 글자 크기를 잴 때 한 번에 보는 픽셀 수 상한 (넘으면 건너뛰며 봄) */
const GLYPH_MAX_PIXELS = 400_000;

/**
 * 원문 글자 한 자의 크기(px)를 잽니다. 글자 영역의 획을 서로 이어진 덩어리로 묶어, 덩어리마다 가로·세로 중 긴 쪽을 재고
 * 상위 25% 지점 값을 씀 — 한 글자가 여러 덩어리로 나뉘거나(획이 떨어진 한자) 작은 덩어리(문장부호·탁점·후리가나)가 섞여도
 * 큰 쪽은 글자 한 자 크기에 모임. 박스 가장자리에 닿은 덩어리(말풍선 테두리·그림)는 뺌. 못 재면 null.
 * (예전엔 세로 줄 폭을 쟀는데, 줄 사이가 좁거나 후리가나가 끼면 여러 줄이 한 덩어리로 잡혀 3~8배로 크게 나왔음)
 */
export function estimateGlyphSize(region: PixelRegion, box: PixelBox): number | null {
  const x0 = Math.max(0, Math.floor(box.xmin - region.x));
  const y0 = Math.max(0, Math.floor(box.ymin - region.y));
  const x1 = Math.min(region.width, Math.ceil(box.xmax - region.x));
  const y1 = Math.min(region.height, Math.ceil(box.ymax - region.y));
  const step = Math.max(1, Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / GLYPH_MAX_PIXELS)));
  const w = Math.floor((x1 - x0) / step);
  const h = Math.floor((y1 - y0) / step);
  if (w < 4 || h < 4) return null;
  const ink = new Uint8Array(w * h);
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const x = x0 + gx * step;
      const y = y0 + gy * step;
      ink[gy * w + gx] = lumaAt(region.data, (y * region.width + x) * 4) < GLYPH_INK_LUMA ? 1 : 0;
    }
  }
  const seen = new Uint8Array(w * h);
  const inner: number[] = [];
  const edge: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || seen[start]) continue;
    let minX = w, maxX = -1, minY = h, maxY = -1, count = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const p = stack.pop()!;
      const px = p % w;
      const py = (p - px) / w;
      count++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = px + dx;
          const qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const q = qy * w + qx;
          if (ink[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    // 점 몇 개짜리 잡티는 무시
    if (count * step * step < 6) continue;
    const size = Math.max(maxX - minX + 1, maxY - minY + 1) * step;
    (minX === 0 || minY === 0 || maxX === w - 1 || maxY === h - 1 ? edge : inner).push(size);
  }
  // 박스가 글자에 딱 맞아 모든 덩어리가 가장자리에 닿으면 그것도 씀
  const sizes = (inner.length > 0 ? inner : edge).sort((a, b) => a - b);
  if (sizes.length === 0) return null;
  return sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * 0.75))];
}

/** 큰 덩어리를 줄 단위로 잘라 쓸 때 모아 두는 픽셀 수 상한 (넘으면 그 덩어리는 건너뜀) */
const BIG_COMPONENT_CAP = 60_000;

/** 글자 획 마스크 규칙 */
const GLYPH_MASK = {
  /** 이보다 어두우면 획 (안티에일리어싱 가장자리는 아래 dilate로 덮음) */
  inkLuma: 165,
  /** 글자 영역 둘레 여유 (글자 크기 배수) — 후리가나·문장부호처럼 박스 밖으로 살짝 나간 획 */
  windowPad: 0.6,
  /** 한 덩어리의 가로·세로가 글자 크기의 이 배수를 넘으면 글자가 아니라 테두리·그림 */
  maxComponent: 2.5,
  /** 가늘고 긴 기호(물결표 「〜〜〜」·줄표): 짧은 변이 글자의 이 배수 이하이고 긴 변이 이 배수 이하이며 글자 영역(+여유) 안에 통째로 있으면 글자 */
  maxThinSide: 0.9,
  maxLongComponent: 7,
  /** 지울 때 획 둘레로 넓히는 두께 (글자 크기 배수, 최소 2px) — 인쇄 번짐·JPEG 얼룩까지 (0.08이면 옅은 잔상이 남았음) */
  dilate: 0.14,
  maxDilatePx: 4,
  /** 종이 색으로 볼 밝기 */
  paperLuma: 200,
  /** 획 둘레(획에서 2px 떨어진 곳) 중 종이 색이어야 하는 비율 — 글자는 흰 종이 위, 그림 선은 다른 선·톤과 얽혀 있음 */
  minPaperRing: 0.7,
  /** 글자 영역 안에 통째로 든 글자 크기 덩어리의 둘레 기준 (테두리선 옆 글자) */
  minPaperRingInBox: 0.45,
  /** 둘레 검사에서 이 밝기 이상이면 종이 (획 기준 165보다 조금 밝으면 됨) */
  ringPaperLuma: 175,
  ringDistance: 2,
} as const;

/**
 * 원문 글자 획만 골라 마스크로 만듭니다. 글자 = 아래를 모두 만족하는 획 덩어리:
 * - 글자 영역(+여유) 안에, 그리고 찾은 말풍선 안쪽에 가운데가 있음 (말풍선 옆 얼굴·옷 선 제외)
 * - 글자 크기 2.5배 이하 (테두리선·큰 그림 제외)
 * - 둘레가 대부분 종이 색 (그림 선은 다른 선·톤과 얽혀 있음)
 * 말풍선 안쪽을 모르면(효과음 등) 만들지 않음. 원본 해상도라 경계가 계단처럼 어긋나지 않음
 */
export function buildGlyphMask(
  region: PixelRegion,
  box: PixelBox,
  glyphPx: number,
  imageWidth: number,
  imageHeight: number,
  /** 찾은 말풍선 안쪽 — 덮은 비율을 잴 때 이 안의 어두운 픽셀만 셈 (박스가 테두리·그림에 걸친 부분은 원문이 아님) */
  area?: BubbleShape | null,
): GlyphMask | null {
  const { data, width: rw, height: rh } = region;
  if (!(glyphPx > 0) || !area) return null;
  const inArea = (x: number, y: number) => {
    const ny = ((y + region.y) / imageHeight) * 1000;
    const row = area.rows[Math.floor((ny - area.top) / area.rowHeight)];
    if (!row) return false;
    const nx = ((x + region.x) / imageWidth) * 1000;
    return nx >= row[0] && nx <= row[1];
  };
  const pad = glyphPx * GLYPH_MASK.windowPad;
  const wx0 = Math.max(0, Math.floor(box.xmin - pad - region.x));
  const wy0 = Math.max(0, Math.floor(box.ymin - pad - region.y));
  const wx1 = Math.min(rw, Math.ceil(box.xmax + pad - region.x));
  const wy1 = Math.min(rh, Math.ceil(box.ymax + pad - region.y));
  if (wx1 - wx0 < 2 || wy1 - wy0 < 2) return null;
  const isInk = (i: number) => lumaAt(data, i * 4) < GLYPH_MASK.inkLuma;
  const maxSide = glyphPx * GLYPH_MASK.maxComponent;
  const longSide = glyphPx * GLYPH_MASK.maxLongComponent;
  const thinSide = glyphPx * GLYPH_MASK.maxThinSide;
  const maxPixels = Math.ceil(longSide * maxSide);

  // 1) 글자 후보 덩어리 모으기: 글자 크기 2.5배 이하, 또는 가늘고 긴 기호(물결표·줄표 — 글자 영역 안에 통째로 있을 때)
  const seen = new Uint8Array(rw * rh);
  /** 후보 덩어리 번호 (0 = 후보 아님). 둘레 검사에서 이웃 글자 조각을 종이처럼 보려고 */
  const label = new Uint32Array(rw * rh);
  const candidates: number[][] = [];
  /** 글자 크기를 넘는 덩어리 (테두리·그림, 또는 그것에 붙은 글자) */
  const bigComponents: number[][] = [];
  const boxes: { minX: number; maxX: number; minY: number; maxY: number; inArea: boolean }[] = [];
  const stack: number[] = [];
  for (let y = wy0; y < wy1; y++) {
    for (let x = wx0; x < wx1; x++) {
      const start = y * rw + x;
      if (seen[start] || !isInk(start)) continue;
      // 덩어리 하나를 끝까지 따라감 (너무 크면 글자가 아님 — 표시만 하고 버림)
      let minX = x, maxX = x, minY = y, maxY = y;
      let tooBig = false;
      const component: number[] = [];
      seen[start] = 1;
      stack.push(start);
      while (stack.length > 0) {
        const p = stack.pop()!;
        const px = p % rw;
        const py = (p - px) / rw;
        // 큰 덩어리(테두리·그림에 붙은 글자일 수 있음)도 글자 근처 부분만 잘라 쓰려고, 창(글자 영역+여유) 안 픽셀은 모아 둠
        // (컷 테두리처럼 페이지 전체로 이어진 덩어리도 창 안 부분만이라 크지 않음)
        if (component.length < BIG_COMPONENT_CAP && (!tooBig || (px >= wx0 && px < wx1 && py >= wy0 && py < wy1))) component.push(p);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        if (!tooBig && (maxX - minX > longSide || maxY - minY > longSide || component.length > maxPixels)) tooBig = true;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const qx = px + dx;
            const qy = py + dy;
            if (qx < 0 || qy < 0 || qx >= rw || qy >= rh) continue;
            const q = qy * rw + qx;
            if (!seen[q] && isInk(q)) {
              seen[q] = 1;
              stack.push(q);
            }
          }
        }
      }
      if (tooBig) {
        if (component.length > 0 && component.length < BIG_COMPONENT_CAP) bigComponents.push(component);
        continue;
      }
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const small = w <= maxSide && h <= maxSide;
      const thin = Math.min(w, h) <= thinSide;
      const inWindow = minX >= wx0 && maxX < wx1 && minY >= wy0 && maxY < wy1;
      if (!small && !thin) continue;
      // 가운데가 글자 영역(+여유) 안, 그리고 찾은 말풍선 안쪽이어야 글자 (여유 끝에 걸친 그림·말풍선 옆 얼굴 선 제외)
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      if (cx < wx0 || cx >= wx1 || cy < wy0 || cy >= wy1) continue;
      candidates.push(component);
      // 가늘고 긴 기호가 글자 영역 밖으로 삐져나와 있으면(검출 박스가 짧게 잡힘) 둘레 검사로는 고르지 않고 줄 이어짐으로만
      boxes.push({ minX, maxX, minY, maxY, inArea: inArea(cx, cy) && (small || inWindow) });
      for (const p of component) label[p] = candidates.length;
    }
  }

  // 2) 둘레(획에서 ringDistance 떨어진 곳)가 대부분 종이 색이거나 이웃 글자 조각인 덩어리만 — 그림 선은 다른 선·톤과 얽혀 있음
  //    (빽빽한 한자는 한 조각 둘레에 같은 글자의 다른 조각이 붙어 있어, 이웃 후보 조각은 종이처럼 셈)
  const accepted: number[] = [];
  const isAccepted = new Uint8Array(candidates.length);
  const d = GLYPH_MASK.ringDistance;
  candidates.forEach((component, index) => {
    // 말풍선 안쪽(가운데 기준)이 아닌 덩어리는 아래 "줄 이어짐"으로만 살림
    if (!boxes[index].inArea) return;
    const own = index + 1;
    let ok = 0;
    let ring = 0;
    for (const p of component) {
      const px = p % rw;
      const py = (p - px) / rw;
      for (const [ox, oy] of [[d, 0], [-d, 0], [0, d], [0, -d]] as const) {
        const qx = px + ox;
        const qy = py + oy;
        if (qx < 0 || qy < 0 || qx >= rw || qy >= rh) continue;
        const q = qy * rw + qx;
        if (label[q] === own) continue;
        ring++;
        // 획이 아닌 밝기면 종이로 셈 — 빽빽한 한자의 작은 구멍은 번짐 때문에 옅은 회색(165~200)이라 고정 밝기 200으로는 떨어졌음
        if (label[q] > 0 || lumaAt(data, q * 4) >= GLYPH_MASK.ringPaperLuma) ok++;
      }
    }
    // 글자 영역 안에 통째로 들어 있는 글자 한 자 크기 덩어리는 테두리선 바로 옆이라 둘레가 덜 하얘도 글자로 봄
    // (말풍선 끝에 붙어 쓴 첫 글자 「や」 등)
    const b = boxes[index];
    const side = Math.max(b.maxX - b.minX, b.maxY - b.minY) + 1;
    const slack = glyphPx * 0.3;
    const insideBox = b.minX + region.x >= box.xmin - slack && b.maxX + region.x <= box.xmax + slack
      && b.minY + region.y >= box.ymin - slack && b.maxY + region.y <= box.ymax + slack;
    const glyphLike = insideBox && side >= glyphPx * 0.5 && side <= glyphPx * 1.4;
    const need = glyphLike ? GLYPH_MASK.minPaperRingInBox : GLYPH_MASK.minPaperRing;
    if (ring > 0 && ok / ring < need) return;
    isAccepted[index] = 1;
    for (const p of component) accepted.push(p);
  });

  // 3) 줄 이어짐: 고른 글자들이 이루는 줄(세로쓰기는 세로줄, 가로쓰기는 가로줄) 위에 있는 덩어리는 글자로 살림.
  //    말풍선 가장자리 줄의 글자(안쪽 판정이 거친 격자라 빠짐)·그림과 가까워 둘레 검사에 떨어진 글자를 구함.
  //    줄 = 고른 글자들의 가로(세로) 범위를 글자 크기 절반 안팎으로 겹쳐 묶은 것, 줄 길이 ±1글자 안의 덩어리만
  const vertical = box.ymax - box.ymin >= box.xmax - box.xmin;
  const lines: { lo: number; hi: number; from: number; to: number }[] = [];
  boxes.forEach((b, i) => {
    if (!isAccepted[i]) return;
    const [lo, hi, from, to] = vertical ? [b.minX, b.maxX, b.minY, b.maxY] : [b.minY, b.maxY, b.minX, b.maxX];
    const near = lines.find(line => lo <= line.hi + glyphPx * 0.3 && hi >= line.lo - glyphPx * 0.3);
    if (near) {
      near.lo = Math.min(near.lo, lo);
      near.hi = Math.max(near.hi, hi);
      near.from = Math.min(near.from, from);
      near.to = Math.max(near.to, to);
    } else {
      lines.push({ lo, hi, from, to });
    }
  });
  // 글자 하나뿐인 "줄"은 근거가 약하므로 글자 두 개 길이 이상인 줄만
  const realLines = lines.filter(line => line.to - line.from >= glyphPx * 1.5 && line.hi - line.lo <= glyphPx * 1.8);
  // 살린 글자로 줄이 늘어나면 그다음 글자도 이어서 (줄 끝에서 한 글자씩)
  for (let changed = true; changed;) {
    changed = false;
    boxes.forEach((b, i) => {
      if (isAccepted[i]) return;
      const [lo, hi, from, to] = vertical ? [b.minX, b.maxX, b.minY, b.maxY] : [b.minY, b.maxY, b.minX, b.maxX];
      const center = (lo + hi) / 2;
      const line = realLines.find(l =>
        center >= l.lo - glyphPx * 0.25 && center <= l.hi + glyphPx * 0.25 &&
        to >= l.from - glyphPx * 1.2 && from <= l.to + glyphPx * 1.2);
      if (!line) return;
      isAccepted[i] = 1;
      line.from = Math.min(line.from, from);
      line.to = Math.max(line.to, to);
      changed = true;
      for (const p of candidates[i]) accepted.push(p);
    });
  }
  // 4) 테두리·긴 선에 붙어 한 덩어리가 된 글자 (예: 「やァ」에서 이어진 긴 선에 닿은 「生」):
  //    큰 덩어리 중 줄(세로줄 폭) 안에 든 부분만 지움. 단 줄을 가로질러 양옆으로 이어지는 선(테두리·긴 줄표)은 남김 — 테두리에 구멍이 나지 않게
  for (const component of bigComponents) {
    const inBig = new Set(component);
    for (const line of realLines) {
      const lo = line.lo - glyphPx * 0.15;
      const hi = line.hi + glyphPx * 0.15;
      const from = line.from - glyphPx * 1.2;
      const to = line.to + glyphPx * 1.2;
      const picked: number[] = [];
      let first = Infinity;
      let last = -Infinity;
      for (const p of component) {
        const px = p % rw;
        const py = (p - px) / rw;
        const [across, along] = vertical ? [px, py] : [py, px];
        if (across < lo || across > hi || along < from || along > to) continue;
        // 이 픽셀을 지나는 가로선(세로쓰기 기준)이 줄 양옆 밖까지 이어지면 가로지르는 선
        let a = across;
        let b = across;
        const stepTo = (k: number) => (vertical ? py * rw + k : k * rw + px);
        while (a > 0 && inBig.has(stepTo(a - 1))) a--;
        while (b < (vertical ? rw : rh) - 1 && inBig.has(stepTo(b + 1))) b++;
        // (글자 자기 가로획은 줄 폭보다 조금 넓을 수 있어 양옆으로 반 글자 넘게 이어질 때만 가로지르는 선)
        if (a < lo - glyphPx * 0.5 && b > hi + glyphPx * 0.5) continue;
        picked.push(p);
        first = Math.min(first, along);
        last = Math.max(last, along);
      }
      // 줄 방향으로 글자 일부만큼(0.4글자)은 있어야 — 테두리 끝자락 몇 점은 무시
      if (picked.length > 0 && last - first >= glyphPx * 0.4) for (const p of picked) accepted.push(p);
    }
  }

  // 5) 테두리선에 닿아 한 덩어리가 된 글자 (줄을 이루지 못한 짧은 줄의 글자, 예: 말풍선 위 끝에 붙은 「や」):
  //    큰 덩어리 중 글자 영역 안에서 가로·세로로 길게 이어지지 않은 픽셀(테두리선이 아님)만 모아 글자 크기 조각이면 지움
  const runLimit = glyphPx * 1.3;
  for (const component of bigComponents) {
    const inBig = new Set(component);
    const run = (p: number, dx: number, dy: number) => {
      let n = 0;
      let x = p % rw;
      let y = (p - x) / rw;
      while (n <= runLimit) {
        x += dx;
        y += dy;
        if (x < 0 || y < 0 || x >= rw || y >= rh || !inBig.has(y * rw + x)) break;
        n++;
      }
      return n;
    };
    const picked = new Set<number>();
    for (const p of component) {
      const x = p % rw;
      const y = (p - x) / rw;
      if (x + region.x < box.xmin || x + region.x >= box.xmax || y + region.y < box.ymin || y + region.y >= box.ymax) continue;
      if (run(p, 1, 0) + run(p, -1, 0) + 1 > runLimit) continue;
      if (run(p, 0, 1) + run(p, 0, -1) + 1 > runLimit) continue;
      picked.add(p);
    }
    // 고른 픽셀끼리 이어진 조각마다: 글자 한 자의 일부~한 자 크기이고 둘레가 어느 정도 종이면 글자
    const done = new Set<number>();
    for (const start of picked) {
      if (done.has(start)) continue;
      const piece: number[] = [];
      const todo = [start];
      done.add(start);
      let minX = rw, maxX = -1, minY = rh, maxY = -1;
      while (todo.length > 0) {
        const p = todo.pop()!;
        piece.push(p);
        const x = p % rw;
        const y = (p - x) / rw;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const q = (y + dy) * rw + x + dx;
            if (picked.has(q) && !done.has(q)) {
              done.add(q);
              todo.push(q);
            }
          }
        }
      }
      const side = Math.max(maxX - minX, maxY - minY) + 1;
      if (side < glyphPx * 0.4 || side > glyphPx * 1.4 || piece.length < 6) continue;
      let ok = 0;
      let ring = 0;
      const pieceSet = new Set(piece);
      for (const p of piece) {
        const x = p % rw;
        const y = (p - x) / rw;
        for (const [ox, oy] of [[d, 0], [-d, 0], [0, d], [0, -d]] as const) {
          const qx = x + ox;
          const qy = y + oy;
          if (qx < 0 || qy < 0 || qx >= rw || qy >= rh) continue;
          const q = qy * rw + qx;
          if (pieceSet.has(q)) continue;
          ring++;
          if (lumaAt(data, q * 4) >= GLYPH_MASK.ringPaperLuma) ok++;
        }
      }
      if (ring > 0 && ok / ring < GLYPH_MASK.minPaperRingInBox) continue;
      for (const p of piece) accepted.push(p);
    }
  }

  if (accepted.length === 0) return null;

  // 글자 영역 안 어두운 픽셀 중 덮은 비율 (말풍선 안쪽을 알면 그 안만, 테두리 쪽 오차를 빼려고 조금 안쪽까지만)
  const shrink = glyphPx * 0.15;
  const insideArea = (x: number, y: number) => {
    if (!area) return true;
    const ny = ((y + region.y) / imageHeight) * 1000;
    const row = area.rows[Math.floor((ny - area.top) / area.rowHeight)];
    if (!row) return false;
    const px = x + region.x;
    return px >= (row[0] / 1000) * imageWidth + shrink && px <= (row[1] / 1000) * imageWidth - shrink;
  };
  const bx0 = Math.max(0, Math.floor(box.xmin - region.x));
  const by0 = Math.max(0, Math.floor(box.ymin - region.y));
  const bx1 = Math.min(rw, Math.ceil(box.xmax - region.x));
  const by1 = Math.min(rh, Math.ceil(box.ymax - region.y));
  const inMask = new Uint8Array(rw * rh);
  for (const p of accepted) inMask[p] = 1;
  let ink = 0;
  let covered = 0;
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      const i = y * rw + x;
      if (!isInk(i) || !insideArea(x, y)) continue;
      ink++;
      if (inMask[i]) covered++;
    }
  }

  // 마스크 범위 = 고른 획 + 넓힘
  // 큰 글씨(효과음)도 번짐 두께는 비슷하므로 위로 묶음 (글자 크기에 비례시키면 큰 덩어리로 번졌음)
  const r = Math.min(GLYPH_MASK.maxDilatePx, Math.max(2, Math.round(glyphPx * GLYPH_MASK.dilate)));
  let mx0 = rw, my0 = rh, mx1 = -1, my1 = -1;
  for (const p of accepted) {
    const px = p % rw;
    const py = (p - px) / rw;
    if (px < mx0) mx0 = px;
    if (px > mx1) mx1 = px;
    if (py < my0) my0 = py;
    if (py > my1) my1 = py;
  }
  mx0 = Math.max(0, mx0 - r);
  my0 = Math.max(0, my0 - r);
  mx1 = Math.min(rw - 1, mx1 + r);
  my1 = Math.min(rh - 1, my1 + r);
  const mw = mx1 - mx0 + 1;
  const mh = my1 - my0 + 1;
  const mask = new Uint8Array(mw * mh);
  for (const p of accepted) {
    const px = (p % rw) - mx0;
    const py = Math.floor(p / rw) - my0;
    for (let dy = -r; dy <= r; dy++) {
      const y = py + dy;
      if (y < 0 || y >= mh) continue;
      for (let dx = -r; dx <= r; dx++) {
        const x = px + dx;
        if (x >= 0 && x < mw) mask[y * mw + x] = 1;
      }
    }
  }

  // 종이 색: 글자 영역(+여유)의 밝은 픽셀 채널별 가운데값
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  for (let y = wy0; y < wy1; y += 2) {
    for (let x = wx0; x < wx1; x += 2) {
      const i = (y * rw + x) * 4;
      if (lumaAt(data, i) < GLYPH_MASK.paperLuma) continue;
      reds.push(data[i]);
      greens.push(data[i + 1]);
      blues.push(data[i + 2]);
    }
  }
  const median = (values: number[]) => {
    if (values.length === 0) return 255;
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };

  return {
    x: region.x + mx0,
    y: region.y + my0,
    width: mw,
    height: mh,
    data: mask,
    color: [median(reds), median(greens), median(blues)],
    coverage: ink > 0 ? covered / ink : 0,
    imageWidth,
    imageHeight,
  };
}

/** 원본 이미지를 한 번 그려두고 글자 영역마다 픽셀을 읽어 모양을 찾습니다. */
function createPixelReader(image: HTMLImageElement | HTMLCanvasElement) {
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

/** 한 페이지의 글자 영역마다 말풍선 모양을 찾습니다. 찾지 못한 항목은 이유와 함께 */
export function detectPageBubbleShapes(
  image: HTMLImageElement | HTMLCanvasElement,
  results: { id: string; box_2d: [number, number, number, number] }[],
): Record<string, BubbleDetection> {
  const reader = createPixelReader(image);
  const { width, height } = reader;
  const boxes = results.map(r => {
    const [ymin, xmin, ymax, xmax] = r.box_2d;
    return { xmin: (xmin / 1000) * width, ymin: (ymin / 1000) * height, xmax: (xmax / 1000) * width, ymax: (ymax / 1000) * height };
  });

  const shapes: Record<string, BubbleDetection> = {};
  results.forEach((result, i) => {
    const others = boxes.filter((_, j) => j !== i);
    const region = reader.read(searchRegionFor(boxes[i], width, height));
    let detection = region ? detectBubble(region, boxes[i], width, height, others) : fail('tiny');
    // 범위 끝까지 번졌으면 말풍선이 범위보다 큰 것일 수 있으니(큰 말풍선에 작은 글자, 홀쭉한 말풍선) 넓게 한 번 더.
    // 넓게 봐도 번지거나 말풍선이라기엔 너무 넓게 퍼지면(컷 전체 같은 밝은 배경) 말풍선 없는 글자로 봄
    if (detection.failure === 'leak') {
      const wide = reader.read(searchRegionFor(boxes[i], width, height, true));
      if (wide) {
        const retry = detectBubble(wide, boxes[i], width, height, others, BUBBLE_RULE.wideMaxAreaRatio);
        if (retry.shape || (retry.failure !== 'leak' && retry.failure !== 'too-big')) detection = retry;
      }
    }
    const glyph = region ? estimateGlyphSize(region, boxes[i]) : null;
    // 말풍선이 없는 글자(옆에 붙이기)는 덮지 않으므로 마스크도 만들지 않음
    const glyphMask = region && glyph && !(detection.failure && NO_BUBBLE_FAILURES.has(detection.failure))
      ? buildGlyphMask(region, boxes[i], glyph, width, height, detection.shape ?? detection.interior ?? null)
      : null;
    shapes[result.id] = {
      ...detection,
      ...(glyph ? { glyph: (glyph / height) * 1000 } : {}),
      ...(glyphMask ? { glyphMask } : {}),
    };
  });
  return shapes;
}

/**
 * 번역 요청 전: 글자 영역 하나가 이어진 말풍선 두 칸에 걸쳐 있으면 칸별 글자 영역으로 나눕니다.
 * 그래야 AI가 칸마다 따로 번역하고, 화면에서도 칸마다 제 번역문이 들어감. (같은 요청 안이라 비용 그대로)
 * 나눈 칸은 읽는 순서대로 원래 자리에 넣으므로 순서가 유지됩니다.
 */
export function splitTextBoxesByBubble<T extends PixelBox>(image: HTMLImageElement | HTMLCanvasElement, boxes: T[]): T[] {
  if (boxes.length === 0) return boxes;
  const reader = createPixelReader(image);
  const { width, height } = reader;
  const out: T[] = [];
  boxes.forEach((box, i) => {
    const region = reader.read(searchRegionFor(box, width, height));
    const detection = region ? detectBubble(region, box, width, height, boxes.filter((_, j) => j !== i)) : null;
    const lobes = detection?.shape ? detection.lobes : undefined;
    if (!lobes) {
      out.push(box);
      return;
    }
    console.info(`[연리지] 글자 영역 하나를 이어진 말풍선 ${lobes.length}칸으로 나눔`);
    for (const lobe of lobes) out.push({ ...box, ...lobe.box });
  });
  return out;
}
