import { Loader2, NotebookPen, PenLine, RefreshCw, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { Correction } from '../lib/corrections';
import type { WorkNotes } from '../lib/workNotes';

interface WorkNotesModalProps {
  workName: string;
  notes: WorkNotes | null;
  /** 노트를 만들 때 참고할 수 있는, 이미 번역된 대사 수 */
  recentPairCount: number;
  isRegenerating: boolean;
  canRegenerate: boolean;
  autoUpdate: boolean;
  onSave: (text: string) => void;
  onRegenerate: () => void;
  onToggleAutoUpdate: () => void;
  /** 대본에서 직접 고친 번역 (최신이 앞) */
  corrections: Correction[];
  onRemoveCorrection: (original: string) => void;
  onClearCorrections: () => void;
  onClose: () => void;
}

export function WorkNotesModal({
  workName, notes, recentPairCount, isRegenerating, canRegenerate, autoUpdate,
  onSave, onRegenerate, onToggleAutoUpdate, corrections, onRemoveCorrection, onClearCorrections, onClose,
}: WorkNotesModalProps) {
  const [text, setText] = useState(notes?.text ?? '');
  const [syncedAt, setSyncedAt] = useState(notes?.updatedAt ?? '');

  // 자동 갱신으로 노트가 바뀌면 편집창에도 반영
  if ((notes?.updatedAt ?? '') !== syncedAt) {
    setSyncedAt(notes?.updatedAt ?? '');
    setText(notes?.text ?? '');
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm transition-all">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 animate-in fade-in zoom-in duration-200 max-h-[85vh] flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3 text-teal-600">
            <NotebookPen size={24} />
            <h3 className="text-lg font-bold text-gray-800">작품 노트 (말투·호칭 기억)</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <p className="text-xs text-gray-500 mb-4 leading-relaxed">
          여기에 적힌 내용은 다음 페이지를 번역할 때 프롬프트에 함께 전달됩니다. 앞 페이지의 대사도 자동으로 같이 참고하니,
          인물별 말투나 호칭처럼 계속 유지할 규칙을 적어두면 번역이 흔들리지 않습니다. 직접 수정해도 됩니다.
        </p>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={9}
          placeholder={'예시)\n- 주인공(료): 거친 반말, 어미 "~다고", 상대를 "너"라고 부름\n- 스승: 정중한 존댓말, 주인공을 "료 군"이라고 부름\n- 고유명사: 雷神流 → 뇌신류'}
          className="min-h-[160px] w-full p-3 text-sm text-gray-800 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none font-mono leading-relaxed"
        />

        <div className="mt-4 border border-gray-200 rounded-lg flex flex-col min-h-0">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 rounded-t-lg">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <PenLine size={14} className="text-teal-600" />
              내가 고친 번역 <span className="text-teal-700">{corrections.length}개</span>
              <span className="text-xs font-normal text-gray-500">— 최근 8개가 다음 번역에 예시로 들어갑니다</span>
            </div>
            {corrections.length > 0 && (
              <button
                onClick={() => { if (window.confirm('이 작품에서 고친 번역 기록을 모두 지울까요? (번역 결과는 그대로 남습니다)')) onClearCorrections(); }}
                className="text-xs text-gray-500 hover:text-red-600"
              >
                모두 지우기
              </button>
            )}
          </div>
          {corrections.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-400">
              오른쪽 대본에서 번역을 직접 고치면 여기에 쌓이고, 같은 실수를 반복하지 않도록 다음 번역에 반영됩니다.
            </p>
          ) : (
            <ul className="max-h-40 overflow-y-auto divide-y divide-gray-100">
              {corrections.map(c => (
                <li key={c.original} className="flex items-start gap-2 px-3 py-2 text-xs group">
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-500 truncate" title={c.original}>{c.original}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5">
                      <span className="text-gray-400 line-through">{c.before}</span>
                      <span className="text-gray-400">→</span>
                      <span className="text-teal-700 font-medium">{c.after}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => onRemoveCorrection(c.original)}
                    title="이 교정은 다음 번역에 반영하지 않기"
                    className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2 text-xs text-gray-600">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={autoUpdate} onChange={onToggleAutoUpdate} className="accent-teal-600" />
            번역이 쌓이면 노트를 자동으로 갱신 (처음 3장, 이후 10장마다 · 번역 엔진 요청 1회)
          </label>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500 truncate">
            {workName} · {notes?.updatedAt ? `마지막 갱신 ${new Date(notes.updatedAt).toLocaleString('ko-KR')}` : '아직 노트가 없습니다'}
            {` · 참고 가능한 대사 ${recentPairCount}줄`}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onRegenerate}
              disabled={!canRegenerate || isRegenerating}
              title={canRegenerate ? '지금까지 번역된 대사로 노트를 다시 정리합니다 (번역 엔진 요청 1회)' : 'API 키와 번역된 대사가 필요합니다'}
              className="flex items-center gap-1.5 px-3 py-2 bg-teal-50 text-teal-700 border border-teal-200 rounded-lg text-sm font-medium hover:bg-teal-100 disabled:opacity-50"
            >
              {isRegenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} AI로 다시 정리
            </button>
            <button
              onClick={() => { onSave(text); onClose(); }}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700"
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
