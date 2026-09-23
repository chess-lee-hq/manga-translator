import { AlertTriangle, ArrowRight, Check, X } from 'lucide-react';

export interface ReviewItem {
  /** 0부터 시작하는 페이지 번호 */
  imgIndex: number;
  key: string;
  id: string;
  review: string;
  originalText: string;
  translatedText: string;
}

interface ReviewListModalProps {
  items: ReviewItem[];
  onJump: (imgIndex: number) => void;
  onDismiss: (key: string, id: string) => void;
  onClose: () => void;
}

/**
 * 검토 목록: 자동 재요청 뒤에도 확신할 수 없어 "검토" 표시가 남은 말풍선을 모아 보여줍니다.
 * 누르면 그 페이지로 이동하고, 확인했으면 표시를 지울 수 있습니다.
 */
export function ReviewListModal({ items, onJump, onDismiss, onClose }: ReviewListModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full p-6 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-amber-600">
            <AlertTriangle size={22} />
            <h3 className="text-lg font-bold text-gray-800">검토 목록 <span className="text-sm font-normal text-gray-500">{items.length}개</span></h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="닫기">
            <X size={22} />
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          자동으로 다시 읽어도 확신할 수 없었던 말풍선입니다. 페이지로 가서 대본의 원문 고치기·이미지에서 다시 읽기로 바로잡거나, 괜찮으면 확인을 눌러 표시를 지우세요.
        </p>

        {items.length === 0 ? (
          <p className="text-sm text-gray-500 py-8 text-center">검토할 말풍선이 없습니다.</p>
        ) : (
          <ul className="overflow-y-auto divide-y divide-gray-100 -mx-2">
            {items.map(item => (
              <li key={item.id} className="flex items-start gap-3 px-2 py-2.5 hover:bg-gray-50 rounded">
                <span className="shrink-0 text-xs font-bold text-gray-500 w-12 pt-0.5">{item.imgIndex + 1}쪽</span>
                <div className="flex-1 min-w-0">
                  <span className="inline-block mb-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">{item.review}</span>
                  <p className="text-sm text-gray-800 break-keep">{item.translatedText}</p>
                  <p className="text-[11px] text-gray-400 font-serif">{item.originalText}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => onJump(item.imgIndex)}
                    title="이 페이지로 이동"
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-gray-200 text-gray-600 hover:bg-gray-100"
                  >
                    <ArrowRight size={12} /> 이동
                  </button>
                  <button
                    onClick={() => onDismiss(item.key, item.id)}
                    title="확인했음 (표시 지우기)"
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-green-200 text-green-700 bg-green-50 hover:bg-green-100"
                  >
                    <Check size={12} /> 확인
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
