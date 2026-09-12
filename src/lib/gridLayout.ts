/**
 * 격자 이미지의 칸 배치(열 수)를 정합니다.
 *
 * OpenAI 비전(detail: high)은 이미지를 1) 긴 변 2048px 2) 짧은 변 768px로 순서대로 줄인 뒤
 * 512×512 타일 수로 토큰을 매깁니다(타일당 170 + 기본 85, https://platform.openai.com/docs/guides/vision
 * 기준의 공개된 계산식 — gpt-5.6 계열도 같은 방식일 것으로 보고 추정한 값이라 실제 청구 토큰과는 약간 다를 수 있음).
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

/**
 * 칸이 cellCount개일 때, 추정 토큰이 가장 적은 열 수를 고릅니다.
 * 토큰이 같으면 더 정사각형에 가까운 쪽(1×N처럼 극단적으로 길쭉한 이미지가 되지 않도록),
 * 그마저 같으면 빈 칸(낭비되는 칸)이 적은 쪽을 고릅니다.
 */
export function chooseGridColumns(cellCount: number, cellSize: number): number {
  if (cellCount <= 1) return 1;

  let best = { columns: cellCount, tokens: Infinity, squareness: Infinity, wasted: Infinity };
  for (let columns = 1; columns <= cellCount; columns++) {
    const rows = Math.ceil(cellCount / columns);
    const width = columns * cellSize;
    const height = rows * cellSize;
    const tokens = estimateVisionTokens(width, height);
    const squareness = Math.abs(width - height);
    const wasted = columns * rows - cellCount;

    const better =
      tokens < best.tokens ||
      (tokens === best.tokens && squareness < best.squareness) ||
      (tokens === best.tokens && squareness === best.squareness && wasted < best.wasted);
    if (better) best = { columns, tokens, squareness, wasted };
  }
  return best.columns;
}
