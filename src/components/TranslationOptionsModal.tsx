import { useState } from 'react';
import { Settings2, X } from 'lucide-react';
import { isSceneThumbnailEnabled, setSceneThumbnailEnabled } from '../lib/translationOptions';

interface TranslationOptionsModalProps {
  onClose: () => void;
}

function OptionRow({ checked, onChange, title, children }: { checked: boolean; onChange: (next: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5" />
      <span className="text-xs text-gray-600">
        <b className="block text-sm text-gray-800 mb-0.5">{title}</b>
        {children}
      </span>
    </label>
  );
}

/** 번역 요청 방식을 바꾸는 옵션들 (다음 번역 요청부터 적용) */
export function TranslationOptionsModal({ onClose }: TranslationOptionsModalProps) {
  const [scene, setScene] = useState(isSceneThumbnailEnabled);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-gray-700">
            <Settings2 size={22} />
            <h3 className="text-lg font-bold text-gray-800">번역 옵션</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="닫기">
            <X size={22} />
          </button>
        </div>

        <div className="space-y-2">
          <OptionRow
            checked={scene}
            onChange={next => { setSceneThumbnailEnabled(next); setScene(next); }}
            title="장면 이미지 함께 보내기 (실험)"
          >
            말풍선 격자와 함께 페이지 전체를 아주 작게 줄인 이미지를 보내, 표정·상황·누가 말하는지를 보고 말투를 정하게 합니다.
            페이지당 입력 토큰이 조금 늘어납니다 (OpenAI 약 85 · Gemini 약 258, 추정).
            <span className="block mt-1 text-gray-500">
              사용량 창에 "모델 · 장면" 줄로 따로 집계되니, 켰을 때와 껐을 때의 토큰과 번역 품질을 비교해 보세요.
            </span>
          </OptionRow>
        </div>
        <p className="text-[11px] text-gray-400 mt-3">다음 번역 요청부터 적용됩니다. 이미 번역된 페이지는 그대로입니다.</p>
      </div>
    </div>
  );
}
