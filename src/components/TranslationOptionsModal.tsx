import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2, Settings2, Trash2, X } from 'lucide-react';
import { deleteOcrModel, getOcrStatus, isOcrModelDownloaded, loadOcrModel, subscribeOcrStatus } from '../lib/mangaOcr';
import { OCR_MODEL_APPROX_MB } from '../lib/mangaOcrConfig';
import { isSceneThumbnailEnabled, setSceneThumbnailEnabled } from '../lib/translationOptions';

interface TranslationOptionsModalProps {
  /** 로컬 OCR 교차 검증을 켰는지 (App이 들고 있어야 켜자마자 검증이 시작됨) */
  localOcr: boolean;
  onLocalOcrChange: (enabled: boolean) => void;
  onClose: () => void;
}

const toMb = (bytes: number) => (bytes / 1024 / 1024).toFixed(0);

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
export function TranslationOptionsModal({ localOcr, onLocalOcrChange, onClose }: TranslationOptionsModalProps) {
  const [scene, setScene] = useState(isSceneThumbnailEnabled);
  const ocrStatus = useSyncExternalStore(subscribeOcrStatus, getOcrStatus);
  const [downloaded, setDownloaded] = useState<boolean | null>(null);

  useEffect(() => {
    isOcrModelDownloaded().then(setDownloaded);
  }, [ocrStatus.state]);

  const toggleOcr = (next: boolean) => {
    onLocalOcrChange(next);
    // 켜면 바로 모델을 받아 둠 (번역 중에 받기 시작하면 첫 검증이 늦어짐)
    if (next) loadOcrModel().catch(() => {});
  };

  const removeModel = async () => {
    if (!confirm('받아 둔 로컬 OCR 모델을 지울까요? (다시 켜면 다시 받습니다)')) return;
    onLocalOcrChange(false);
    await deleteOcrModel();
    setDownloaded(false);
  };

  const ocrStatusText = ocrStatus.state === 'loading'
    ? (ocrStatus.total > 0 ? `모델 받는 중 ${toMb(ocrStatus.loaded)} / ${toMb(ocrStatus.total)}MB` : '모델 준비 중..')
    : ocrStatus.state === 'ready' ? '준비됨'
    : ocrStatus.state === 'error' ? `모델을 불러오지 못했습니다: ${ocrStatus.error}`
    : downloaded ? '모델 받아 둠' : `모델을 아직 받지 않음 (켜면 약 ${OCR_MODEL_APPROX_MB}MB를 한 번 받음)`;

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

          <OptionRow checked={localOcr} onChange={toggleOcr} title="로컬 OCR 교차 검증">
            번역이 끝난 말풍선을 브라우저 안의 일본어 만화 전용 OCR(manga-ocr)로 한 번 더 읽어, AI가 읽은 원문과 절반 넘게 다르면
            "검토" 표시를 붙입니다. API 비용은 없고, 번역을 기다리게 하지 않도록 번역이 끝난 뒤 뒤에서 말풍선 하나에 1초 남짓씩 처리합니다.
            <span className={`flex items-center gap-1 mt-1 ${ocrStatus.state === 'error' ? 'text-red-600' : 'text-gray-500'}`}>
              {ocrStatus.state === 'loading' && <Loader2 size={11} className="animate-spin" />}
              {ocrStatusText}
            </span>
            {ocrStatus.state === 'loading' && ocrStatus.total > 0 && (
              <span className="block mt-1 h-1 rounded bg-gray-200 overflow-hidden">
                <span className="block h-full bg-indigo-500" style={{ width: `${Math.round((ocrStatus.loaded / ocrStatus.total) * 100)}%` }} />
              </span>
            )}
          </OptionRow>
          {downloaded && ocrStatus.state !== 'loading' && (
            <button onClick={removeModel} className="flex items-center gap-1 ml-auto text-[11px] text-gray-400 hover:text-red-600">
              <Trash2 size={11} /> 받아 둔 OCR 모델 지우기
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-3">다음 번역 요청부터 적용됩니다. 이미 번역된 페이지는 그대로입니다.</p>
      </div>
    </div>
  );
}
