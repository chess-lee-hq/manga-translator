/**
 * 격자 이미지의 칸 배치(열 수)를 정합니다.
 *
 * OpenAI 비전(detail: high)은 이미지를 1) 긴 변 2048px 2) 짧은 변 768px로 순서대로 줄인 뒤
 * 512×512 타일 수로 토큰을 매깁니다(타일당 170 + 기본 85, https://platform.openai.com/docs/guides/vision
 * 기준의 공개된 계산식 — gpt-5.6·gpt-6 계열도 같은 방식일 것으로 보고 추정한 값이라 실제 청구 토큰과는 약간 다를 수 있음).
 * 정사각형이 항상 유리한 게 아니라, 짧은 변이 512의 배수에 가까울수록 유리해서 칸 수에 따라 직접 계산해 고릅니다.
 * 칸 하나의 실제 크기(CELL_SIZE)는 열 수와 무관하게 그대로라 글자 인식 품질에는 영향이 없습니다.
 */

const TILE_PX = 512;
const MAX_LONG_SIDE_PX = 2048;
const MAX_SHORT_SIDE_PX = 768;
const TOKENS_PER_TILE = 170;
const BASE_TOKENS = 85;

/** OpenAI 고해상도 비전 토큰 추정치 (문서화된 계산식 기반 추정) */
export function estimateVisionTokens(width: number, height: number): number {
  let w = width;
  let h = height;
  const longSide = Math.max(w, h);
  if (longSide > MAX_LONG_SIDE_PX) {
    const scale = MAX_LONG_SIDE_PX / longSide;
    w *= scale;
    h *= scale;
  }
  const shortSide = Math.min(w, h);
  if (shortSide > MAX_SHORT_SIDE_PX) {
    const scale = MAX_SHORT_SIDE_PX / shortSide;
    w *= scale;
    h *= scale;
  }
  const tiles = Math.ceil(w / TILE_PX) * Math.ceil(h / TILE_PX);
  return tiles * TOKENS_PER_TILE + BASE_TOKENS;
}

/** OpenAI가 이미지를 읽기 전에 줄이는 배율 (1 = 그대로) */
export function openAiDownscale(width: number, height: number): number {
  const first = Math.min(1, MAX_LONG_SIDE_PX / Math.max(width, height));
  const second = Math.min(1, MAX_SHORT_SIDE_PX / (Math.min(width, height) * first));
  return first * second;
}

/**
 * Gemini 이미지 토큰 추정치 — 양변 384px 이하면 258, 그보다 크면 768×768 타일마다 258로 공개된 방식 기준.
 * (Gemini 3 계열은 이미지마다 정해진 예산을 쓰는 방식일 수도 있어 추정일 뿐이지만, 어느 쪽이든
 *  OpenAI처럼 짧은 변을 768로 줄이지 않으므로 칸을 줄이지 않고 한 장에 담는 편이 유리함)
 */
const GEMINI_TILE_PX = 768;
const GEMINI_SMALL_PX = 384;
const GEMINI_TOKENS_PER_TILE = 258;

export function estimateGeminiImageTokens(width: number, height: number): number {
  if (width <= GEMINI_SMALL_PX && height <= GEMINI_SMALL_PX) return GEMINI_TOKENS_PER_TILE;
  return Math.ceil(width / GEMINI_TILE_PX) * Math.ceil(height / GEMINI_TILE_PX) * GEMINI_TOKENS_PER_TILE;
}

export type GridEngine = 'openai' | 'gemini';

/**
 * OpenAI로 보낼 때 칸 하나가 모델 눈에 최소 이만큼(px)은 보이게 합니다.
 * 토큰만 최소로 맞추면 칸이 많은 격자는 긴 변 2048 · 짧은 변 768로 줄어 30칸이면 칸당 150px 남짓까지 작아지는데,
 * 그러면 작은 글씨·한자 획이 뭉개져 품질 검사 재요청(고해상도 · 다른 엔진, 훨씬 비쌈)으로 이어집니다.
 */
export const MIN_EFFECTIVE_CELL_PX = 200;

interface Layout {
  columns: number;
  tokens: number;
  squareness: number;
  wasted: number;
}

