import { Download } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCacheKey } from '../hooks/useTranslationCache';
import { getDisplayBox } from '../lib/exportCanvas';
import type { Box2d, HoveredBubble, ScriptStyle, TranslationCache, UploadedImage, ViewMode } from '../types';
import { BoxEditor } from './BoxEditor';

interface MangaViewerProps {
  images: UploadedImage[];
  visibleIndices: number[];
  viewMode: ViewMode;
  scriptStyle: ScriptStyle;
  scale: number;
  onScaleChange: (updater: (scale: number) => number) => void;
  isEditingBoxes: boolean;
  translationCache: TranslationCache;
  hoveredBubble: HoveredBubble | null;
  onHoverBubble: (bubble: HoveredBubble | null) => void;
  onBoxChange: (imgIndex: number, id: string, box: Box2d) => void;
  onToggleKeepAll: (imgIndex: number, id: string) => void;
  onCreateBox: (imgIndex: number, box: Box2d) => void;
  onDownloadPage: (imgIndex: number) => void;
  footer: ReactNode;
}

interface DrawingBox {
  imgIndex: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

/** 포인터 위치를 페이지 기준 0~1000 좌표로 변환 */
function toPageCoords(e: React.PointerEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * 1000,
    y: ((e.clientY - rect.top) / rect.height) * 1000,
  };
}

