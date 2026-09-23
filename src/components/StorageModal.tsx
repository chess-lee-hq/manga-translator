import { useEffect, useState } from 'react';
import { Database, Loader2, Trash2, X } from 'lucide-react';
import {
  clearAllTranslations, clearLegacyLocalStorage, deleteTranslations, legacyLocalStorageStats, summarizeTranslationsByWork,
  type WorkStorageSummary,
} from '../lib/translationStore';

interface StorageModalProps {
  /** 작품 키 → 이름 (workIdentity.listKnownWorks) */
  workTitles: Record<string, string>;
  currentWorkKey: string;
  /** 지운 번역 기록 키 (화면에서도 지우고, 지금 작품이면 자동 번역을 끔) */
  onDeleted: (keys: string[], includesCurrentWork: boolean) => void;
  onClose: () => void;
}

const formatBytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`);

/**
 * 저장소 관리: 번역 기록을 작품별로 보고 지웁니다. (예전 "기록 삭제"는 모든 작품을 한꺼번에 지웠음)
 * localStorage에 남은 예전 기록(IndexedDB로 복사를 마친 원본)도 여기서 정리합니다.
 */
export function StorageModal({ workTitles, currentWorkKey, onDeleted, onClose }: StorageModalProps) {
  const [works, setWorks] = useState<WorkStorageSummary[] | null>(null);
  const [legacy, setLegacy] = useState(legacyLocalStorageStats);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    summarizeTranslationsByWork().then(setWorks).catch(err => setError(`저장소를 읽지 못했습니다: ${err?.message ?? err}`));
    setLegacy(legacyLocalStorageStats());
  };
  useEffect(refresh, []);

  const titleOf = (workKey: string | null) => (workKey === null ? '작품 미지정 (예전 기록)' : workTitles[workKey] ?? workKey);

  const removeWork = async (summary: WorkStorageSummary) => {
    const isCurrent = summary.workKey === currentWorkKey;
    const warning = isCurrent ? '\n\n지금 열린 작품입니다. 다시 번역되며 요금이 나가는 것을 막기 위해 자동 번역이 꺼집니다.' : '';
    if (!confirm(`「${titleOf(summary.workKey)}」의 번역 기록 ${summary.pages}페이지를 영구적으로 삭제할까요?\n(단어장·작품 노트는 남습니다)${warning}`)) return;
    await deleteTranslations(summary.keys);
    // 작품 미지정 기록에는 지금 작품 페이지가 섞여 있을 수 있어 자동 번역을 끔
    onDeleted(summary.keys, isCurrent || summary.workKey === null);
    refresh();
  };

  const removeAll = async () => {
    if (!confirm('모든 작품의 번역 기록을 영구적으로 삭제할까요?\n(단어장·작품 노트는 남습니다. 삭제 직후 자동 번역이 꺼집니다)')) return;
    const keys = (works ?? []).flatMap(w => w.keys);
    await clearAllTranslations();
    onDeleted(keys, true);
    refresh();
  };

  const cleanLegacy = () => {
    if (!confirm(`localStorage에 남은 예전 번역 기록 ${legacy.pages}페이지를 지울까요?\n이미 새 저장소(IndexedDB)로 복사해 두었으므로 지금 버전에서는 사라지는 기록이 없습니다.\n(단, 예전 버전의 앱으로 되돌리면 그 버전에서는 번역 기록이 보이지 않습니다)`)) return;
    clearLegacyLocalStorage();
    refresh();
  };

  const total = (works ?? []).reduce((sum, w) => ({ pages: sum.pages + w.pages, bytes: sum.bytes + w.bytes }), { pages: 0, bytes: 0 });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-gray-700">
            <Database size={22} />
            <h3 className="text-lg font-bold text-gray-800">저장된 번역 기록</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="닫기">
            <X size={22} />
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {works === null ? (
          <div className="flex justify-center py-8 text-gray-400"><Loader2 className="animate-spin" /></div>
        ) : works.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">저장된 번역 기록이 없습니다.</p>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-2">모두 {total.pages}페이지 · 약 {formatBytes(total.bytes)}</p>
            <ul className="overflow-y-auto divide-y divide-gray-100 border rounded-lg mb-3">
              {works.map(work => (
                <li key={work.workKey ?? '__none'} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">
                      {titleOf(work.workKey)}
                      {work.workKey === currentWorkKey && <span className="ml-1.5 text-[10px] text-indigo-600 font-medium">지금 작품</span>}
                    </p>
                    <p className="text-[11px] text-gray-400">{work.pages}페이지 · {formatBytes(work.bytes)}</p>
                  </div>
                  <button
                    onClick={() => removeWork(work)}
                    title="이 작품의 번역 기록 삭제"
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-red-200 text-red-700 bg-red-50 hover:bg-red-100"
                  >
                    <Trash2 size={12} /> 삭제
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={removeAll} className="self-end text-xs text-red-600 hover:underline mb-3">모든 작품 기록 삭제</button>
          </>
        )}

        {legacy.pages > 0 && (
          <div className="p-3 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-600">
            <p className="mb-2">
              예전 저장소(localStorage)에 {legacy.pages}페이지 · 약 {formatBytes(legacy.bytes)}가 남아 있습니다.
              {legacy.migrated
                ? ' 새 저장소로 복사를 마친 원본이라 지워도 됩니다. (브라우저의 5MB 한도를 비워 단어장·노트 저장이 막히지 않게 함)'
                : ' 아직 새 저장소로 옮기는 중입니다.'}
            </p>
            {legacy.migrated && (
              <button onClick={cleanLegacy} className="px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100">예전 저장소 정리</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