function bestLayout(cellCount: number, cellSize: number, engine: GridEngine, minEffectivePx: number): Layout | null {
  let best: Layout | null = null;
  for (let columns = 1; columns <= cellCount; columns++) {
    const rows = Math.ceil(cellCount / columns);
    const width = columns * cellSize;
    const height = rows * cellSize;
    if (engine === 'openai' && cellSize * openAiDownscale(width, height) < minEffectivePx) continue;
    const tokens = engine === 'openai' ? estimateVisionTokens(width, height) : estimateGeminiImageTokens(width, height);
    const squareness = Math.abs(width - height);
    const wasted = columns * rows - cellCount;

    const better = !best ||
      tokens < best.tokens ||
      (tokens === best.tokens && squareness < best.squareness) ||
      (tokens === best.tokens && squareness === best.squareness && wasted < best.wasted);
    if (better) best = { columns, tokens, squareness, wasted };
  }
  return best;
}

/**
 * 칸이 cellCount개일 때, 추정 토큰이 가장 적은 열 수를 고릅니다. (해상도 하한 없이 한 장 기준)
 * 토큰이 같으면 더 정사각형에 가까운 쪽(1×N처럼 극단적으로 길쭉한 이미지가 되지 않도록),
 * 그마저 같으면 빈 칸(낭비되는 칸)이 적은 쪽을 고릅니다.
 */
export function chooseGridColumns(cellCount: number, cellSize: number): number {
  if (cellCount <= 1) return 1;
  return bestLayout(cellCount, cellSize, 'openai', 0)!.columns;
}

/** 격자 이미지 한 장에 담을 칸 수와 열 수 */
export interface GridImagePlan {
  count: number;
  columns: number;
}

/**
 * 칸들을 이미지 몇 장에 어떻게 나눠 담을지 정합니다. (여러 장이어도 요청은 한 번)
 * - OpenAI: 칸이 MIN_EFFECTIVE_CELL_PX보다 작게 줄어들지 않는 범위에서 이미지 토큰 합이 가장 적은 배치
 * - Gemini: 짧은 변을 줄이지 않으므로 한 장에 담고, 타일 수가 가장 적은 열 수
 */
export function planGridImages(
  cellCount: number,
  cellSize: number,
  engine: GridEngine = 'openai',
  minEffectivePx = MIN_EFFECTIVE_CELL_PX,
): GridImagePlan[] {
  if (cellCount <= 0) return [];
  if (engine === 'gemini') return [{ count: cellCount, columns: bestLayout(cellCount, cellSize, 'gemini', 0)!.columns }];

  let best: { plan: GridImagePlan[]; tokens: number } | null = null;
  for (let images = 1; images <= cellCount; images++) {
    const base = Math.floor(cellCount / images);
    const extra = cellCount % images;
    const plan: GridImagePlan[] = [];
    let tokens = 0;
    let feasible = true;
    for (let i = 0; i < images; i++) {
      const count = base + (i < extra ? 1 : 0);
      const layout = bestLayout(count, cellSize, 'openai', minEffectivePx);
      if (!layout) { feasible = false; break; }
      plan.push({ count, columns: layout.columns });
      tokens += layout.tokens;
    }
    // 장 수가 늘면 토큰도 대체로 늘어나므로, 조건을 만족하는 첫 배치보다 싼 배치가 나올 가능성은 낮지만 끝까지 비교
    if (feasible && (!best || tokens < best.tokens)) best = { plan, tokens };
  }
  // 칸 하나도 하한을 못 맞추는 크기면(cellSize가 너무 작음) 하한 없이 한 장
  return best?.plan ?? [{ count: cellCount, columns: chooseGridColumns(cellCount, cellSize) }];
}

/** 배치의 추정 이미지 토큰 합 */
export function estimatePlanTokens(plan: GridImagePlan[], cellSize: number, engine: GridEngine = 'openai'): number {
  return plan.reduce((sum, { count, columns }) => {
    const width = columns * cellSize;
    const height = Math.ceil(count / columns) * cellSize;
    return sum + (engine === 'openai' ? estimateVisionTokens(width, height) : estimateGeminiImageTokens(width, height));
  }, 0);
}
