import type { Box2d, TranslationResult, TranslationSettings, UploadedImage } from '../types';
import { translateGridImage, type GridTranslationResult, type RawTranslationResult } from './gemini';
import { createGridImage, loadImage, type GridCellInfo, type GridResult, type GridSource } from './imageUtils';
import { retranslateTextOpenAI, translateFullPageOpenAI, translateGridImageOpenAI } from './openai';
import { sortTextByReadingOrder } from './readingOrder';
import { assignSpeakers, buildSpeakerHint } from './speakerHints';
import { sanitizeResults } from './results';
import { RETRY_INSTRUCTION } from './translationPrompt';
import { applyQualityRetry, stripTypeTags, type QualityReport } from './translationQuality';
import { detectSpeechBubbles } from './yolo';
import type { BoundingBox } from './yoloPostprocess';

const base64Of = (dataUrl: string) => dataUrl.split(',')[1];
const mimeOf = (dataUrl: string) => dataUrl.slice(5, dataUrl.indexOf(';'));

/**
 * 말풍선 위치는 YOLO(브라우저 내부)가 찾고, 원문 인식·번역은 OpenAI가 담당하므로 OpenAI 키만 있으면 됩니다.
 * Gemini 키는 선택 사항으로, 있으면 품질 검사에 걸린 칸을 다시 읽는 데만 씁니다.
 */
function requireKeys(settings: TranslationSettings) {
  if (!settings.openaiKey) throw new Error('OpenAI API 키를 먼저 입력해주세요.');
}

function toBox2d(box: BoundingBox, width: number, height: number): Box2d {
  return [(box.ymin / height) * 1000, (box.xmin / width) * 1000, (box.ymax / height) * 1000, (box.xmax / width) * 1000];
}

/** 모델이 같은 칸 번호를 두 번 돌려주는 경우가 있어(중복 번역의 원인) 첫 번째 응답만 사용합니다. */
export function mapGridToResults(translations: GridTranslationResult[], cells: GridCellInfo[], width: number, height: number): RawTranslationResult[] {
  const used = new Set<number>();
  const results: RawTranslationResult[] = [];
  for (const t of translations) {
    if (used.has(t.id)) continue;
    const cell = cells.find(c => c.id === t.id);
    if (!cell) continue;
    used.add(t.id);
    results.push({ original_text: t.original_text, translated_text: t.translated_text, box_2d: toBox2d(cell.box, width, height) });
  }
  return results;
}

/** 여러 페이지를 묶은 격자의 응답을 페이지별로 나눠 담습니다. */
export function mapGridToPages(
  translations: GridTranslationResult[],
  cells: GridCellInfo[],
  sizeOf: (pageId: string) => { width: number; height: number },
): Map<string, RawTranslationResult[]> {
  const used = new Set<number>();
  const byPage = new Map<string, RawTranslationResult[]>();
  for (const t of translations) {
    if (used.has(t.id)) continue;
    const cell = cells.find(c => c.id === t.id);
    if (!cell) continue;
    used.add(t.id);
    const { width, height } = sizeOf(cell.pageId);
    const list = byPage.get(cell.pageId) ?? [];
    list.push({ original_text: t.original_text, translated_text: t.translated_text, box_2d: toBox2d(cell.box, width, height) });
    byPage.set(cell.pageId, list);
  }
  return byPage;
}

/** 펼침면은 오른쪽 페이지(가로 중심 ≥ 500) 텍스트를 먼저 읽도록 재정렬 */
function orderForSpread(results: TranslationResult[], isSpread: boolean): TranslationResult[] {
  if (!isSpread || results.length === 0) return results;
  const centerX = (r: TranslationResult) => (r.box_2d[1] + r.box_2d[3]) / 2;
  return [...results.filter(r => centerX(r) >= 500), ...results.filter(r => centerX(r) < 500)];
}

