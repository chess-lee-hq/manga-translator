import { BookOpen, ChevronDown, ChevronUp, History, Library, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { GlossaryCandidate } from '../lib/glossaryCandidates';
import { UNTITLED_KEY, type WorkIdentity } from '../lib/workIdentity';
import type { Glossary } from '../types';

export interface GlossaryDraft {
  original: string;
  translated: string;
}

interface GlossaryModalProps {
  /** 지금 작품의 단어장 (다른 작품에는 적용되지 않음) */
  glossary: Glossary;
  initialDraft: GlossaryDraft;
  /** 이 단어장이 속한 작품 */
  work: WorkIdentity;
  /** 한 번이라도 열었던 작품들 (다른 권을 같은 작품으로 연결할 때 고르는 후보) */
  knownWorks: { key: string; title: string }[];
  /** 작품 이름을 직접 지정. 빈 값이면 파일 이름으로 자동 판별 */
  onRenameWork: (title: string) => void;
  /** 작품별로 나누기 전 모든 작품이 함께 쓰던 단어장 중, 이 작품에 아직 없는 것 */
  legacyGlossary: Glossary;
  onImportLegacy: (entries: Glossary) => void;
  onClearLegacy: () => void;
  onMerge: (entries: Glossary) => void;
  onRemove: (original: string) => void;
  /** 번역 기록에서 찾은 추천 용어 */
  candidates: GlossaryCandidate[];
  onAcceptCandidate: (original: string, translated: string) => void;
  onDismissCandidate: (original: string) => void;
  onClose: () => void;
}

/** 이 단어장이 어느 작품 것인지, 어떻게 알아봤는지 보여 주고 작품 이름을 바꿀 수 있게 함 */
function WorkHeader({ work, knownWorks, onRenameWork }: Pick<GlossaryModalProps, 'work' | 'knownWorks' | 'onRenameWork'>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const untitled = work.key === UNTITLED_KEY;

  const startEdit = () => {
    setDraft(untitled ? '' : work.title);
    setEditing(true);
  };
  const apply = (title: string) => {
    onRenameWork(title);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="mb-4 rounded-lg border border-purple-200 bg-purple-50/50 p-3 text-sm">
        <div className="flex items-center gap-2">
          <Library size={16} className="text-purple-600 shrink-0" />
          <input
            list="glossary-known-works"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return; // 한글 조합 중 Enter는 무시
              if (e.key === 'Enter') apply(draft);
              if (e.key === 'Escape') setEditing(false);
            }}
            placeholder={work.autoTitle || '작품 이름 (예: 陽だまりの樹)'}
            autoFocus
            className="flex-1 min-w-0 px-2 py-1 border border-purple-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          <datalist id="glossary-known-works">
            {knownWorks.map(w => <option key={w.key} value={w.title} />)}
          </datalist>
          <button onClick={() => apply(draft)} className="px-3 py-1 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700">적용</button>
          <button onClick={() => setEditing(false)} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700">취소</button>
        </div>
        <p className="mt-2 text-xs text-gray-500 leading-relaxed">
          이미 연 작품 이름을 고르면 그 작품의 단어장·노트를 함께 씁니다. 새 이름을 적으면 지금 단어장을 그 이름으로 옮깁니다.
          {work.manual && work.autoTitle && (
            <> <button onClick={() => apply('')} className="text-purple-700 underline">파일 이름으로 자동 인식(「{work.autoTitle}」)으로 되돌리기</button></>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className={`mb-4 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${untitled ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium text-gray-800">
          <Library size={14} className={untitled ? 'text-amber-600' : 'text-purple-600'} />
          <span className="truncate">「{work.title}」 단어장</span>
        </div>
        <div className="text-xs text-gray-500 truncate" title={work.rawName}>
          {untitled
            ? '낱장 이미지라 제목을 알 수 없어요. 작품 이름을 붙이면 다른 작품과 섞이지 않습니다.'
            : work.manual
              ? `직접 지정한 작품 · 파일 "${work.rawName}"`
              : `파일 "${work.rawName}"에서 자동 인식 · 같은 작품의 다른 권도 이 단어장을 씁니다`}
        </div>
      </div>
      <button onClick={startEdit} className={`shrink-0 text-xs font-medium ${untitled ? 'text-amber-700 hover:text-amber-900' : 'text-purple-700 hover:text-purple-900'}`}>
        {untitled ? '작품 이름 붙이기' : '작품 변경'}
      </button>
    </div>
  );
}

/** 작품별로 나누기 전의 공통 단어장에서 이 작품에 맞는 것만 골라 가져옴 */
function LegacyGlossarySection({ legacyGlossary, onImportLegacy, onClearLegacy }: Pick<GlossaryModalProps, 'legacyGlossary' | 'onImportLegacy' | 'onClearLegacy'>) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(legacyGlossary);
  if (entries.length === 0) return null;

  return (
    <div className="mb-4 border border-amber-200 bg-amber-50/60 rounded-lg">
      <div className="flex items-center justify-between px-3 py-2">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
          <History size={14} /> 예전 공통 단어장 {entries.length}개
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <div className="flex items-center gap-3">
          <button onClick={() => onImportLegacy(legacyGlossary)} className="text-xs font-medium text-amber-800 hover:text-amber-950">모두 가져오기</button>
          <button onClick={onClearLegacy} className="text-xs text-gray-500 hover:text-red-600">지우기</button>
        </div>
      </div>
      <p className="px-3 pb-2 text-xs text-amber-700/90">업데이트 전 모든 작품이 함께 쓰던 단어장입니다. 이 작품에 맞는 것만 가져오세요.</p>
      {open && (
        <ul className="max-h-40 overflow-y-auto divide-y divide-amber-100 border-t border-amber-100">
          {entries.map(([original, translated]) => (
            <li key={original} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="font-medium text-gray-800 truncate max-w-[40%]" title={original}>{original}</span>
              <span className="text-gray-400">→</span>
              <span className="flex-1 min-w-0 truncate text-amber-800" title={translated}>{translated}</span>
              <button
                onClick={() => onImportLegacy({ [original]: translated })}
                title="이 작품 단어장에 추가"
                className="p-1 text-amber-700 hover:bg-amber-100 rounded"
              >
                <Plus size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GlossaryModal({
  glossary, initialDraft, work, knownWorks, onRenameWork, legacyGlossary, onImportLegacy, onClearLegacy,
  onMerge, onRemove, candidates, onAcceptCandidate, onDismissCandidate, onClose,
}: GlossaryModalProps) {
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

        <WorkHeader work={work} knownWorks={knownWorks} onRenameWork={onRenameWork} />

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

        <LegacyGlossarySection legacyGlossary={legacyGlossary} onImportLegacy={onImportLegacy} onClearLegacy={onClearLegacy} />

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
              <p>이 작품에 등록된 단어가 없습니다.</p>
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
          <span>{Object.keys(glossary).length}개 · 「{work.title}」에만 적용</span>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded font-medium hover:bg-gray-200">닫기</button>
        </div>
      </div>
    </div>
  );
}
