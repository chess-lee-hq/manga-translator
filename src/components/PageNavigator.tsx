import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

interface PageNavigatorProps {
  currentPageIndex: number;
  totalPages: number;
  visibleCount: number;
  onPrev: () => void;
  onNext: () => void;
  onJumpToPage: (pageNumber: number) => void;
  isTranslating: boolean;
  /** 보이는 페이지 중 번역에 실패한 페이지의 오류 (덮어쓰기 모드에서도 보이도록) */
  failedMessage?: string;
  onRetryFailed?: () => void;
}

/** 일본 만화는 오른쪽→왼쪽으로 읽으므로 '다음 페이지'가 왼쪽에 있습니다. */
export function PageNavigator({
  currentPageIndex, totalPages, visibleCount, onPrev, onNext, onJumpToPage, isTranslating, failedMessage, onRetryFailed,
}: PageNavigatorProps) {
  return (
    <div className="bg-gray-100 border-t p-3 flex justify-between items-center shrink-0">
      <button
        onClick={onNext}
        disabled={currentPageIndex + visibleCount >= totalPages}
        className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-gray-700"
      >
        <ChevronLeft size={20} /> 다음 페이지
      </button>

      <div className="font-semibold text-gray-600 bg-white px-3 py-1.5 rounded-full border shadow-inner flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={totalPages}
          value={currentPageIndex + 1}
          onChange={(e) => {
            const val = parseInt(e.target.value);
            if (!isNaN(val) && val >= 1 && val <= totalPages) onJumpToPage(val);
          }}
          className="w-16 text-center border border-gray-300 rounded py-0.5 px-1 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm font-medium"
        />
        {visibleCount > 1 ? (
          <span>- {currentPageIndex + 2} / {totalPages}</span>
        ) : (
          <span>/ {totalPages}</span>
        )}
        {isTranslating && (
          <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
            <Loader2 size={12} className="animate-spin" /> 번역 중
          </span>
        )}
        {failedMessage !== undefined && onRetryFailed && (
          <button
            onClick={onRetryFailed}
            title={failedMessage}
            className="flex items-center gap-1 text-xs text-red-600 font-medium hover:underline"
          >
            <AlertTriangle size={12} /> 번역 실패 · 다시 시도
          </button>
        )}
      </div>

      <button
        onClick={onPrev}
        disabled={currentPageIndex === 0}
        className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-gray-700"
      >
        이전 페이지 <ChevronRight size={20} />
      </button>
    </div>
  );
}
