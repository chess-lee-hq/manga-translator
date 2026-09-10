import { Cloud } from 'lucide-react';
import { useState } from 'react';
import { stripArchiveExtension } from '../lib/fileImport';
import type { DriveFile } from '../hooks/useDriveSync';

interface DriveModalProps {
  files: DriveFile[];
  onSelect: (fileId: string, filename: string) => void;
  onClose: () => void;
}

export function DriveModal({ files, onSelect, onClose }: DriveModalProps) {
  const [query, setQuery] = useState('');
  const filtered = files.filter(f => f.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm transition-all">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center gap-3 text-blue-600 mb-4">
          <Cloud size={24} />
          <h3 className="text-lg font-bold text-gray-800">드라이브에서 불러오기</h3>
        </div>

        <div className="mb-4">
          <input
            type="text"
            placeholder="파일 이름 검색..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="max-h-60 overflow-y-auto mb-6 pr-2 border rounded-lg divide-y">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              {files.length === 0 ? '저장된 파일이 없습니다.' : '검색 결과가 없습니다.'}
            </div>
          ) : (
            filtered.map((file) => (
              <button
                key={file.id}
                onClick={() => onSelect(file.id, file.name)}
                className="w-full text-left p-3 hover:bg-blue-50 transition-colors flex flex-col gap-1"
              >
                <span className="font-medium text-gray-800">{stripArchiveExtension(file.name)}</span>
                <span className="text-xs text-gray-500">
                  {new Date(file.createdTime).toLocaleString('ko-KR')} · {(Number(file.size) / 1024 / 1024).toFixed(2)} MB
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
