import { BookOpen, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { GlossaryCandidate } from '../lib/glossaryCandidates';
import type { Glossary } from '../types';

export interface GlossaryDraft {
  original: string;
  translated: string;
}

interface GlossaryModalProps {
  glossary: Glossary;
  initialDraft: GlossaryDraft;
  documentName: string | null;
  onMerge: (entries: Glossary) => void;
  onRemove: (original: string) => void;
  /** 번역 기록에서 찾은 추천 용어 */
  candidates: GlossaryCandidate[];
  onAcceptCandidate: (original: string, translated: string) => void;
  onDismissCandidate: (original: string) => void;
  onClose: () => void;
}

export function GlossaryModal({ glossary, initialDraft, documentName, onMerge, onRemove, candidates, onAcceptCandidate, onDismissCandidate, onClose }: GlossaryModalProps) {
  const [form, setForm] = useState<GlossaryDraft>(initialDraft);
  // 추천 용어는 추가하기 전에 번역을 고칠 수 있게 입력값을 따로 들고 있음
  const [candidateEdits, setCandidateEdits] = useState<Record<string, string>>({});
  const translationOf = (c: GlossaryCandidate) => candidateEdits[c.original] ?? c.translated;
  const canAdd = !!form.original.trim() && !!form.translated.trim();

  const addEntry = () => {
    if (!canAdd) return;
    onMerge({ [form.original.trim()]: form.translated.trim() });
    setForm({ original: '', translated: '' });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm transition-all">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 animate-in fade-in zoom-in duration-200 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3 text-purple-600">
            <BookOpen size={24} />
            <h3 className="text-lg font-bold text-gray-800">단어장 (Translation Memory)</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <div className="flex gap-2 mb-6">
          <input
            type="text"
            placeholder="원문 (예: センゴク)"
            className="flex-1 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
            value={form.original}
            onChange={e => setForm({ ...form, original: e.target.value })}
          />
          <input
            type="text"
            placeholder="번역 (예: 전국)"
            className="flex-1 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
            value={form.translated}
            onChange={e => setForm({ ...form, translated: e.target.value })}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return; // 한글 조합 중 Enter는 무시
              if (e.key === 'Enter') addEntry();
            }}
          />
          <button
            onClick={addEntry}
            disabled={!canAdd}
            className="px-4 py-2 bg-purple-600 text-white rounded font-medium hover:bg-purple-700 disabled:opacity-50"
          >
            추가
          </button>
        </div>

        {candidates.length > 0 && (
          <div className="mb-4 border border-purple-200 bg-purple-50/50 rounded-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b border-purple-100">
              <div className="flex items-center gap-1.5 text-sm font-medium text-purple-800">
                <Sparkles size={14} /> 추천 용어 {candidates.length}개
                <span className="text-xs font-normal text-purple-600/80">— 번역 기록에 2번 이상 나온 고유명사</span>
              </div>
              <button
                onClick={() => candidates.forEach(c => { const t = translationOf(c).trim(); if (t) onAcceptCandidate(c.original, t); })}
                className="text-xs font-medium text-purple-700 hover:text-purple-900"
              >
                모두 추가
              </button>
            </div>
            <ul className="max-h-48 overflow-y-auto divide-y divide-purple-100">
              {candidates.map(c => (
                <li key={c.original} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-medium text-gray-800 shrink-0 max-w-[40%] truncate" title={c.original}>{c.original}</span>
                  <span className="text-gray-400">→</span>
                  <input
                    value={translationOf(c)}
                    onChange={e => setCandidateEdits(prev => ({ ...prev, [c.original]: e.target.value }))}
                    className="flex-1 min-w-0 px-2 py-1 border border-purple-200 rounded bg-white text-purple-700 font-bold focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                  <button
                    onClick={() => { const t = translationOf(c).trim(); if (t) onAcceptCandidate(c.original, t); }}
                    title="단어장에 추가"
                    className="p-1.5 text-purple-600 hover:bg-purple-100 rounded"
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    onClick={() => onDismissCandidate(c.original)}
                    title="무시 (다시 추천하지 않음)"
                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                  >
                    <X size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-[200px]">
          {Object.keys(glossary).length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <BookOpen size={32} className="mb-2 opacity-50" />
              <p>등록된 단어가 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(glossary).map(([original, translated]) => (
                <div key={original} className="flex items-center justify-between p-3 bg-gray-50 rounded border border-gray-100 hover:border-gray-200">
                  <div className="flex flex-col">
                    <span className="text-xs text-gray-500 font-mono">원문</span>
                    <span className="font-medium text-gray-800">{original}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-gray-500 font-mono">번역</span>
                      <span className="font-bold text-purple-600">{translated}</span>
                    </div>
                    <button
                      onClick={() => onRemove(original)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                      title="삭제"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500 flex justify-between items-center">
          <span>현재: {documentName || '새 문서'}</span>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded font-medium hover:bg-gray-200">닫기</button>
        </div>
      </div>
    </div>
  );
}
