import { fillOutline, type BubbleFit } from '../lib/bubbleLayout';
import { OVERLAY_STYLE } from '../lib/overlayLayout';
import { VerticalGlyph } from './VerticalBubbleText';

interface BubbleFitTextProps {
  fit: BubbleFit;
  pageWidth: number;
  pageHeight: number;
}

/**
 * 말풍선 모양(또는 타원)대로 원문을 흰색으로 지우고 번역문을 놓습니다.
 * 가로쓰기는 줄마다 그 높이의 폭에 맞춰, 세로쓰기는 열마다 그 위치의 높이에 맞춰 배치된 결과(lib/bubbleLayout.ts)를 그대로 그림.
 * 이미지 저장(lib/exportCanvas.ts)도 같은 배치 결과를 씁니다.
 */
export function BubbleFitText({ fit, pageWidth, pageHeight }: BubbleFitTextProps) {
  const outline = fillOutline(fit.layout.fill);
  const path = outline.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + ' Z';
  const textStyle = {
    fontSize: fit.layout.fontSize,
    fontWeight: OVERLAY_STYLE.fontWeight,
    letterSpacing: `${OVERLAY_STYLE.letterSpacingEm}em`,
  };

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
      <svg className="absolute inset-0" width={pageWidth} height={pageHeight} viewBox={`0 0 ${pageWidth} ${pageHeight}`}>
        <path d={path} fill="#ffffff" />
      </svg>
      {fit.direction === 'horizontal'
        ? fit.layout.lines.map((line, i) => (
          <div
            key={i}
            className="absolute text-gray-900"
            style={{
              ...textStyle,
              left: line.cx,
              top: line.top,
              height: fit.layout.lineHeight,
              transform: 'translateX(-50%)',
              lineHeight: `${fit.layout.lineHeight}px`,
              whiteSpace: 'pre',
            }}
          >
            {line.text}
          </div>
        ))
        : fit.layout.columns.map((column, i) => (
          <div
            key={i}
            className="absolute text-gray-900 flex flex-col items-center"
            style={{ ...textStyle, letterSpacing: 0, left: column.cx - fit.layout.columnWidth / 2, top: column.top, width: fit.layout.columnWidth }}
          >
            {column.cells.map((cell, j) => <VerticalGlyph key={j} cell={cell} cellHeight={fit.layout.cellHeight} />)}
          </div>
        ))}
    </div>
  );
}