/** 한 페이지를 검출해 읽는 순서로 정렬한 말풍선과, 말풍선마다 추정한 화자 키를 돌려줍니다. */
async function detectPage(image: HTMLImageElement, pageId: string) {
  const detections = await detectSpeechBubbles(image);
  const boxes = sortTextByReadingOrder(detections);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const speakers = assignSpeakers(boxes, detections, width, height).map(s => (s ? `${pageId}|${s}` : null));
  const known = speakers.filter(Boolean).length;
  if (boxes.length > 0) {
    const faces = detections.filter(d => d.classId === 1).length;
    const bodies = detections.filter(d => d.classId === 0).length;
    console.debug(`[speaker] 말풍선 ${boxes.length}개 중 ${known}개 화자 추정 (얼굴 ${faces} · 몸 ${bodies})`);
  }
  return { boxes, speakers };
}

/** 격자 한 장을 번역 엔진에 보냅니다. */
type GridRequest = (grid: GridResult, pageCellCounts: number[] | undefined) => Promise<GridTranslationResult[]>;

/** 첫 요청: 고른 OpenAI 모델(기본 Terra)로 보냅니다. */
function firstRequesterFor(settings: TranslationSettings): GridRequest {
  const { openaiKey, openAiVersion, glossary, context } = settings;
  return (grid, pageCellCounts) =>
    translateGridImageOpenAI(openAiVersion, openaiKey, grid.dataUrl, grid.cells.length, glossary, context, {
      pageCellCounts,
      speakerHint: buildSpeakerHint(grid.cells),
    });
}

/**
 * 재요청은 칸을 2배 해상도로 키워 다시 그립니다. (작은 글씨·한자 획이 뭉개져 틀리게 읽는 경우 대비)
 * OpenAI는 이미지의 짧은 변을 768px로 줄여 읽으므로, 600px 칸을 한 줄로 세워 짧은 변이 600px을 넘지 않게 하고
 * 긴 변도 2048px 안에 들도록 한 장에 최대 3칸씩 나눠 보냅니다.
 */
export const RETRY_CELL_SIZE = 600;
export const RETRY_CELLS_PER_IMAGE = 3;

/**
 * 재요청 엔진: 같은 모델이 같은 글자를 또 잘못 읽지 않도록 **다른 눈**으로 읽힙니다.
 * Gemini 키가 있으면 Gemini, 없거나 Gemini 요청이 실패하면 OpenAI Sol(더 강한 모델)로 보냅니다.
 */
export function retryRequesterFor(settings: TranslationSettings): GridRequest {
  const { openaiKey, googleKey, geminiVersion, glossary } = settings;
  const context = `${settings.context ?? ''}${RETRY_INSTRUCTION}`;

  const viaSol: GridRequest = (grid, pageCellCounts) =>
    translateGridImageOpenAI('sol', openaiKey, grid.dataUrl, grid.cells.length, glossary, context, {
      pageCellCounts,
      label: '격자 재요청 (고해상도 · Sol)',
      speakerHint: buildSpeakerHint(grid.cells),
    });

  if (!googleKey) return viaSol;

  return async (grid, pageCellCounts) => {
    try {
      return await translateGridImage(googleKey, base64Of(grid.dataUrl), mimeOf(grid.dataUrl), grid.cells.length, geminiVersion, {
        pageCellCounts,
        glossary,
        context,
        label: '격자 재요청 (고해상도 · Gemini)',
        speakerHint: buildSpeakerHint(grid.cells),
      });
    } catch (error) {
      console.warn('Gemini 재요청 실패 — OpenAI Sol로 다시 시도합니다:', (error as Error)?.message ?? error);
      return viaSol(grid, pageCellCounts);
    }
  };
}

function logQualityReport(report: QualityReport) {
  const found = Object.values(report.issues).reduce((a, b) => a + (b ?? 0), 0);
  if (found === 0) return;
  const labels: Record<string, string> = { missing: '응답 누락', empty: '빈 번역', untranslated: '미번역', japanese_left: '일본어 남음' };
  const detail = Object.entries(report.issues).map(([k, v]) => `${labels[k]} ${v}`).join(', ');
  const outcome = report.retryFailed ? '재요청 실패, 첫 결과 유지' : `재요청 후 ${report.fixed}칸 해결`;
  console.info(`[quality] ${report.checked}칸 중 ${found}칸 문제(${detail}) → ${outcome}`);
}