export function MangaViewer({
  images, visibleIndices, viewMode, scriptStyle, scale, onScaleChange, isEditingBoxes, translationCache,
  hoveredBubble, onHoverBubble, onBoxChange, onToggleKeepAll, onCreateBox, onDownloadPage, footer,
}: MangaViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [drawingBox, setDrawingBox] = useState<DrawingBox | null>(null);

  // Ctrl/⌘ + 휠(트랙패드 핀치) 확대. React의 onWheel은 passive라 preventDefault가 안 돼 브라우저 화면까지 같이 확대됐음
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      onScaleChange(s => (e.deltaY < 0 ? Math.min(s + 0.1, 3.0) : Math.max(s - 0.1, 0.5)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handlePanStart = (e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    setIsPanning(true);
    panStart.current = {
      x: e.pageX - el.offsetLeft,
      y: e.pageY - el.offsetTop,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
  };

  const handlePanMove = (e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!isPanning || !el) return;
    e.preventDefault();
    const walkX = (e.pageX - el.offsetLeft - panStart.current.x) * 1.5;
    const walkY = (e.pageY - el.offsetTop - panStart.current.y) * 1.5;
    el.scrollLeft = panStart.current.scrollLeft - walkX;
    el.scrollTop = panStart.current.scrollTop - walkY;
  };

  const handlePanEnd = () => setIsPanning(false);

  return (
    <div className={`flex flex-col h-full bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden relative transition-all duration-300 ${scriptStyle === 'side' ? 'flex-1 min-w-0' : 'flex-1 w-full'}`}>
      <div
        ref={containerRef}
        className={`flex-1 overflow-auto bg-gray-800 ${isPanning ? 'cursor-grabbing' : 'cursor-grab'} [&::-webkit-scrollbar]:hidden`}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        onMouseDown={handlePanStart}
        onMouseMove={handlePanMove}
        onMouseUp={handlePanEnd}
        onMouseLeave={handlePanEnd}
      >
        <div className="min-w-full min-h-full flex flex-col" style={{ width: 'max-content', height: 'max-content' }}>
          <div className="flex-1 min-h-[3rem]"></div>
          <div className="flex flex-row">
            <div className="flex-1 min-w-[3rem]"></div>
            <div className={`flex ${viewMode === '2page' ? 'flex-row-reverse' : 'flex-row'} gap-4 transition-all duration-200`}>
              {visibleIndices.map((imgIndex) => {
                const img = images[imgIndex];
                const results = translationCache[getCacheKey(img.file)] || [];
                const isDrawingHere = drawingBox?.imgIndex === imgIndex;

                return (
                  <div key={imgIndex} className="relative shadow-2xl bg-white select-none flex-shrink-0 group">
                    <div id={`manga-page-${imgIndex}`} className="relative bg-white">
                      {isEditingBoxes && (
                        <div
                          className="absolute inset-0 z-40 cursor-crosshair"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const { x, y } = toPageCoords(e);
                            setDrawingBox({ imgIndex, startX: x, startY: y, currentX: x, currentY: y });
                          }}
                          onPointerMove={(e) => {
                            if (!isDrawingHere) return;
                            e.stopPropagation();
                            e.preventDefault();
                            const { x, y } = toPageCoords(e);
                            setDrawingBox(prev => (prev ? { ...prev, currentX: x, currentY: y } : null));
                          }}
                          onPointerUp={(e) => {
                            if (!drawingBox || !isDrawingHere) return;
                            e.stopPropagation();
                            e.preventDefault();
                            const { x: endX, y: endY } = toPageCoords(e);
                            const xmin = Math.min(drawingBox.startX, endX);
                            const xmax = Math.max(drawingBox.startX, endX);
                            const ymin = Math.min(drawingBox.startY, endY);
                            const ymax = Math.max(drawingBox.startY, endY);
                            setDrawingBox(null);
                            // 너무 작은 박스는 무시
                            if (xmax - xmin < 20 || ymax - ymin < 20) return;
                            onCreateBox(imgIndex, [ymin, xmin, ymax, xmax]);
                          }}
                          onPointerLeave={() => {
                            if (isDrawingHere) setDrawingBox(null);
                          }}
                        />
                      )}

                      {drawingBox && isDrawingHere && (
                        <div
                          className="absolute border-2 border-blue-500 bg-blue-500/20 z-50 pointer-events-none"
                          style={{
                            left: `${Math.min(drawingBox.startX, drawingBox.currentX) / 10}%`,
                            top: `${Math.min(drawingBox.startY, drawingBox.currentY) / 10}%`,
                            width: `${Math.abs(drawingBox.currentX - drawingBox.startX) / 10}%`,
                            height: `${Math.abs(drawingBox.currentY - drawingBox.startY) / 10}%`,
                          }}
                        />
                      )}

                      <img
                        src={img.src}
                        alt={`Manga Page ${imgIndex + 1}`}
                        className="block transition-all duration-200"
                        style={{ height: `calc((100vh - 250px) * ${scale})`, width: 'auto', objectFit: 'contain' }}
                        draggable={false}
                      />

                      {results.map((result, bubbleIndex) => {
                        const [top0, left0, bottom0, right0] = getDisplayBox(result);
                        const boxWidth = right0 - left0;
                        const boxHeight = bottom0 - top0;
                        const top = `${top0 / 10}%`;
                        const left = `${left0 / 10}%`;
                        const height = `${boxHeight / 10}%`;
                        const width = `${boxWidth / 10}%`;
                        const isHovered = hoveredBubble?.imageIndex === imgIndex && hoveredBubble?.bubbleIndex === bubbleIndex;

                        if (scriptStyle === 'overlay') {
                          // 박스 비율과 글자 수로 한 줄 글자 수·줄 수를 추정해 컨테이너 단위(cqi/cqh)로 글자 크기를 맞춤
                          const aspect = boxWidth / boxHeight;
                          const textLen = Math.max(1, result.translated_text.length);
                          const charsPerLine = Math.max(1, Math.sqrt(textLen * aspect));
                          const lines = Math.max(1, textLen / charsPerLine);
                          const maxCqi = (100 / charsPerLine) * 0.85;
                          const maxCqh = (100 / (lines * 1.15)) * 0.9;

                          const textContent = (
                            <span
                              className="bg-white text-gray-900 rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.15)] flex flex-col items-center justify-center"
                              style={{
                                fontSize: `clamp(${13 * scale}px, min(${maxCqi}cqi, ${maxCqh}cqh), ${28 * scale}px)`,
                                fontWeight: '800',
                                lineHeight: '1.15',
                                wordBreak: result.disable_keep_all ? 'break-all' : 'keep-all',
                                lineBreak: result.disable_keep_all ? 'anywhere' : 'auto',
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'break-word',
                                textAlign: 'center',
                                letterSpacing: '-0.02em',
                                minWidth: '100%',
                                maxWidth: '200%',
                                minHeight: '100%',
                                padding: '4px 8px',
                              }}
                            >
                              {result.translated_text}
                            </span>
                          );

                          if (isEditingBoxes) {
                            return (
                              <BoxEditor
                                key={result.id}
                                initialBox={[top0, left0, bottom0, right0]}
                                onChange={(newBox: Box2d) => onBoxChange(imgIndex, result.id, newBox)}
                                isKeepAll={!result.disable_keep_all}
                                onToggleKeepAll={() => onToggleKeepAll(imgIndex, result.id)}
                              >
                                {textContent}
                              </BoxEditor>
                            );
                          }

                          return (
                            <div
                              key={result.id}
                              className="absolute flex flex-col items-center justify-center pointer-events-auto"
                              style={{ top, left, height, width, containerType: 'size', zIndex: 20 }}
                            >
                              {textContent}
                            </div>
                          );
                        }

                        return (
                          <div
                            key={result.id}
                            onMouseEnter={() => onHoverBubble({ imageIndex: imgIndex, bubbleIndex })}
                            onMouseLeave={() => onHoverBubble(null)}
                            className={`absolute border-2 cursor-crosshair transition-all duration-200 rounded-sm pointer-events-auto ${
                              isHovered
                                ? 'border-yellow-400 bg-yellow-400/30 z-30 shadow-[0_0_20px_rgba(250,204,21,0.8)]'
                                : 'border-transparent bg-white/1 hover:border-blue-300 hover:bg-blue-300/20 z-20'
                            }`}
                            style={{ top, left, height, width }}
                          />
                        );
                      })}
                    </div>

                    <button
                      onClick={(e) => { e.stopPropagation(); onDownloadPage(imgIndex); }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="absolute top-4 right-4 bg-black bg-opacity-60 hover:bg-blue-600 text-white p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 flex items-center gap-2"
                      title="이 페이지를 번역이 입혀진 이미지로 다운로드"
                    >
                      <Download size={20} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex-1 min-w-[3rem]"></div>
          </div>
          <div className="flex-1 min-h-[3rem]"></div>
        </div>
      </div>

      {footer}
    </div>
  );
}
