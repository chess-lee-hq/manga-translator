import { AlertTriangle, BookOpen, Check, Edit2, GripVertical, Key, Loader2, MessageSquareText, RefreshCw, Trash2, X, ZapOff } from 'lucide-react';
import { useState } from 'react';
import { getCacheKey } from '../hooks/useTranslationCache';
import { resolveDisplayMode } from '../lib/bubbleDisplay';
import type { HoveredBubble, PageError, TranslationCache, UploadedImage, ViewMode } from '../types';

interface ScriptPanelProps {
  images: UploadedImage[];
  visibleIndices: number[];
  viewMode: ViewMode;
  translationCache: TranslationCache;
  translatingKeys: Set<string>;
  pageErrors: Record<string, PageError>;
  hasApiKey: boolean;
  providerLabel: string;
  autoTranslate: boolean;
  hoveredBubble: HoveredBubble | null;
  onHoverBubble: (bubble: HoveredBubble | null) => void;
  pendingBubbleIds: Set<string>;
  onSaveEdit: (key: string, id: string, text: string) => void;
  onDelete: (imgIndex: number, id: string) => void;
  onRetranslate: (imgIndex: number, id: string, originalText: string) => void;
  onAddToGlossary: (original: string, translated: string) => void;
  onReorder: (imgIndex: number, fromIndex: number, toIndex: number) => void;
  onToggleDisplayMode: (imgIndex: number, id: string) => void;
  onRetryPage: (imgIndex: number) => void;
  onTranslatePage: (imgIndex: number) => void;
  onResumeFromEmpty: (imgIndex: number) => void;
}

/** 요미가나 표기 `漢字(かんじ)`를 <ruby>로 표시 */
function renderFurigana(text: string) {
  if (!text) return null;
  const parts = text.split(/([一-龯]+)\(([ぁ-んァ-ヶ]+)\)/g);
  if (parts.length === 1) return text;

  const result = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      result.push(parts[i]);
    } else if (i % 3 === 1) {
      result.push(<ruby key={i}>{parts[i]}<rt className="text-[8px] opacity-75">{parts[i + 1]}</rt></ruby>);
      i++;
    }
  }
  return result;
}

