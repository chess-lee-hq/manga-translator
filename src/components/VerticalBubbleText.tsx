import { OVERLAY_STYLE, VERTICAL_CORNER_OFFSET, VERTICAL_TEXT, type VerticalCell, type VerticalLayout } from '../lib/overlayLayout';

/**
 * 세로쓰기 한 칸. 문장부호도 한 글자처럼 한 칸을 차지하고, 종류에 따라 눕히거나(..·~·괄호) 오른쪽 위로 옮깁니다(마침표·쉼표).
 * 이미지 저장(lib/exportCanvas.ts drawVerticalCell)과 같은 규칙.
 */
export function VerticalGlyph({ cell, cellHeight }: { cell: VerticalCell; cellHeight: number }) {
  const height = cellHeight * cell.size;
  const transform = cell.kind === 'rotate'
    ? 'rotate(90deg)'
    : cell.kind === 'corner'
      ? `translate(${VERTICAL_CORNER_OFFSET.x}em, ${VERTICAL_CORNER_OFFSET.y}em)`
      : undefined;
  return (
    <span style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'pre' }}>
      <span style={{ display: 'inline-block', lineHeight: 1, transform }}>{cell.text}</span>
    </span>
  );
}

interface VerticalBubbleTextProps {
  layout: VerticalLayout;
  /** 모서리 둥글기 px (없으면 기본) */
  radius?: number;
}

/**
 * 세로쓰기 상자 (말풍선 모양을 쓰지 않을 때). 이미지 저장과 같은 배치 계산 결과를 그대로 그려서
 * 화면과 저장본이 같게 보입니다. (첫 열이 오른쪽 — 일본 만화 세로쓰기 방향)
 */
export function VerticalBubbleText({ layout, radius = OVERLAY_STYLE.radiusPx }: VerticalBubbleTextProps) {
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
        borderRadius: radius,
      }}
    >
      {layout.columns.map((column, columnIndex) => (
        <div
          key={columnIndex}
          style={{ width: columnWidth, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}
        >
          {column.map((cell, cellIndex) => <VerticalGlyph key={cellIndex} cell={cell} cellHeight={cellHeight} />)}
        </div>
      ))}
    </div>
  );
}
