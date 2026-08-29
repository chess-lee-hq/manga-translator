import { useState, useRef, useEffect } from 'react';

interface BoxEditorProps {
  initialBox: [number, number, number, number];
  onChange: (newBox: [number, number, number, number]) => void;
  isKeepAll?: boolean;
  onToggleKeepAll?: () => void;
  children: React.ReactNode;
}

export function BoxEditor({ initialBox, onChange, isKeepAll = true, onToggleKeepAll, children }: BoxEditorProps) {
  const [box, setBox] = useState<[number, number, number, number]>(initialBox);
  const isDragging = useRef(false);
  const isResizing = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startBox = useRef([...initialBox] as [number, number, number, number]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBox(initialBox);
  }, [initialBox]);

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
    setBox(prev => {
      onChange(prev);
      return prev;
    });
  };

  const top = `${(box[0] / 1000) * 100}%`;
  const left = `${(box[1] / 1000) * 100}%`;
  const height = `${((box[2] - box[0]) / 1000) * 100}%`;
  const width = `${((box[3] - box[1]) / 1000) * 100}%`;

  return (
    <div
      ref={wrapperRef}
      className="absolute flex flex-col items-center justify-center pointer-events-auto outline outline-2 outline-indigo-500 bg-indigo-500/20 z-50 cursor-move hover:bg-indigo-500/30 transition-colors group"
      style={{ top, left, height, width, containerType: 'size' as any }}
      onPointerDown={(e) => handlePointerDown(e, 'move')}
    >
      {children}
      {onToggleKeepAll && (
        <button
          className="absolute -top-3 -right-3 px-1.5 py-0.5 bg-indigo-600 text-white text-[10px] font-bold rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-50 cursor-pointer"
          onPointerDown={(e) => {
            e.stopPropagation();
            onToggleKeepAll();
          }}
          title="단어 묶음(Keep-all) 해제 토글"
        >
          {isKeepAll ? '묶음' : '풀림'}
        </button>
      )}
      <div 
        className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-indigo-600 rounded-full cursor-se-resize shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-50 flex items-center justify-center"
        onPointerDown={(e) => handlePointerDown(e, 'resize')}
      >
        <div className="w-1.5 h-1.5 bg-white rounded-full pointer-events-none" />
      </div>
    </div>
  );
}
