import * as ort from 'onnxruntime-web';

// Use jsDelivr CDN to load WASM files directly, avoiding Vite dev server MIME/import issues
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/';
ort.env.wasm.numThreads = 1;

let session: ort.InferenceSession | null = null;

export interface BoundingBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  confidence: number;
  classId: number;
}

export async function loadYoloModel() {
  if (session) return;
  try {
    const modelPath = import.meta.env.BASE_URL + 'manga109_yolo_s.onnx';
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['wasm']
    });
    console.log("YOLO model loaded successfully.");
  } catch (e) {
    console.error("Failed to load YOLO model:", e);
    throw e;
  }
}

/**
 * Run inference on an HTMLImageElement
 */
export async function detectSpeechBubbles(image: HTMLImageElement, confThreshold = 0.25, iouThreshold = 0.45): Promise<BoundingBox[]> {
  if (!session) {
    await loadYoloModel();
  }
  if (!session) throw new Error("YOLO model not loaded");

  const { tensor, xRatio, yRatio, padW, padH } = preprocessImage(image, 640);
  
  const feeds: Record<string, ort.Tensor> = {};
  feeds[session.inputNames[0]] = tensor;
  
  const results = await session.run(feeds);
  const output = results[session.outputNames[0]]; // Shape: [1, 6, 8400]
  
  return postprocess(output, xRatio, yRatio, padW, padH, confThreshold, iouThreshold);
}

function preprocessImage(image: HTMLImageElement, targetSize: number) {
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error("Could not get 2d context");

  // Calculate padding and scaling (Letterbox)
  const scale = Math.min(targetSize / image.width, targetSize / image.height);
  const newW = Math.round(image.width * scale);
  const newH = Math.round(image.height * scale);
  
  const padW = (targetSize - newW) / 2;
  const padH = (targetSize - newH) / 2;
  
  ctx.fillStyle = '#7f7f7f'; // Gray background
  ctx.fillRect(0, 0, targetSize, targetSize);
  ctx.drawImage(image, padW, padH, newW, newH);
  
  const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
  const pixels = imgData.data;

  // Convert to float32 tensor [1, 3, 640, 640]
  const float32Data = new Float32Array(3 * targetSize * targetSize);
  for (let i = 0; i < targetSize * targetSize; i++) {
    float32Data[i] = pixels[i * 4] / 255.0; // R
    float32Data[targetSize * targetSize + i] = pixels[i * 4 + 1] / 255.0; // G
    float32Data[2 * targetSize * targetSize + i] = pixels[i * 4 + 2] / 255.0; // B
  }

  const tensor = new ort.Tensor('float32', float32Data, [1, 3, targetSize, targetSize]);
  
  // Ratios to map coordinates back to original image
  const xRatio = image.width / newW;
  const yRatio = image.height / newH;
  
  return { tensor, xRatio, yRatio, padW, padH };
}

function postprocess(tensor: ort.Tensor, xRatio: number, yRatio: number, padW: number, padH: number, confThreshold: number, iouThreshold: number): BoundingBox[] {
  const dims = tensor.dims; // [1, 6, 8400]
  const data = tensor.data as Float32Array;
  
  const numRows = dims[1]; // 6
  const numCols = dims[2]; // 8400
  const numClasses = numRows - 4; // 2
  
  let boxes: BoundingBox[] = [];
  
  // YOLOv8 output is [1, 4+numClasses, 8400].
  for (let col = 0; col < numCols; col++) {
    // Find max class score
    let maxScore = 0;
    let classId = -1;
    for (let c = 0; c < numClasses; c++) {
      const score = data[(4 + c) * numCols + col];
      if (score > maxScore) {
        maxScore = score;
        classId = c;
      }
    }
    
    if (maxScore > confThreshold) {
      const cx = data[0 * numCols + col];
      const cy = data[1 * numCols + col];
      const w = data[2 * numCols + col];
      const h = data[3 * numCols + col];
      
      let xmin = cx - w / 2;
      let ymin = cy - h / 2;
      let xmax = cx + w / 2;
      let ymax = cy + h / 2;
      
      // Remove padding and scale to original image
      xmin = (xmin - padW) * xRatio;
      ymin = (ymin - padH) * yRatio;
      xmax = (xmax - padW) * xRatio;
      ymax = (ymax - padH) * yRatio;
      
      boxes.push({ xmin, ymin, xmax, ymax, confidence: maxScore, classId });
    }
  }
  
  return nonMaxSuppression(boxes, iouThreshold);
}

function nonMaxSuppression(boxes: BoundingBox[], iouThreshold: number): BoundingBox[] {
  boxes.sort((a, b) => b.confidence - a.confidence);
  const result: BoundingBox[] = [];
  
  for (const box of boxes) {
    let keep = true;
    for (const rBox of result) {
      if (box.classId !== rBox.classId) continue;
      const iou = calculateIoU(box, rBox);
      if (iou > iouThreshold) {
        keep = false;
        break;
      }
    }
    if (keep) result.push(box);
  }
  return result;
}

function calculateIoU(b1: BoundingBox, b2: BoundingBox): number {
  const xLeft = Math.max(b1.xmin, b2.xmin);
  const yTop = Math.max(b1.ymin, b2.ymin);
  const xRight = Math.min(b1.xmax, b2.xmax);
  const yBottom = Math.min(b1.ymax, b2.ymax);

  if (xRight < xLeft || yBottom < yTop) return 0;
  const intersection = (xRight - xLeft) * (yBottom - yTop);
  const area1 = (b1.xmax - b1.xmin) * (b1.ymax - b1.ymin);
  const area2 = (b2.xmax - b2.xmin) * (b2.ymax - b2.ymin);
  
  return intersection / (area1 + area2 - intersection);
}
