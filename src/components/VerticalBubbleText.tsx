import { OVERLAY_STYLE, VERTICAL_TEXT, type VerticalLayout } from '../lib/overlayLayout';

interface VerticalBubbleTextProps {
  layout: VerticalLayout;
}

/**
 * 세로쓰기 말풍선. 이미지 저장(lib/exportCanvas.ts)과 같은 배치 계산 결과를 그대로 그려서
 * 화면과 저장본이 같게 보입니다. (첫 열이 오른쪽 — 일본 만화 세로쓰기 방향)
 */
export function VerticalBubbleText({ layout }: VerticalBubbleTextProps) {
  const cellHeight = layout.fontSize * VERTICAL_TEXT.cellHeight;
  const columnWidth = layout.fontSize * VERTICAL_TEXT.columnWidth;

  return (
    <div
      className="bg-white text-gray-900 flex"
      style={{
        width: layout.width,
        height: layout.height,
        flexDirection: 'row-reverse',
        justifyContent: 'center',
        alignItems: 'center',
        fontSize: layout.fontSize,
        fontWeight: OVERLAY_STYLE.fontWeight,
        borderRadius: OVERLAY_STYLE.radiusPx,
        boxShadow: `0 ${OVERLAY_STYLE.shadowOffsetYPx}px ${OVERLAY_STYLE.shadowBlurPx}px rgba(0, 0, 0, 0.15)`,
      }}
    >
      {layout.columns.map((column, columnIndex) => (
        <div
          key={columnIndex}
          style={{ width: columnWidth, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}
        >
          {column.map((char, charIndex) => (
            <span key={charIndex} style={{ height: cellHeight, lineHeight: `${cellHeight}px`, whiteSpace: 'pre' }}>{char}</span>
          ))}
        </div>
      ))}
    </div>
  );
}
