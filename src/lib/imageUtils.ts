import type { BoundingBox } from './yolo';

export interface GridCellInfo {
  id: number;
  box: BoundingBox;
}

export interface GridResult {
  dataUrl: string; // Base64 of the grid image
  cells: GridCellInfo[]; // Info to map grid cells back to original boxes
}

/**
 * Crops bounding boxes from the image and draws them onto a single grid canvas.
 * This ensures the LLM sees exactly the text to translate in an organized way.
 */
export async function createGridImageFromBoxes(
  image: HTMLImageElement,
  boxes: BoundingBox[],
  gridWidth: number = 3 // Number of columns in the grid
): Promise<GridResult | null> {
  if (boxes.length === 0) return null;

  // The boxes are already sorted by readingOrder.ts before being passed here
  const cells: GridCellInfo[] = boxes.map((box, index) => ({
    id: index + 1,
    box
  }));

  // Create a hidden canvas for cropping
  const cropCanvas = document.createElement('canvas');
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) return null;

  // Determine size of each grid cell. Let's make them uniform.
  // Standardize cell size to 300x300, resizing crops to fit inside
  const cellSize = 300;
  const padding = 20; // Padding inside cell for the number label

  const rows = Math.ceil(cells.length / gridWidth);
  
  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = gridWidth * cellSize;
  gridCanvas.height = rows * cellSize;
  
  const ctx = gridCanvas.getContext('2d');
  if (!ctx) return null;

  // Fill background with white
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, gridCanvas.width, gridCanvas.height);

  // Draw each crop into the grid
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const box = cell.box;
    
    const cropWidth = box.xmax - box.xmin;
    const cropHeight = box.ymax - box.ymin;
    
    // Draw crop to temp canvas
    cropCanvas.width = cropWidth;
    cropCanvas.height = cropHeight;
    cropCtx.clearRect(0, 0, cropWidth, cropHeight);
    cropCtx.drawImage(
      image,
      box.xmin, box.ymin, cropWidth, cropHeight,
      0, 0, cropWidth, cropHeight
    );

    // Calculate grid position
    const col = i % gridWidth;
    const row = Math.floor(i / gridWidth);
    
    const cellX = col * cellSize;
    const cellY = row * cellSize;
    
    // Calculate scale to fit inside cell with padding
    const innerSize = cellSize - padding * 2;
    const scale = Math.min(innerSize / cropWidth, innerSize / cropHeight);
    const drawW = cropWidth * scale;
    const drawH = cropHeight * scale;
    
    const drawX = cellX + (cellSize - drawW) / 2;
    const drawY = cellY + (cellSize - drawH) / 2;

    // Draw the scaled crop
    ctx.drawImage(cropCanvas, 0, 0, cropWidth, cropHeight, drawX, drawY, drawW, drawH);
    
    // Draw the ID label in the top-left of the cell
    ctx.fillStyle = 'red';
    ctx.font = 'bold 24px Arial';
    ctx.fillText(`#${cell.id}`, cellX + 10, cellY + 30);
  }

  // Convert to base64
  const dataUrl = gridCanvas.toDataURL('image/jpeg', 0.8);
  return { dataUrl, cells };
}
