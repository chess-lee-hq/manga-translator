import { planGridImages, type GridEngine, type GridImagePlan } from './gridLayout';
import type { BoundingBox } from './yolo';

export interface GridCellInfo {
  id: number;
  box: BoundingBox;
  /** 이 칸이 어느 페이지에서 잘려 왔는지 (여러 페이지를 한 격자에 묶을 때 되돌리기 위함) */
  pageId: string;
  /** 추정한 화자 키 (`페이지ID|컷:인물`, 모르면 null) */
  speaker?: string | null;
}

/** 격자에 넣을 페이지 하나 */
export interface GridSource {
  pageId: string;
  image: HTMLImageElement;
  boxes: BoundingBox[];
  /** boxes와 같은 순서의 화자 키 (없으면 화자 힌트 없음) */
  speakers?: (string | null)[];
}

export interface GridResult {
  /** 격자 이미지(data URL). 칸이 많으면 여러 장으로 나뉘지만 칸 번호는 장을 넘어 이어지고, 요청은 한 번에 보냄 */
  images: string[];
  cells: GridCellInfo[]; // Info to map grid cells back to original boxes
}

export interface GridImageOptions {
  /** 이미지 장별 칸 수·열 수. 없으면 엔진에 맞춰 자동으로 정함 (gridLayout.planGridImages) */
  plan?: GridImagePlan[];
  /** 자동 배치 기준 엔진 (OpenAI는 이미지를 줄여 읽고 Gemini는 덜 줄이므로 유리한 배치가 다름) */
  engine?: GridEngine;
  /** 칸 한 변 크기(px). 기본 300 — 재요청은 작은 글자·한자 획을 살리려고 2배로 키움 */
  cellSize?: number;
  /** 기본 JPEG. PNG는 용량이 크지만 가는 획 주변 번짐이 없음 */
  format?: 'jpeg' | 'png';
}

/** 박스에 딱 맞게 자르면 글자 획이 잘려 인식률이 떨어지므로 사방에 여백을 둠 */
const CROP_MARGIN_RATIO = 0.08;
const CELL_SIZE = 300;
/** 격자 JPEG 압축 품질 (토큰 비용과 무관 — imageUtils 하단 주석 참고) */
const JPEG_QUALITY = 0.92;
/** 칸 크기 대비 여백 비율 (300px 칸 기준 20px) */
const CELL_PADDING_RATIO = 20 / 300;

type GridEntry = { box: BoundingBox; source: GridSource };

function drawGridImage(entries: GridEntry[], firstId: number, columns: number, cellSize: number, format: 'jpeg' | 'png'): string | null {
  const labelScale = cellSize / CELL_SIZE;
  const rows = Math.ceil(entries.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = columns * cellSize;
  canvas.height = rows * cellSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  entries.forEach((entry, i) => {
    const { box } = entry;
    const image = entry.source.image;
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;

    const marginX = (box.xmax - box.xmin) * CROP_MARGIN_RATIO;
    const marginY = (box.ymax - box.ymin) * CROP_MARGIN_RATIO;
    const sx = Math.max(0, box.xmin - marginX);
    const sy = Math.max(0, box.ymin - marginY);
    const sw = Math.min(imageWidth, box.xmax + marginX) - sx;
    const sh = Math.min(imageHeight, box.ymax + marginY) - sy;
    if (!(sw > 0 && sh > 0)) return;

    const cellX = (i % columns) * cellSize;
    const cellY = Math.floor(i / columns) * cellSize;
    const inner = cellSize * (1 - CELL_PADDING_RATIO * 2);
    const scale = Math.min(inner / sw, inner / sh);
    const drawW = sw * scale;
    const drawH = sh * scale;

    ctx.drawImage(image, sx, sy, sw, sh, cellX + (cellSize - drawW) / 2, cellY + (cellSize - drawH) / 2, drawW, drawH);

    ctx.fillStyle = 'red';
    ctx.font = `bold ${Math.round(24 * labelScale)}px Arial`;
    ctx.fillText(`#${firstId + i}`, cellX + 10 * labelScale, cellY + 30 * labelScale);
  });

  // 비전 토큰은 이미지의 가로×세로로만 계산되고 파일 용량과 무관하므로, 압축 품질을 올려도 비용은 그대로다.
  // 작은 한자 획이 압축으로 뭉개지면 곧바로 품질 검사 재요청(비싼 경로)으로 이어지므로 넉넉하게 준다.
  return format === 'png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/**
 * 여러 페이지의 말풍선을 잘라 바둑판 이미지로 붙입니다.
 * (칸마다 빨간 번호를 적어 모델이 순서대로 답하게 함)
 * 박스는 호출 전에 readingOrder로 정렬되어 있고, 페이지 순서대로 이어 붙입니다.
 * 배치를 지정하지 않으면 칸 수에 맞춰 칸이 너무 작아지지 않으면서 비전 토큰이 가장 적게 드는 배치를 고릅니다.
 */
export async function createGridImage(sources: GridSource[], options: GridImageOptions = {}): Promise<GridResult | null> {
  const { cellSize = CELL_SIZE, format = 'jpeg', engine = 'openai' } = options;
  const entries: GridEntry[] = sources.flatMap(source => source.boxes.map(box => ({ box, source })));
  if (entries.length === 0) return null;

  const cells: GridCellInfo[] = sources.flatMap(source => source.boxes.map((box, boxIndex) => ({
    id: 0, box, pageId: source.pageId, speaker: source.speakers?.[boxIndex] ?? null,
  }))).map((cell, index) => ({ ...cell, id: index + 1 }));

  const plan = options.plan ?? planGridImages(entries.length, cellSize, engine);
  const images: string[] = [];
  let offset = 0;
  for (const { count, columns } of plan) {
    const slice = entries.slice(offset, offset + count);
    if (slice.length === 0) break;
    const dataUrl = drawGridImage(slice, offset + 1, Math.min(columns, slice.length), cellSize, format);
    if (!dataUrl) return null;
    images.push(dataUrl);
    offset += slice.length;
  }
  if (offset < entries.length) return null;
  return { images, cells };
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

export function readFileAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}
