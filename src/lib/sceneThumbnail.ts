import type { GridEngine } from './gridLayout';

/**
 * [실험] 격자와 함께 보내는 "장면 이미지": 페이지 전체를 아주 작게 줄인 것.
 * 글자를 읽으라는 게 아니라 표정·상황·누가 누구에게 말하는지 파악하라는 용도라 작아도 됩니다.
 *
 * 크기는 엔진이 가장 싸게 계산하는 한도에 맞춤 (공개된 계산식 기준 추정):
 * - OpenAI: detail "low"는 크기와 관계없이 이미지당 85토큰 → 긴 변 512px
 * - Gemini: 양변 384px 이하면 이미지당 258토큰 → 긴 변 384px
 */
export const SCENE_MAX_SIDE: Record<GridEngine, number> = { openai: 512, gemini: 384 };
const SCENE_JPEG_QUALITY = 0.7;

/** 장면 이미지를 쓴 요청을 사용량 창에서 따로 집계할 때 붙는 이름 */
export const SCENE_USAGE_VARIANT = '장면';

export function makeSceneThumbnail(image: HTMLImageElement, engine: GridEngine): string | null {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!(width > 0 && height > 0)) return null;
  const scale = Math.min(1, SCENE_MAX_SIDE[engine] / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', SCENE_JPEG_QUALITY);
}
