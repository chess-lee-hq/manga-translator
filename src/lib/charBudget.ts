import { BUBBLE_FIT, fitIntoShape, uniformFontTargets } from './bubbleLayout';
import { detectPageBubbleShapes, type PixelBox } from './bubbleShape';
import { VIEWER_CHROME_PX } from './overlayLayout';

/**
 * 번역 요청 전에 말풍선마다 "기준 글자 크기로 몇 글자까지 들어가는지"를 재서 AI에게 한도로 알려줍니다.
 * 정식 한국어판처럼 처음부터 말풍선에 맞는 길이로 번역하게 해, 글자를 줄이거나 넘치는 일을 줄이려는 것.
 *
 * 화면 배치와 같은 규칙(bubbleLayout.fitIntoShape: 가로 → 좌우 살짝 넘침 → 막대 말풍선은 세로 → …)과
 * 같은 기준 크기(uniformFontTargets)로 재므로, 한도 안의 번역은 화면에서도 기준 크기로 들어감.
 * 요청 횟수는 그대로이고 프롬프트에 칸마다 몇 글자가 붙는 정도.
 */

type Measure = (text: string, fontSize: number) => number;

/** 한도를 재는 글자 수 범위 */
const MIN_LIMIT = 2;
const MAX_LIMIT = 120;
/** 한국어 대사 흉내: 어절 평균 3글자 + 띄어쓰기 */
const SAMPLE_WORD = '가나다';

/** 공백 빼고 n글자인 흉내 대사 */
export function sampleSentence(n: number): string {
  const syllables = SAMPLE_WORD.repeat(Math.ceil(n / SAMPLE_WORD.length)).slice(0, n);
  return syllables.replace(new RegExp(`(.{${SAMPLE_WORD.length}})(?=.)`, 'g'), '$1 ');
}

/** 화면 배치를 흉내 낼 페이지 높이 (배율 100%의 뷰어) */
function referencePageHeight(): number {
  const viewport = typeof window !== 'undefined' ? window.innerHeight : 900;
  return Math.max(300, viewport - VIEWER_CHROME_PX);
}

/**
 * 글자 영역마다 공백 뺀 글자 수 한도. 말풍선 모양을 못 찾은 칸(말풍선 없는 글자·테두리 못 딴 칸)은 null (한도 없음).
 * @param boxes 원본 이미지 px
 */
export function estimateCharLimits(image: HTMLImageElement | HTMLCanvasElement, boxes: PixelBox[], measure: Measure): (number | null)[] {
  const width = image instanceof HTMLImageElement ? image.naturalWidth || image.width : image.width;
  const height = image instanceof HTMLImageElement ? image.naturalHeight || image.height : image.height;
  if (!width || !height || boxes.length === 0) return boxes.map(() => null);

  const items = boxes.map((box, i) => ({
    id: String(i),
    box_2d: [(box.ymin / height) * 1000, (box.xmin / width) * 1000, (box.ymax / height) * 1000, (box.xmax / width) * 1000] as [number, number, number, number],
  }));
  const detections = detectPageBubbleShapes(image, items);
  const pageHeight = referencePageHeight();
  const pageWidth = (pageHeight * width) / height;
  const minFont = BUBBLE_FIT.minFontPx;
  const targets = uniformFontTargets(items.map(item => ({ id: item.id, glyph: detections[item.id]?.glyph })), pageHeight, minFont, BUBBLE_FIT.maxEmphasisPx);

  return items.map(item => {
    const shape = detections[item.id]?.shape;
    if (!shape) return null;
    const font = targets.get(item.id) ?? BUBBLE_FIT.maxFontPx;
    // 기준 크기 그대로(줄이지 않고) 넘침 없이 들어가는 가장 긴 글
    const fits = (n: number) => {
      const fit = fitIntoShape(sampleSentence(n), shape, pageWidth, pageHeight, measure, font, font);
      return !!fit && !fit.layout.overflow;
    };
    if (!fits(MIN_LIMIT)) return MIN_LIMIT;
    let low = MIN_LIMIT;
    let high = MAX_LIMIT;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (fits(mid)) low = mid;
      else high = mid - 1;
    }
    return low;
  });
}

/**
 * 이어진 말풍선을 나눈 칸끼리 알려 줌 — 칸마다 따로 번역하되 한 사람이 이어서 하는 말이라 문장이 자연스럽게 이어지게
 * (나눈 칸은 box.joinGroup이 같음, bubbleShape.splitTextBoxesByBubble)
 */
export function buildJoinHint(cells: { id: number; box: { joinGroup?: number } }[]): string {
  const groups = new Map<number, number[]>();
  for (const cell of cells) {
    const g = cell.box.joinGroup;
    if (g === undefined) continue;
    groups.set(g, [...(groups.get(g) ?? []), cell.id]);
  }
  const lines = [...groups.values()].filter(ids => ids.length >= 2).map(ids => `- ${ids.map(id => `#${id}`).join(' → ')}`);
  if (lines.length === 0) return '';
  return `# 이어진 말풍선 (붙어 있는 말풍선을 칸마다 나눈 것 — 같은 사람이 이어서 하는 말)
${lines.join('\n')}
칸마다 그 칸의 원문만 번역해 따로 출력하되, 앞 칸에서 이어지는 말이니 순서대로 읽었을 때 한 문장처럼 자연스럽게 이어지게 해. 한 칸에 몰아 쓰거나 어떤 칸을 비워 두지 마 — 짧은 칸(「然らば」 같은 한마디)도 그 칸 원문의 뜻을 꼭 넣어.`;
}

/** 프롬프트에 붙일 칸별 글자 수 한도 (한도가 있는 칸만) */
export function buildLengthHint(cells: { id: number; charLimit?: number | null }[]): string {
  const limited = cells.filter((c): c is { id: number; charLimit: number } => typeof c.charLimit === 'number');
  if (limited.length === 0) return '';
  return `# 칸별 글자 수 (말풍선 크기로 잰 한도, 공백 제외)
${limited.map(c => `#${c.id} ${c.charLimit}자`).join(' · ')}
번역문을 이 글자 수 안에 들어가게 써. 뜻과 말투를 지키는 게 먼저라 꼭 필요하면 조금 넘어도 되지만, 한도의 1.3배는 넘기지 마.`;
}
