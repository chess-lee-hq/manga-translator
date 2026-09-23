import { FilePlus2, FolderOpen, Layers, X } from 'lucide-react';

interface ImportChoiceModalProps {
  /** 지금 열려 있는 작품 이름 */
  currentTitle: string;
  currentPageCount: number;
  /** 새로 연 압축 파일 이름 */
  incomingName: string;
  incomingPageCount: number;
  /** 새 파일이 지금 작품과 같은 작품으로 인식되는지 (같으면 이어 붙이기를 권함) */
  sameWork: boolean;
  onReplace: () => void;
  onAppend: () => void;
  onCancel: () => void;
}

/**
 * 작업 중에 다른 압축 파일을 열었을 때 "새로 열기 / 뒤에 이어 붙이기"를 고릅니다.
 * (예전에는 묻지 않고 합친 뒤 파일 이름순으로 정렬해, 권마다 001.jpg로 시작하면 두 권이 번갈아 섞였음)
 */
export function ImportChoiceModal({
  currentTitle, currentPageCount, incomingName, incomingPageCount, sameWork, onReplace, onAppend, onCancel,
}: ImportChoiceModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-indigo-600">
            <Layers size={22} />
            <h3 className="text-lg font-bold text-gray-800">다른 파일을 열었습니다</h3>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600" title="취소">
            <X size={22} />
          </button>
        </div>

        <div className="text-sm text-gray-600 space-y-1 mb-5">
          <p>지금 작업: <b className="text-gray-800">「{currentTitle}」</b> {currentPageCount}장</p>
          <p>새 파일: <b className="text-gray-800">{incomingName}</b> {incomingPageCount}장</p>
          {sameWork && <p className="text-xs text-indigo-600 pt-1">같은 작품의 다른 권으로 보입니다. 이어 붙여서 계속 읽을 수 있습니다.</p>}
        </div>

        <div className="space-y-2">
          <button
            onClick={onReplace}
            className="w-full flex items-start gap-3 p-3 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-left"
          >
            <FolderOpen size={18} className="text-indigo-600 mt-0.5 shrink-0" />
            <span>
              <span className="block font-medium text-gray-800">새로 열기</span>
              <span className="block text-xs text-gray-500">지금 작업을 닫고 새 파일만 엽니다. 번역 기록·단어장은 그대로 남습니다.</span>
            </span>
          </button>
          <button
            onClick={onAppend}
            className="w-full flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 text-left"
          >
            <FilePlus2 size={18} className="text-gray-600 mt-0.5 shrink-0" />
            <span>
              <span className="block font-medium text-gray-800">뒤에 이어 붙이기</span>
              <span className="block text-xs text-gray-500">지금 {currentPageCount}장 뒤에 새 파일을 순서대로 붙입니다. 작품(단어장·노트)은 지금 작품을 계속 씁니다.</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
