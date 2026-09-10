import { FolderDown, Loader2, Upload } from 'lucide-react';

interface EmptyStateProps {
  isDragging: boolean;
  isRestoring: boolean;
  isDriveSyncing: boolean;
  onPickFiles: () => void;
  onLoadFromDrive: () => void;
}

export function EmptyState({ isDragging, isRestoring, isDriveSyncing, onPickFiles, onLoadFromDrive }: EmptyStateProps) {
  if (isRestoring) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-500">
        <Loader2 size={32} className="animate-spin text-blue-500" />
        <p className="text-sm">이전 작업을 확인하는 중...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6">
      <div
        className={`w-full max-w-2xl h-80 border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'
        }`}
        onClick={onPickFiles}
      >
        <Upload size={48} className="text-gray-400 mb-4" />
        <p className="text-lg font-medium text-gray-600">여러 장의 이미지를 드래그하여 업로드하세요</p>
        <p className="text-sm text-gray-400 mt-1">이전에 다운받은 .json 데이터 파일을 같이 올리면 즉시 복원됩니다.</p>
      </div>

      <div className="flex items-center gap-4 mt-4">
        <span className="text-gray-400 text-sm">또는</span>
        <button
          onClick={onLoadFromDrive}
          disabled={isDriveSyncing}
          className="flex items-center gap-2 px-6 py-3 bg-white border-2 border-blue-200 text-blue-600 rounded-xl hover:bg-blue-50 transition-colors font-medium shadow-sm disabled:opacity-50"
        >
          {isDriveSyncing ? <Loader2 size={20} className="animate-spin" /> : <FolderDown size={20} />}
          구글 드라이브에서 세이브 불러오기
        </button>
      </div>
    </div>
  );
}
