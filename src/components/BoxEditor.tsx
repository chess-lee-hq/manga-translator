import { ArrowLeftRight, ArrowUpDown, Square, Tag, Trash2, Undo2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface BoxEditorProps {
  initialBox: [number, number, number, number];
  onChange: (newBox: [number, number, number, number]) => void;
  displayMode?: 'cover' | 'tag';
  onToggleDisplayMode?: () => void;
  textDirection?: 'horizontal' | 'vertical';
  onToggleTextDirection?: () => void;
  onDelete?: () => void;
  /** false면 크기 조절 손잡이 없이 이동만 가능 (지금은 항상 true — 딱지도 크기 조절을 지원) */
  resizable?: boolean;
  /** 있으면 툴바에 자동 배치로 되돌리는 버튼을 보여줌 */
  onResetPosition?: () => void;
  children: React.ReactNode;
}

/** 툴바에 들어가는 작은 아이콘 버튼 (다크 배경 위에서 hover 시 밝아짐) */
function ToolbarButton({ onClick, title, danger, children }: { onClick: () => void; title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      className={`p-1 rounded-full transition-colors cursor-pointer ${danger ? 'hover:bg-red-500/80' : 'hover:bg-white/25'}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
    >
      {children}
    </button>
  );
}

export function BoxEditor({
  initialBox, onChange, displayMode, onToggleDisplayMode,
  textDirection, onToggleTextDirection, onDelete, resizable = true, onResetPosition, children,
}: BoxEditorProps) {
  const [box, setBox] = useState<[number, number, number, number]>(initialBox);
  const boxRef = useRef(initialBox);
  useEffect(() => { boxRef.current = box; }, [box]);
  const isDragging = useRef(false);
  const isResizing = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startBox = useRef([...initialBox] as [number, number, number, number]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBox(initialBox);
  }, [initialBox.join(',')]);

  const handlePointerDown = (e: React.PointerEvent, type: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    if (type === 'move') isDragging.current = true;
    if (type === 'resize') isResizing.current = true;
    startPos.current = { x: e.clientX, y: e.clientY };
    startBox.current = [...box];
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!wrapperRef.current || !wrapperRef.current.parentElement) return;
    const rect = wrapperRef.current.parentElement.getBoundingClientRect();
    const dx = ((e.clientX - startPos.current.x) / rect.width) * 1000;
    const dy = ((e.clientY - startPos.current.y) / rect.height) * 1000;

    let newBox = [...startBox.current] as [number, number, number, number];
    if (isDragging.current) {
      newBox[0] += dy;
      newBox[1] += dx;
      newBox[2] += dy;
      newBox[3] += dx;
    } else if (isResizing.current) {
      newBox[2] = Math.max(newBox[0] + 10, newBox[2] + dy);
      newBox[3] = Math.max(newBox[1] + 10, newBox[3] + dx);
    }
    setBox(newBox);
  };

  const handlePointerUp = () => {
    isDragging.current = false;
    isResizing.current = false;
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
    onChange(boxRef.current);
  };

  const top = `${(box[0] / 1000) * 100}%`;
  const left = `${(box[1] / 1000) * 100}%`;
  const height = `${((box[2] - box[0]) / 1000) * 100}%`;
  const width = `${((box[3] - box[1]) / 1000) * 100}%`;

  const hasToolbar = !!onToggleDisplayMode || !!onToggleTextDirection || !!onResetPosition || !!onDelete;

  return (
    <div
      ref={wrapperRef}
      className="absolute flex flex-col items-center justify-center pointer-events-auto outline outline-2 outline-indigo-500 bg-indigo-500/20 z-50 cursor-move hover:bg-indigo-500/30 transition-colors group"
      style={{ top, left, height, width, containerType: 'size' as any }}
      onPointerDown={(e) => handlePointerDown(e, 'move')}
    >
      {children}

      {/* 기능 버튼을 한 줄로 모은 작은 툴바. 코너마다 따로 흩어놓지 않아 작은 말풍선에서도 덜 어수선함 */}
      {hasToolbar && (
        <div
          className="absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5 bg-gray-900/90 text-white rounded-full shadow-md px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {onToggleDisplayMode && (
            <ToolbarButton onClick={onToggleDisplayMode} title="표시 방식 전환: 덮기(원문을 흰 말풍선으로 덮음) ↔ 작게(원문은 그대로 두고 바깥에 작은 딱지)">
              {displayMode === 'tag' ? <Tag size={12} /> : <Square size={12} />}
            </ToolbarButton>
          )}
          {onToggleTextDirection && (
            <ToolbarButton onClick={onToggleTextDirection} title="글자 방향 전환: 가로쓰기 ↔ 세로쓰기 (홀쭉한 영역은 자동으로 세로쓰기)">
              {textDirection === 'vertical' ? <ArrowUpDown size={12} /> : <ArrowLeftRight size={12} />}
            </ToolbarButton>
          )}
          {onResetPosition && (
            <ToolbarButton onClick={onResetPosition} title="위치·크기를 자동 배치로 되돌리기">
              <Undo2 size={12} />
            </ToolbarButton>
          )}
          {onDelete && (
            <>
              {(onToggleDisplayMode || onToggleTextDirection || onResetPosition) && <div className="w-px h-3 bg-white/25 mx-0.5" />}
              <ToolbarButton onClick={onDelete} title="이 번역 삭제하기" danger>
                <Trash2 size={12} />
              </ToolbarButton>
            </>
          )}
        </div>
      )}

      {resizable && (
        <div
          className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-indigo-600 rounded-full cursor-se-resize shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-50 flex items-center justify-center"
          onPointerDown={(e) => handlePointerDown(e, 'resize')}
        >
          <div className="w-1.5 h-1.5 bg-white rounded-full pointer-events-none" />
        </div>
      )}
    </div>
  );
}
