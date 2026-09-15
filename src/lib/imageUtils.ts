import { chooseGridColumns } from './gridLayout';
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
  dataUrl: string; // Base64 of the grid image
  cells: GridCellInfo[]; // Info to map grid cells back to original boxes
}

export interface GridImageOptions {
  /** 열 수. 없으면 칸 수에 맞춰 비전 토큰이 가장 적은 배치를 자동 선택 */
  columns?: number;
  /** 칸 한 변 크기(px). 기본 300 — 재요청은 작은 글자·한자 획을 살리려고 2배로 키움 */
  cellSize?: number;
  /** 기본 JPEG. PNG는 용량이 크지만 가는 획 주변 번짐이 없음 */
  format?: 'jpeg' | 'png';
}

/** 박스에 딱 맞게 자르면 글자 획이 잘려 인식률이 떨어지므로 사방에 여백을 둠 */
const CROP_MARGIN_RATIO = 0.08;
const CELL_SIZE = 300;
/** 칸 크기 대비 여백 비율 (300px 칸 기준 20px) */
const CELL_PADDING_RATIO = 20 / 300;

/**
 * 여러 페이지의 말풍선을 잘라 바둑판 이미지 한 장으로 붙입니다.
 * (칸마다 빨간 번호를 적어 모델이 순서대로 답하게 함)
 * 박스는 호출 전에 readingOrder로 정렬되어 있고, 페이지 순서대로 이어 붙입니다.
 * 열 수를 지정하지 않으면 칸 수에 맞춰 비전 토큰이 가장 적게 드는 배치를 자동으로 고릅니다.
 */
export async function createGridImage(sources: GridSource[], options: GridImageOptions = {}): Promise<GridResult | null> {
  const { cellSize = CELL_SIZE, format = 'jpeg' } = options;
  const labelScale = cellSize / CELL_SIZE;
  const entries = sources.flatMap(source => source.boxes.map((box, boxIndex) => ({ box, source, speaker: source.speakers?.[boxIndex] ?? null })));
  if (entries.length === 0) return null;

  const cells: GridCellInfo[] = entries.map((entry, index) => ({ id: index + 1, box: entry.box, pageId: entry.source.pageId, speaker: entry.speaker }));
  const columns = options.columns ?? chooseGridColumns(cells.length, cellSize);
  const rows = Math.ceil(cells.length / columns);

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
    ctx.fillText(`#${cells[i].id}`, cellX + 10 * labelScale, cellY + 30 * labelScale);
  });

  return { dataUrl: format === 'png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.8), cells };
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