/** 칸 목록(칸 번호 순)을 원래 페이지별로 다시 묶습니다. 페이지 순서 → 페이지 안 박스 순서가 유지됩니다. */
function regroupBySource(sources: GridSource[], cells: GridCellInfo[]): GridSource[] {
  return sources
    .map(source => {
      const picked = cells.filter(c => c.pageId === source.pageId);
      return { ...source, boxes: picked.map(c => c.box), speakers: picked.map(c => c.speaker ?? null) };
    })
    .filter(source => source.boxes.length > 0);
}

const countsOf = (list: GridSource[]) => (list.length > 1 ? list.map(s => s.boxes.length) : undefined);

/**
 * 문제 칸들을 고해상도 격자 여러 장(장당 최대 3칸)으로 나눠 동시에 보내고,
 * 응답의 칸 번호를 문제 칸 전체 기준(1번부터)으로 이어 붙입니다.
 */
async function requestHighResRetry(sources: GridSource[], failed: GridCellInfo[], request: GridRequest): Promise<GridTranslationResult[]> {
  const chunks: GridCellInfo[][] = [];
  for (let i = 0; i < failed.length; i += RETRY_CELLS_PER_IMAGE) chunks.push(failed.slice(i, i + RETRY_CELLS_PER_IMAGE));

  const responses = await Promise.all(chunks.map(async chunk => {
    const chunkSources = regroupBySource(sources, chunk);
    const grid = await createGridImage(chunkSources, { columns: 1, cellSize: RETRY_CELL_SIZE, format: 'png' });
    return grid ? request(grid, countsOf(chunkSources)) : [];
  }));
  return mergeChunkResponses(responses, chunks.map(chunk => chunk.length));
}

/** 나눠 보낸 격자들의 응답(각각 1번부터)을 하나로 이어 번호를 다시 매깁니다. 범위를 벗어난 번호는 버립니다. */
export function mergeChunkResponses(responses: GridTranslationResult[][], sizes: number[]): GridTranslationResult[] {
  let offset = 0;
  return responses.flatMap((translations, index) => {
    const size = sizes[index];
    const mapped = translations
      .filter(t => Number.isInteger(t.id) && t.id >= 1 && t.id <= size)
      .map(t => ({ ...t, id: t.id + offset }));
    offset += size;
    return mapped;
  });
}

/**
 * 말풍선들을 격자로 묶어 번역하고, 기계적으로 판정되는 실패 칸(빈 번역·일본어 남음·응답 누락)만
 * **2배 해상도 · 다른 엔진**으로 한 번 더 요청해 더 나은 결과로 합칩니다.
 */
async function translateGridWithQualityCheck(sources: GridSource[], settings: TranslationSettings) {
  const grid = await createGridImage(sources);
  if (!grid) return null;

  const first = await firstRequesterFor(settings)(grid, countsOf(sources));
  const { translations, report } = await applyQualityRetry(first, grid.cells, failed =>
    requestHighResRetry(sources, failed, retryRequesterFor(settings)),
  );
  logQualityReport(report);
  return { grid, translations };
}

/**
 * 한 페이지 번역: 말풍선 검출(YOLO) → 읽는 순서 정렬 → 말풍선 격자 이미지 → 번역 엔진 → 원래 좌표로 복원
 *
 * 격자 이미지 한 장으로 원문 인식·번역을 한 번에 처리하고, 실패한 칸만 고해상도로 다시 읽습니다.
 */
