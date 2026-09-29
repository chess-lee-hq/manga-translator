// 말풍선 검출 워커와 같은 CPU(WASM) 전용 빌드, 같은 CDN WASM
import * as ort from 'onnxruntime-web/wasm';
import { OCR_CACHE_NAME, OCR_MODEL_FILES } from './mangaOcrConfig';
import { decodeOcrTokens } from './mangaOcrText';

ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
ort.env.wasm.numThreads = 1;

const INPUT_SIZE = 224;
const DECODER_START_TOKEN = 2;
const EOS_TOKEN = 3;
/** 말풍선 한 개에 이보다 긴 글은 거의 없음 (반복 출력으로 끝나지 않는 경우를 막음) */
const MAX_TOKENS = 80;

export type OcrRequest =
  | { type: 'load' }
  | { type: 'recognize'; id: number; bitmaps: ImageBitmap[] };

export type OcrResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; fromCache: boolean }
  | { type: 'load-error'; error: string }
  | { type: 'result'; id: number; texts: string[]; elapsedMs: number }
  | { type: 'error'; id: number; error: string };

const ctx = self as unknown as Worker;

interface Loaded {
  encoder: ort.InferenceSession;
  decoder: ort.InferenceSession;
  vocab: string[];
}

let loading: Promise<Loaded> | null = null;

/** Cache Storage에 있으면 거기서, 없으면 받아서 보관. 받는 동안 전체 진행률을 알림 */
async function fetchAll(): Promise<{ buffers: ArrayBuffer[]; fromCache: boolean }> {
  const cache = await caches.open(OCR_CACHE_NAME);
  const urls = [OCR_MODEL_FILES.encoder, OCR_MODEL_FILES.decoder, OCR_MODEL_FILES.vocab];
  const cached = await Promise.all(urls.map(url => cache.match(url)));
  if (cached.every(Boolean)) {
    return { buffers: await Promise.all(cached.map(response => response!.arrayBuffer())), fromCache: true };
  }

  const responses = await Promise.all(urls.map(async url => {
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`모델 파일을 받지 못했습니다 (${response.status})`);
    return response;
  }));
  const total = responses.reduce((sum, response) => sum + Number(response.headers.get('content-length') || 0), 0);
  let loaded = 0;
  let lastReport = 0;
  const buffers = await Promise.all(responses.map(async response => {
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      const now = Date.now();
      if (now - lastReport > 200) {
        lastReport = now;
        ctx.postMessage({ type: 'progress', loaded, total } satisfies OcrResponse);
      }
    }
    const blob = new Blob(chunks as BlobPart[]);
    return blob.arrayBuffer();
  }));
  ctx.postMessage({ type: 'progress', loaded: total || loaded, total: total || loaded } satisfies OcrResponse);
  // 다 받은 뒤에만 보관 (중간에 끊기면 반쪽짜리가 남지 않게)
  await Promise.all(urls.map((url, i) => cache.put(url, new Response(buffers[i]))));
  return { buffers, fromCache: false };
}

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const { buffers: [encoderBuffer, decoderBuffer, vocabBuffer], fromCache } = await fetchAll();
    const [encoder, decoder] = await Promise.all([
      ort.InferenceSession.create(encoderBuffer, { executionProviders: ['wasm'] }),
      ort.InferenceSession.create(decoderBuffer, { executionProviders: ['wasm'] }),
    ]);
    const vocab = new TextDecoder().decode(vocabBuffer).split('\n').map(line => line.replace(/\r$/, ''));
    ctx.postMessage({ type: 'ready', fromCache } satisfies OcrResponse);
    return { encoder, decoder, vocab };
  })().catch(error => {
    loading = null;
    throw error;
  });
  return loading;
}

/** manga-ocr와 같은 전처리: 흑백 → 224×224로 늘려 맞춤(비율 무시) → (x - 0.5) / 0.5 */
function preprocess(bitmap: ImageBitmap): ort.Tensor {
  const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('OffscreenCanvas 2D 컨텍스트를 만들 수 없습니다.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const pixels = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  const area = INPUT_SIZE * INPUT_SIZE;
  const input = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    const gray = (0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2]) / 255;
    const value = (gray - 0.5) / 0.5;
    input[i] = value;
    input[area + i] = value;
    input[2 * area + i] = value;
  }
  return new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
}

/** 욕심쟁이(greedy) 디코딩: 매 단계 가장 그럴듯한 토큰 하나. (원본의 빔 서치보다 조금 덜 정확하지만 몇 배 빠름) */
async function recognize({ encoder, decoder, vocab }: Loaded, bitmap: ImageBitmap): Promise<string> {
  const { last_hidden_state: encoded } = await encoder.run({ pixel_values: preprocess(bitmap) });
  const ids = [DECODER_START_TOKEN];
  for (let step = 0; step < MAX_TOKENS; step++) {
    const inputIds = new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
    const { logits } = await decoder.run({ input_ids: inputIds, encoder_hidden_states: encoded });
    const vocabSize = logits.dims[2];
    const offset = (ids.length - 1) * vocabSize;
    const data = logits.data as Float32Array;
    let best = 0;
    for (let v = 1; v < vocabSize; v++) if (data[offset + v] > data[offset + best]) best = v;
    if (best === EOS_TOKEN) break;
    ids.push(best);
  }
  return decodeOcrTokens(ids, vocab);
}

ctx.onmessage = async (event: MessageEvent<OcrRequest>) => {
  const request = event.data;
  if (request.type === 'load') {
    try {
      await load();
    } catch (error) {
      ctx.postMessage({ type: 'load-error', error: (error as Error)?.message ?? String(error) } satisfies OcrResponse);
    }
    return;
  }

  const started = performance.now();
  try {
    const model = await load();
    const texts: string[] = [];
    for (const bitmap of request.bitmaps) {
      texts.push(await recognize(model, bitmap));
      bitmap.close();
    }
    ctx.postMessage({ type: 'result', id: request.id, texts, elapsedMs: Math.round(performance.now() - started) } satisfies OcrResponse);
  } catch (error) {
    request.bitmaps.forEach(bitmap => bitmap.close());
    ctx.postMessage({ type: 'error', id: request.id, error: (error as Error)?.message ?? String(error) } satisfies OcrResponse);
  }
};
