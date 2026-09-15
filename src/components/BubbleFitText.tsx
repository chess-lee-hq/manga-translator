import { fillOutline, type BubbleTextLayout } from '../lib/bubbleLayout';
import { OVERLAY_STYLE } from '../lib/overlayLayout';

interface BubbleFitTextProps {
  layout: BubbleTextLayout;
  pageWidth: number;
  pageHeight: number;
}

/**
 * 원본 말풍선 모양대로 원문을 흰색으로 지우고 번역문을 줄마다 그 자리 폭에 맞춰 놓습니다.
 * 이미지 저장(lib/exportCanvas.ts)과 같은 배치 결과(lib/bubbleLayout.ts)를 그대로 그립니다.
 */
export function BubbleFitText({ layout, pageWidth, pageHeight }: BubbleFitTextProps) {
  const outline = fillOutline(layout.fill);
  const path = outline.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + ' Z';

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
      <svg className="absolute inset-0" width={pageWidth} height={pageHeight} viewBox={`0 0 ${pageWidth} ${pageHeight}`}>
        <path d={path} fill="#ffffff" />
      </svg>
      {layout.lines.map((line, i) => (
        <div
          key={i}
          className="absolute text-gray-900"
          style={{
            left: line.cx,
            top: line.top,
            height: layout.lineHeight,
            transform: 'translateX(-50%)',
            fontSize: layout.fontSize,
            lineHeight: `${layout.lineHeight}px`,
            fontWeight: OVERLAY_STYLE.fontWeight,
            letterSpacing: `${OVERLAY_STYLE.letterSpacingEm}em`,
            whiteSpace: 'pre',
          }}
        >
          {line.text}
        </div>
      ))}
    </div>
  );
}
