/**
 * 번역 옵션 (헤더의 "번역 옵션" 창). 번역 요청을 만들 때 그때그때 읽습니다.
 *
 * - 장면 이미지 함께 보내기(실험): 격자는 말풍선만 잘라 보내 모델이 표정·상황·누가 말하는지 모름 →
 *   페이지 전체를 아주 작게 줄인 이미지를 같이 보냄. 토큰이 늘어나는 만큼 효과가 있는지 시험 중이라,
 *   효과가 없으면 이 옵션과 lib/sceneThumbnail.ts만 걷어내면 됩니다. (사용량 창에서 "· 장면" 줄로 따로 집계)
 * - 로컬 OCR 교차 검증: 브라우저 안의 manga-ocr로 원문을 한 번 더 읽어 LLM이 읽은 원문과 크게 다르면 다시 읽힘
 */
const SCENE_KEY = 'manga-scene-thumbnail';
const LOCAL_OCR_KEY = 'manga-local-ocr';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? fallback : saved === 'true';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // 저장 못 하면 이번 세션만 반영
  }
}

/**
 * 덮어쓰기 글자 굵기: 보통(600, 기본) / 굵게(800, 예전 기본).
 * 화면·이미지 저장이 같은 값을 쓰고, 바꾸면 바로 다시 그리도록 구독할 수 있음
 */
const BOLD_TEXT_KEY = 'manga-overlay-bold';
export const OVERLAY_WEIGHT = { normal: 600, bold: 800 } as const;
const fontListeners = new Set<() => void>();
let fontVersion = 0;
export const isOverlayBold = () => readFlag(BOLD_TEXT_KEY, false);
export const overlayFontWeight = () => (isOverlayBold() ? OVERLAY_WEIGHT.bold : OVERLAY_WEIGHT.normal);
export function setOverlayBold(bold: boolean) {
  writeFlag(BOLD_TEXT_KEY, bold);
  fontVersion++;
  fontListeners.forEach(listener => listener());
}
export function subscribeOverlayFont(listener: () => void) {
  fontListeners.add(listener);
  return () => fontListeners.delete(listener);
}
export const getOverlayFontVersion = () => fontVersion;

/** 시험해 보려고 기본으로 켜 둠. 효과가 없으면 끄거나 기능째 걷어냄 */
export const isSceneThumbnailEnabled = () => readFlag(SCENE_KEY, true);
export const setSceneThumbnailEnabled = (enabled: boolean) => writeFlag(SCENE_KEY, enabled);

/** 모델을 처음 한 번 내려받아야 해서(약 120MB) 기본은 꺼 둠 */
export const isLocalOcrEnabled = () => readFlag(LOCAL_OCR_KEY, false);
export const setLocalOcrEnabled = (enabled: boolean) => writeFlag(LOCAL_OCR_KEY, enabled);
