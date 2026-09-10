import * as ort from 'onnxruntime-web';
import { postprocess, type BoundingBox } from './yoloPostprocess';

// jsDelivr CDN에서 WASM을 받아 Vite 개발 서버의 MIME/import 문제를 피합니다. (기존 설정 유지)
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/';
ort.env.wasm.numThreads = 1;

export interface DetectRequest {
  id: number;
  bitmap: ImageBitmap;
  modelUrl: string;
  confThreshold: number;
  iouThreshold: number;
}

export type DetectResponse =
  | { id: number; ok: true; boxes: BoundingBox[]; elapsedMs: number }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as Worker;
const INPUT_SIZE = 640;
let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession(modelUrl: string) {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] }).catch(error => {
      sessionPromise = null; // 다음 요청에서 다시 로드
      throw error;
    });
  }
  return sessionPromise;
}

/** 640×640 레터박스 + [1, 3, 640, 640] float32 텐서 변환 */
function preprocess(bitmap: ImageBitmap, targetSize: number) {
  const canvas = new OffscreenCanvas(targetSize, targetSize);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('OffscreenCanvas 2D 컨텍스트를 만들 수 없습니다.');

  const scale = Math.min(targetSize / bitmap.width, targetSize / bitmap.height);
  const newW = Math.round(bitmap.width * scale);
  const newH = Math.round(bitmap.height * scale);
  const padW = (targetSize - newW) / 2;
  const padH = (targetSize - newH) / 2;

  context.fillStyle = '#7f7f7f';
  context.fillRect(0, 0, targetSize, targetSize);
  context.drawImage(bitmap, padW, padH, newW, newH);

  const pixels = context.getImageData(0, 0, targetSize, targetSize).data;
  const area = targetSize * targetSize;
  const input = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    input[i] = pixels[i * 4] / 255;
    input[area + i] = pixels[i * 4 + 1] / 255;
    input[2 * area + i] = pixels[i * 4 + 2] / 255;
  }

  return {
    tensor: new ort.Tensor('float32', input, [1, 3, targetSize, targetSize]),
    letterbox: { xRatio: bitmap.width / newW, yRatio: bitmap.height / newH, padW, padH },
  };
}

async function detect(request: DetectRequest): Promise<DetectResponse> {
  const started = performance.now();
  try {
    const session = await getSession(request.modelUrl);
    const { tensor, letterbox } = preprocess(request.bitmap, INPUT_SIZE);
    const outputs = await session.run({ [session.inputNames[0]]: tensor });
    const output = outputs[session.outputNames[0]];
    const boxes = postprocess(output.data as Float32Array, output.dims, letterbox, request.confThreshold, request.iouThreshold);
    return { id: request.id, ok: true, boxes, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    request.bitmap.close();
  }
}

// 세션은 동시에 run할 수 없으므로("Session already started") 요청을 도착 순서대로 하나씩 처리
let queue: Promise<void> = Promise.resolve();
ctx.onmessage = (event: MessageEvent<DetectRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    ctx.postMessage(await detect(request));
  });
};
