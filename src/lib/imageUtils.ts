import type { BoundingBox } from './yolo';

export interface GridCellInfo {
  id: number;
  box: BoundingBox;
}

export interface GridResult {
  dataUrl: string; // Base64 of the grid image
  cells: GridCellInfo[]; // Info to map grid cells back to original boxes
}

/** 박스에 딱 맞게 자르면 글자 획이 잘려 인식률이 떨어지므로 사방에 여백을 둠 */
const CROP_MARGIN_RATIO = 0.08;
const CELL_SIZE = 300;
const CELL_PADDING = 20;

/**
 * 말풍선들을 잘라 바둑판 이미지 한 장으로 붙입니다. (칸마다 빨간 번호를 적어 LLM이 순서대로 답하게 함)
 * 박스는 호출 전에 readingOrder로 정렬되어 있습니다.
 */
export async function createGridImageFromBoxes(
  image: HTMLImageElement,
  boxes: BoundingBox[],
  gridWidth: number = 3,
): Promise<GridResult | null> {
  if (boxes.length === 0) return null;

  const cells: GridCellInfo[] = boxes.map((box, index) => ({ id: index + 1, box }));
  const rows = Math.ceil(cells.length / gridWidth);

  const canvas = document.createElement('canvas');
  canvas.width = gridWidth * CELL_SIZE;
  canvas.height = rows * CELL_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;

  cells.forEach((cell, i) => {
    const { box } = cell;
    const marginX = (box.xmax - box.xmin) * CROP_MARGIN_RATIO;
    const marginY = (box.ymax - box.ymin) * CROP_MARGIN_RATIO;
    const sx = Math.max(0, box.xmin - marginX);
    const sy = Math.max(0, box.ymin - marginY);
    const sw = Math.min(imageWidth, box.xmax + marginX) - sx;
    const sh = Math.min(imageHeight, box.ymax + marginY) - sy;
    if (!(sw > 0 && sh > 0)) return;

    const cellX = (i % gridWidth) * CELL_SIZE;
    const cellY = Math.floor(i / gridWidth) * CELL_SIZE;
    const inner = CELL_SIZE - CELL_PADDING * 2;
    const scale = Math.min(inner / sw, inner / sh);
    const drawW = sw * scale;
    const drawH = sh * scale;

    ctx.drawImage(image, sx, sy, sw, sh, cellX + (CELL_SIZE - drawW) / 2, cellY + (CELL_SIZE - drawH) / 2, drawW, drawH);

    ctx.fillStyle = 'red';
    ctx.font = 'bold 24px Arial';
    ctx.fillText(`#${cell.id}`, cellX + 10, cellY + 30);
  });

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.8), cells };
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