export async function translatePage(img: UploadedImage, settings: TranslationSettings): Promise<TranslationResult[]> {
  requireKeys(settings);
  const { openaiKey, openAiVersion, glossary, context } = settings;
  const imgElement = await loadImage(img.src);
  const { boxes: textBoxes, speakers } = await detectPage(imgElement, 'page');

  let rawResults: RawTranslationResult[];
  if (textBoxes.length === 0) {
    // 말풍선을 찾지 못하면 페이지 전체를 읽는 대체 경로 (좌표까지 모델이 추정하므로 정확도는 떨어짐)
    console.warn('말풍선을 찾지 못해 페이지 전체 인식으로 대체합니다.');
    rawResults = (await translateFullPageOpenAI(openAiVersion, openaiKey, img.src, glossary, context)).map(r => ({ ...r, translated_text: stripTypeTags(r.translated_text ?? '') }));
  } else {
    const checked = await translateGridWithQualityCheck(
      [{ pageId: 'page', image: imgElement, boxes: textBoxes, speakers }],
      settings,
    );
    if (!checked) return [];
    rawResults = mapGridToResults(checked.translations, checked.grid.cells, imgElement.width, imgElement.height);
  }

  const results = sanitizeResults(rawResults) ?? []; // 좌표가 깨진 응답 제거 + id 부여
  return orderForSpread(results, !!img.isSpread);
}

/** 여러 페이지를 한 번의 요청으로 번역할 때 쓰는 입력 */
export interface BatchPage {
  /** 호출한 쪽에서 페이지를 구분하는 값 (보통 캐시 키) */
  id: string;
  img: UploadedImage;
}

/**
 * 여러 페이지의 말풍선을 격자 한 장에 묶어 **요청 한 번**으로 번역합니다.
 * 프롬프트·단어장·맥락이 요청당 한 번만 들어가므로, 페이지 수만큼 나눠 보낼 때보다 토큰이 크게 줄어듭니다.
 */
export async function translatePageBatch(pages: BatchPage[], settings: TranslationSettings): Promise<Map<string, TranslationResult[]>> {
  requireKeys(settings);

  const prepared = await Promise.all(pages.map(async page => {
    const image = await loadImage(page.img.src);
    const { boxes, speakers } = await detectPage(image, page.id);
    return { page, image, boxes, speakers };
  }));

  const sources: GridSource[] = prepared.map(p => ({ pageId: p.page.id, image: p.image, boxes: p.boxes, speakers: p.speakers }));
  const sizeById = new Map(prepared.map(p => [p.page.id, { width: p.image.width, height: p.image.height }]));
  const spreadById = new Map(prepared.map(p => [p.page.id, !!p.page.img.isSpread]));

  // 대사를 하나도 못 찾은 페이지도 "번역 완료(0건)"로 남겨 다시 요청하지 않도록 빈 배열로 채워둠
  const byPage = new Map<string, TranslationResult[]>(pages.map(page => [page.id, []]));

  const checked = await translateGridWithQualityCheck(sources, settings);
  if (!checked) return byPage;

  const raw = mapGridToPages(checked.translations, checked.grid.cells, id => sizeById.get(id) ?? { width: 1, height: 1 });
  for (const [pageId, rawResults] of raw) {
    const results = sanitizeResults(rawResults) ?? [];
    byPage.set(pageId, orderForSpread(results, !!spreadById.get(pageId)));
  }
  return byPage;
}

/** 사용자가 직접 그린 영역 하나를 인식·번역합니다. */
export async function translateRegion(img: UploadedImage, box: Box2d, settings: TranslationSettings): Promise<{ originalText: string; translatedText: string }> {
  requireKeys(settings);
  const imgElement = await loadImage(img.src);
  const [ymin, xmin, ymax, xmax] = box.map((v, i) => (v / 1000) * (i % 2 === 0 ? img.height : img.width));

  const checked = await translateGridWithQualityCheck(
    [{ pageId: 'region', image: imgElement, boxes: [{ xmin, ymin, xmax, ymax, classId: 3, confidence: 1 }] }],
    settings,
  );
  if (!checked) throw new Error('크롭 실패');
  const [cell] = checked.translations;

  if (!cell) return { originalText: '...', translatedText: '' };
  return { originalText: cell.original_text || '...', translatedText: cell.translated_text };
}

/** 원문 한 문장만 다시 번역합니다. */
export async function retranslateText(originalText: string, settings: TranslationSettings): Promise<string> {
  requireKeys(settings);
  return retranslateTextOpenAI(settings.openAiVersion, settings.openaiKey, originalText, settings.glossary, settings.context);
}