export function ScriptPanel({
  images, visibleIndices, viewMode, translationCache, translatingKeys, pageErrors, hasApiKey, providerLabel, autoTranslate,
  hoveredBubble, onHoverBubble, pendingBubbleIds, onSaveEdit, onDelete, onRetranslate, onAddToGlossary, onReorder, onToggleDisplayMode,
  onRetryPage, onTranslatePage, onResumeFromEmpty,
}: ScriptPanelProps) {
  const [editingBubble, setEditingBubble] = useState<{ key: string; id: string } | null>(null);
  const [editingText, setEditingText] = useState('');
  const [draggedItem, setDraggedItem] = useState<{ imgIndex: number; itemIndex: number } | null>(null);

  const saveEdit = () => {
    if (!editingBubble) return;
    onSaveEdit(editingBubble.key, editingBubble.id, editingText);
    setEditingBubble(null);
  };

  // 2장 모드에서 말풍선 번호를 앞 페이지에 이어서 매기기 위한 페이지별 시작 번호
  const bubbleOffsets = visibleIndices.reduce<number[]>((offsets, _imgIndex, n) => {
    const prevResults = n === 0 ? undefined : translationCache[getCacheKey(images[visibleIndices[n - 1]].file)];
    offsets.push(n === 0 ? 0 : offsets[n - 1] + (prevResults?.length ?? 0));
    return offsets;
  }, []);

  return (
    <div className="w-[450px] shrink-0 flex flex-col h-full bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden transition-all duration-300">
      <div className="p-3 border-b border-gray-200 bg-gray-50 flex justify-between items-center shrink-0">
        <span className="font-semibold text-gray-700 flex items-center gap-2">
          <MessageSquareText size={18} /> 한국어 대본
        </span>
        {translatingKeys.size > 0 && (
          <div className="flex items-center text-sm text-blue-600 font-medium bg-blue-50 px-2 py-1 rounded-md border border-blue-100">
            <Loader2 className="animate-spin mr-2" size={16} />
            번역 중 ({translatingKeys.size}장)
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 bg-white space-y-4">
        {visibleIndices.map((imgIndex, n) => {
          const key = getCacheKey(images[imgIndex].file);
          const results = translationCache[key];
          const offset = bubbleOffsets[n];

          if (!results) {
            const pageError = pageErrors[key];
            return (
              <div key={`loading-${imgIndex}`} className="flex flex-col items-center justify-center py-10 px-4 text-center text-gray-400">
                {translatingKeys.has(key) ? (
                  <>
                    <Loader2 className="animate-spin mb-2" size={24} />
                    <span className="text-sm">Page {imgIndex + 1} 번역 중...</span>
                  </>
                ) : pageError ? (
                  <>
                    <AlertTriangle className="text-red-400 mb-2" size={24} />
                    <span className="text-sm text-red-500 font-medium">Page {imgIndex + 1} 번역 실패</span>
                    <span className="text-xs text-red-400 mt-1 break-all">{pageError.message}</span>
                    <button onClick={() => onRetryPage(imgIndex)} className="mt-3 px-3 py-1 bg-gray-100 rounded text-xs text-gray-600 hover:bg-gray-200">
                      다시 시도
                    </button>
                  </>
                ) : !hasApiKey ? (
                  <>
                    <Key className="mb-2" size={24} />
                    <span className="text-sm">상단에 {providerLabel} API 키를 입력하면 번역이 시작됩니다.</span>
                  </>
                ) : !autoTranslate ? (
                  <>
                    <ZapOff className="mb-2" size={24} />
                    <span className="text-sm">자동 번역이 꺼져 있습니다.</span>
                    <button onClick={() => onTranslatePage(imgIndex)} className="mt-3 px-3 py-1 bg-blue-50 text-blue-600 rounded text-xs font-medium hover:bg-blue-100">
                      이 페이지만 번역
                    </button>
                  </>
                ) : (
                  <>
                    <Loader2 className="animate-spin mb-2" size={24} />
                    <span className="text-sm">Page {imgIndex + 1} 번역 대기 중...</span>
                  </>
                )}
              </div>
            );
          }

          if (results.length === 0) {
            return (
              <div key={`empty-${imgIndex}`} className="py-8 flex flex-col items-center justify-center text-gray-400">
                <span className="text-sm mb-3">Page {imgIndex + 1}: 번역된 텍스트가 없습니다.</span>
                <button
                  onClick={() => onResumeFromEmpty(imgIndex)}
                  className="px-4 py-2 bg-blue-50 text-blue-600 rounded-md text-sm font-medium hover:bg-blue-100 transition-colors flex items-center gap-2"
                >
                  <RefreshCw size={14} /> 이어서 자동 번역 재개하기
                </button>
              </div>
            );
          }

          return (
            <div key={`script-group-${imgIndex}`} className="space-y-3">
              {visibleIndices.length > 1 && (
                <div className="pb-1 pt-1">
                  <span className="text-[11px] font-bold text-gray-400 px-1 uppercase tracking-wide">
                    Page {imgIndex + 1}
                    {viewMode === '2page' && imgIndex === visibleIndices[0] && ' (우측 먼저)'}
                  </span>
                </div>
              )}

              {results.map((result, bubbleIndex) => {
                const isHovered = hoveredBubble?.imageIndex === imgIndex && hoveredBubble?.bubbleIndex === bubbleIndex;
                const isDragged = draggedItem?.imgIndex === imgIndex && draggedItem?.itemIndex === bubbleIndex;
                const isPending = pendingBubbleIds.has(result.id);
                return (
                  <div
                    id={`script-${imgIndex}-${bubbleIndex}`}
                    key={result.id}
                    draggable
                    onDragStart={(e) => {
                      setDraggedItem({ imgIndex, itemIndex: bubbleIndex });
                      if (e.target instanceof HTMLElement) e.target.style.opacity = '0.5';
                    }}
                    onDragEnd={(e) => {
                      if (e.target instanceof HTMLElement) e.target.style.opacity = '1';
                      setDraggedItem(null);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedItem && draggedItem.imgIndex === imgIndex && draggedItem.itemIndex !== bubbleIndex) {
                        onReorder(imgIndex, draggedItem.itemIndex, bubbleIndex);
                      }
                      setDraggedItem(null);
                    }}
                    onMouseEnter={() => onHoverBubble({ imageIndex: imgIndex, bubbleIndex })}
                    onMouseLeave={() => onHoverBubble(null)}
                    className={`p-3 rounded-lg border transition-all duration-200 cursor-grab active:cursor-grabbing flex gap-3 ${
                      isHovered ? 'border-yellow-400 bg-yellow-50 shadow-md transform -translate-x-1' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                    } ${isDragged ? 'opacity-50 scale-95 border-dashed border-gray-400' : ''}`}
                  >
                    <div className={`flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-xs font-bold mt-0.5 transition-colors ${
                      isHovered ? 'bg-yellow-400 text-yellow-900 shadow-sm' : 'bg-gray-200 text-gray-600'
                    }`}>
                      {offset + bubbleIndex + 1}
                    </div>
                    <div className="flex flex-col flex-1">
                      {editingBubble?.id === result.id ? (
                        <div className="flex flex-col gap-2">
                          <textarea
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            className="w-full p-2 text-[15px] text-gray-800 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-blue-50/30"
                            rows={3}
                            autoFocus
                            onKeyDown={(e) => {
                              // 한글 IME 조합 중 Enter는 글자 확정용이므로 저장하지 않음
                              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                saveEdit();
                              } else if (e.key === 'Escape') {
                                setEditingBubble(null);
                              }
                            }}
                          />
                          <div className="flex justify-end gap-1 mt-1">
                            <button onClick={() => setEditingBubble(null)} className="p-1.5 hover:bg-gray-200 rounded-md text-gray-500 transition-colors" title="취소 (Esc)">
                              <X size={14} />
                            </button>
                            <button onClick={saveEdit} className="p-1.5 hover:bg-green-100 bg-green-50 text-green-600 rounded-md transition-colors" title="저장 (Enter)">
                              <Check size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-gray-800 font-medium leading-relaxed break-keep text-[15px]">
                            {result.translated_text}
                          </p>
                          {result.original_text && (
                            <p className="text-gray-400 text-[11px] mt-1.5 font-serif leading-snug tracking-wide">
                              {renderFurigana(result.original_text)}
                            </p>
                          )}
                        </>
                      )}

                      <div
                        className="flex items-center gap-1 text-gray-300 justify-end mt-2 opacity-50 hover:opacity-100 transition-opacity"
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        {resolveDisplayMode(result) === 'tag' && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onToggleDisplayMode(imgIndex, result.id);
                            }}
                            title="덮어쓰기 모드에서 원문(효과음 등)을 가리지 않고 바깥에 작은 딱지로 표시 중입니다. 클릭하면 덮기로 바꿉니다."
                            className="mr-auto px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                          >
                            작게 표시
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingBubble({ key, id: result.id });
                            setEditingText(result.translated_text);
                          }}
                          title="직접 번역 텍스트 수정하기"
                          className="p-1 hover:text-green-500 hover:bg-green-50 rounded transition-colors relative z-10"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onDelete(imgIndex, result.id);
                          }}
                          title="번역 삭제하기"
                          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors relative z-10"
                        >
                          <Trash2 size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onRetranslate(imgIndex, result.id, result.original_text);
                          }}
                          disabled={isPending}
                          title="이 문장만 다시 AI 재번역"
                          className="p-1 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 relative z-10"
                        >
                          <RefreshCw size={14} className={isPending ? 'animate-spin' : ''} />
                        </button>
                        <button
                          onClick={() => onAddToGlossary(result.original_text, result.translated_text)}
                          title="단어장에 추가 (부분 추출)"
                          className="p-1 hover:text-purple-500 hover:bg-purple-50 rounded transition-colors"
                        >
                          <BookOpen size={14} />
                        </button>
                        <div className="w-px h-3 bg-gray-200 mx-1"></div>
                        <GripVertical size={16} className="cursor-grab hover:text-gray-500" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
