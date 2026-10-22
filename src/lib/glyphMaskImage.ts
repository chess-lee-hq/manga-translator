import type { GlyphMask } from './bubbleShape';

/**
 * 원문 글자 획 마스크를 종이 색 이미지(캔버스)로. 화면(img)과 이미지 저장(drawImage)이 같이 씀.
 * 같은 마스크는 한 번만 만듦
 */
const canvasCache = new WeakMap<GlyphMask, HTMLCanvasElement>();
const urlCache = new WeakMap<GlyphMask, string>();

export function glyphMaskCanvas(mask: GlyphMask): HTMLCanvasElement | null {
  const cached = canvasCache.get(mask);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = mask.width;
  canvas.height = mask.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(mask.width, mask.height);
  const [r, g, b] = mask.color;
  for (let i = 0; i < mask.data.length; i++) {
    if (!mask.data[i]) continue;
    image.data[i * 4] = r;
    image.data[i * 4 + 1] = g;
    image.data[i * 4 + 2] = b;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  canvasCache.set(mask, canvas);
  return canvas;
}

export function glyphMaskUrl(mask: GlyphMask): string | null {
  const cached = urlCache.get(mask);
  if (cached) return cached;
  const canvas = glyphMaskCanvas(mask);
  if (!canvas) return null;
  const url = canvas.toDataURL('image/png');
  urlCache.set(mask, url);
  return url;
}
