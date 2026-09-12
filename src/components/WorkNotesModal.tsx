import { Loader2, NotebookPen, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import type { WorkNotes } from '../lib/workNotes';

interface WorkNotesModalProps {
  workName: string;
  notes: WorkNotes | null;
  /** 노트를 만들 때 참고할 수 있는, 이미 번역된 대사 수 */
  recentPairCount: number;
  isRegenerating: boolean;
  canRegenerate: boolean;
  autoUpdate: boolean;
  contextFirst: boolean;
  onSave: (text: string) => void;
  onRegenerate: () => void;
  onToggleAutoUpdate: () => void;
  onToggleContextFirst: () => void;
  onClose: () => void;
}

export function WorkNotesModal({
  workName, notes, recentPairCount, isRegenerating, canRegenerate, autoUpdate, contextFirst,
  onSave, onRegenerate, onToggleAutoUpdate, onToggleContextFirst, onClose,
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
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 animate-in fade-in zoom-in duration-200 max-h-[85vh] flex flex-col">
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
          rows={12}
          placeholder={'예시)\n- 주인공(료): 거친 반말, 어미 "~다고", 상대를 "너"라고 부름\n- 스승: 정중한 존댓말, 주인공을 "료 군"이라고 부름\n- 고유명사: 雷神流 → 뇌신류'}
          className="flex-1 min-h-[200px] w-full p-3 text-sm text-gray-800 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none font-mono leading-relaxed"
        />

        <div className="mt-3 flex flex-col gap-2 text-xs text-gray-600">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={autoUpdate} onChange={onToggleAutoUpdate} className="accent-teal-600" />
            번역이 쌓이면 노트를 자동으로 갱신 (처음 3장, 이후 10장마다 · Gemini 요청 1회)
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={contextFirst} onChange={onToggleContextFirst} className="accent-teal-600" />
            문맥 우선 모드 — 한 장씩 순서대로 번역해 앞 내용을 최대한 반영 (느려지지만 일관성 최고)
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
