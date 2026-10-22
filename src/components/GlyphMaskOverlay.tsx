import type { GlyphMask } from '../lib/bubbleShape';
import { glyphMaskUrl } from '../lib/glyphMaskImage';

/** 원문 글자 획만 종이 색으로 덮는 이미지 (원본 해상도 마스크를 페이지 비율 위치에) */
export function GlyphMaskOverlay({ mask }: { mask: GlyphMask }) {
  const url = glyphMaskUrl(mask);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      className="absolute pointer-events-none select-none"
      style={{
        left: `${(mask.x / mask.imageWidth) * 100}%`,
        top: `${(mask.y / mask.imageHeight) * 100}%`,
        width: `${(mask.width / mask.imageWidth) * 100}%`,
        height: `${(mask.height / mask.imageHeight) * 100}%`,
        zIndex: 20,
      }}
    />
  );
}
