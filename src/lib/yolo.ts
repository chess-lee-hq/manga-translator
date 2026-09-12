import type { BoundingBox } from './yoloPostprocess';
import type { DetectRequest, DetectResponse } from './yolo.worker';

export type { BoundingBox };

const getModelUrl = () => new URL(`${import.meta.env.BASE_URL}manga109_yolo_s.onnx`, document.baseURI).href;

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, { resolve: (boxes: BoundingBox[]) => void; reject: (error: Error) => void }>();

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
      request.resolve(response.boxes);
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

export async function detectSpeechBubbles(image: HTMLImageElement, confThreshold = 0.25, iouThreshold = 0.45): Promise<BoundingBox[]> {
  const bitmap = await createImageBitmap(image);
  const target = getWorker();
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: DetectRequest = { id, bitmap, modelUrl: getModelUrl(), confThreshold, iouThreshold, detectInverted: true };
    target.postMessage(request, [bitmap]);
  });
}
