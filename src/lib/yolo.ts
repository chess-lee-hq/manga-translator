import type { BoundingBox } from './yoloPostprocess';
import type { DetectRequest, DetectResponse } from './yolo.worker';

export type { BoundingBox };

// 가중치를 float16으로 저장한 모델(43MB → 21.5MB). 실행 시 float32로 되돌려 계산하므로 검출 결과는 원본과 같음
// 변환 방법: scripts/convert_yolo_fp16_weights.py
const getModelUrl = () => new URL(`${import.meta.env.BASE_URL}manga109_yolo_s_fp16w.onnx`, document.baseURI).href;

let worker: Worker | null = null;
let nextRequestId = 1;
export interface DetectionResult {
  boxes: BoundingBox[];
  /** 페이지에서 어두운(글자·그림) 픽셀 비율. 빈 페이지 판정에 씀 — 완전히 흰 페이지는 0에 가까움 */
  darkRatio: number;
}

const pending = new Map<number, { resolve: (result: DetectionResult) => void; reject: (error: Error) => void }>();

/** 말풍선 검출(ONNX 추론)은 번역 중 화면이 끊기지 않도록 Web Worker에서 실행합니다. */
function getWorker(): Worker {
  if (worker) return worker;

  const created = new Worker(new URL('./yolo.worker.ts', import.meta.url), { type: 'module' });
  created.onmessage = (event: MessageEvent<DetectResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.ok) {
      console.debug(`[yolo] 박스 ${response.boxes.length}개 검출 (${response.elapsedMs}ms, 어두운 비율 ${response.darkRatio}${response.invertedPass ? ', 색 반전 재검출' : ''})`);
      request.resolve({ boxes: response.boxes, darkRatio: response.darkRatio });
    } else {
      request.reject(new Error(`말풍선 검출 실패: ${response.error}`));
    }
  };
  created.onerror = event => {
    const error = new Error(`말풍선 검출 워커 오류: ${event.message || '알 수 없는 오류'}`);
    pending.forEach(request => request.reject(error));
    pending.clear();
    created.terminate();
    if (worker === created) worker = null;
  };

  worker = created;
  return created;
}

export async function detectSpeechBubbles(image: HTMLImageElement, confThreshold = 0.25, iouThreshold = 0.45): Promise<DetectionResult> {
  const bitmap = await createImageBitmap(image);
  const target = getWorker();
  const id = nextRequestId++;
  return new Promise<DetectionResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: DetectRequest = { id, bitmap, modelUrl: getModelUrl(), confThreshold, iouThreshold, detectInverted: true };
    target.postMessage(request, [bitmap]);
  });
}
