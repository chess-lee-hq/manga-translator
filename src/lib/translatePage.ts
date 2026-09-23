import type { Box2d, OpenAiVersion, TranslationResult, TranslationSettings, UploadedImage } from '../types';
import { retranslateTextGemini, shortenTranslationGemini, translateGridImage, translateMangaImage, type GridTranslationResult, type RawTranslationResult } from './gemini';
import type { GridEngine } from './gridLayout';
import { createGridImage, loadImage, readFileAsDataURL, type GridCellInfo, type GridResult, type GridSource } from './imageUtils';
import { retranslateTextOpenAI, shortenTranslationOpenAI, translateFullPageOpenAI, translateGridImageOpenAI } from './openai';
import { sortTextByReadingOrder } from './readingOrder';
import { assignSpeakers, buildSpeakerHint } from './speakerHints';
import { normalizeEllipsis } from './ellipsis';
import { sanitizeResults } from './results';
import { applyQualityRetry, assessCell, REVIEW_LABELS, stripTypeTags, type QualityReport } from './translationQuality';
import { detectSpeechBubbles } from './yolo';
import type { BoundingBox } from './yoloPostprocess';

const base64Of = (dataUrl: string) => dataUrl.split(',')[1];
const mimeOf = (dataUrl: string) => dataUrl.slice(5, dataUrl.indexOf(';'));
const inlineImage = (dataUrl: string) => ({ data: base64Of(dataUrl), mimeType: mimeOf(dataUrl) });

/**
 * 말풍선 위치는 YOLO(브라우저 내부)가 찾고, 원문 인식·번역은 메인 엔진이 담당하므로 그 키만 있으면 됩니다.
 * 나머지 한 엔진의 키는 선택 사항으로, 있으면 품질 검사에 걸린 칸을 다시 읽는 데만 씁니다.
 */
function requireKeys(settings: TranslationSettings) {
  if (settings.mainEngine === 'gemini') {
    if (!settings.googleKey) throw new Error('Gemini API 키를 먼저 입력해주세요.');
    return;
  }
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
    results.push({ original_text: t.original_text, translated_text: t.translated_text, box_2d: toBox2d(cell.box, width, height), ...(t.review ? { review: t.review } : {}) });
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
    list.push({ original_text: t.original_text, translated_text: t.translated_text, box_2d: toBox2d(cell.box, width, height), ...(t.review ? { review: t.review } : {}) });
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
  const { boxes: detections, darkRatio } = await detectSpeechBubbles(image);
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
  return { boxes, speakers, darkRatio };
}

/**
 * 글자가 있을 수 없을 만큼 비어 있는 페이지(속표지 뒷면·여백 등)를 가르는 기준.
 * 말풍선을 못 찾으면 페이지 전체 인식으로 넘어가 요청 한 번(≈2천 토큰)이 그냥 나가므로,
 * "어두운 픽셀이 사실상 0"인 페이지만 요청 없이 건너뜁니다. (작은 글자 서너 자만 있어도 이 값을 넘습니다)
 */
const BLANK_PAGE_DARK_RATIO = 0.0015;

/** 격자(여러 장일 수 있음)를 요청 한 번으로 번역 엔진에 보냅니다. */
type GridRequest = (grid: GridResult, pageCellCounts: number[] | undefined) => Promise<GridTranslationResult[]>;

/** 프롬프트에 함께 싣는 맥락. 재요청이면 "직전 대사"는 빼서 비용을 줄입니다. */
interface GridPromptParts {
  glossary: TranslationSettings['glossary'];
  /** (B) 작품 노트 — 캐시가 걸리는 구간 */
  context?: string;
  /** (C) 직전 대사·내 교정 — 재요청에는 싣지 않음 */
  recentContext?: string;
  retry?: boolean;
  label?: string;
}

function viaOpenAiGrid(apiKey: string, version: OpenAiVersion, parts: GridPromptParts): GridRequest {
  return (grid, pageCellCounts) =>
    translateGridImageOpenAI(version, apiKey, grid.images, grid.cells.length, {
      ...parts,
      pageCellCounts,
      speakerHint: buildSpeakerHint(grid.cells),
    });
}

function viaGeminiGrid(apiKey: string, version: '3.6' | '3.8', parts: GridPromptParts): GridRequest {
  return (grid, pageCellCounts) =>
    translateGridImage(apiKey, grid.images.map(inlineImage), grid.cells.length, version, {
      ...parts,
      pageCellCounts,
      speakerHint: buildSpeakerHint(grid.cells),
    });
}

/** 첫 요청: 메인 엔진(고른 버전)으로 보냅니다. */
export function firstRequesterFor(settings: TranslationSettings): GridRequest {
  const { mainEngine, openaiKey, openAiVersion, googleKey, geminiVersion, glossary, context, recentContext } = settings;
  const parts: GridPromptParts = { glossary, context, recentContext };
  return mainEngine === 'gemini'
    ? viaGeminiGrid(googleKey, geminiVersion, parts)
    : viaOpenAiGrid(openaiKey, openAiVersion, parts);
}

/**
 * 재요청은 칸을 2배 해상도로 키워 다시 그립니다. (작은 글씨·한자 획이 뭉개져 틀리게 읽는 경우 대비)
 * OpenAI는 이미지의 짧은 변을 768px로 줄여 읽으므로, 600px 칸을 한 줄로 세워 짧은 변이 600px을 넘지 않게 하고
 * 긴 변도 2048px 안에 들도록 한 장에 최대 3칸씩 나눕니다. 나눈 이미지들은 요청 한 번에 함께 보냅니다.
 */
const RETRY_CELL_SIZE = 600;
const RETRY_CELLS_PER_IMAGE = 3;

/** 첫 요청 격자를 어느 엔진 기준으로 배치할지 (메인 엔진) */
const gridEngineOf = (settings: TranslationSettings): GridEngine => (settings.mainEngine === 'gemini' ? 'gemini' : 'openai');

/**
 * 재요청 엔진: 같은 모델이 같은 글자를 또 잘못 읽지 않도록 **메인이 아닌 쪽**으로 읽힙니다.
 * 그쪽 키가 있으면 그 엔진(고른 버전)으로, 없거나 실패하면 메인 엔진의 더 강한 모델로 보냅니다.
 */
export function retryRequesterFor(settings: TranslationSettings): GridRequest {
  const { mainEngine, openaiKey, openAiVersion, googleKey, geminiVersion, glossary, context } = settings;
  // 재요청의 목적은 "안 읽힌 글자를 다시 읽는 것"이라 직전 대사(recentContext)는 싣지 않습니다.
  // 고정 구간·단어장·작품 노트는 그대로 둬야 방금 보낸 첫 요청과 앞부분이 같아져 프롬프트 캐시가 걸립니다.
  const parts: GridPromptParts = { glossary, context, retry: true };

  if (mainEngine === 'gemini') {
    // 메인이 Gemini일 때, 보조 키가 없으면 Gemini 3.8(더 강한 모델)로 재시도
    const viaStrongerGemini = viaGeminiGrid(googleKey, '3.8', { ...parts, label: '격자 재요청 (고해상도 · 3.8 Flash)' });
    if (!openaiKey) return viaStrongerGemini;

    const viaOpenAi = viaOpenAiGrid(openaiKey, openAiVersion, { ...parts, label: '격자 재요청 (고해상도 · OpenAI)' });
    return async (grid, pageCellCounts) => {
      try {
        return await viaOpenAi(grid, pageCellCounts);
      } catch (error) {
        console.warn('OpenAI 재요청 실패 — Gemini 3.7로 다시 시도합니다:', (error as Error)?.message ?? error);
        return viaStrongerGemini(grid, pageCellCounts);
      }
    };
  }

  // 메인이 OpenAI일 때, 보조 키가 없으면 OpenAI 6 Sol(가장 강한 모델)로 재시도
  const viaSol = viaOpenAiGrid(openaiKey, 'sol', { ...parts, label: '격자 재요청 (고해상도 · 6 Sol)' });
  if (!googleKey) return viaSol;

  const viaGemini = viaGeminiGrid(googleKey, geminiVersion, { ...parts, label: '격자 재요청 (고해상도 · Gemini)' });
  return async (grid, pageCellCounts) => {
    try {
      return await viaGemini(grid, pageCellCounts);
    } catch (error) {
      console.warn('Gemini 재요청 실패 — OpenAI 6 Sol로 다시 시도합니다:', (error as Error)?.message ?? error);
      return viaSol(grid, pageCellCounts);
    }
  };
}

function logQualityReport(report: QualityReport) {
  const found = Object.values(report.issues).reduce((a, b) => a + (b ?? 0), 0);
  if (found === 0) return;
  const labels: Record<string, string> = { missing: '응답 누락', empty: '빈 번역', untranslated: '미번역', japanese_left: '일본어 남음', unsure: '원문 불확실' };
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

/** 재요청 격자 배치: 한 장에 최대 3칸씩 세로 한 줄 */
export function retryPlan(cellCount: number) {
  return Array.from({ length: Math.ceil(cellCount / RETRY_CELLS_PER_IMAGE) }, (_, i) => ({
    count: Math.min(RETRY_CELLS_PER_IMAGE, cellCount - i * RETRY_CELLS_PER_IMAGE),
    columns: 1,
  }));
}

/**
 * 문제 칸들을 고해상도 격자(장당 최대 3칸)로 그려 **요청 한 번**으로 보냅니다. 칸 번호는 문제 칸 전체 기준 1번부터.
 * (예전에는 장마다 따로 요청해 지침·단어장·작품 노트가 장 수만큼 반복됐음)
 */
async function requestHighResRetry(sources: GridSource[], failed: GridCellInfo[], request: GridRequest): Promise<GridTranslationResult[]> {
  const retrySources = regroupBySource(sources, failed);
  const grid = await createGridImage(retrySources, { plan: retryPlan(failed.length), cellSize: RETRY_CELL_SIZE, format: 'png' });
  if (!grid) return [];
  const translations = await request(grid, countsOf(retrySources));
  return translations.filter(t => Number.isInteger(t.id) && t.id >= 1 && t.id <= failed.length);
}

/**
 * 말풍선들을 격자로 묶어 번역하고, 기계적으로 판정되는 실패 칸(빈 번역·일본어 남음·응답 누락)만
 * **2배 해상도 · 다른 엔진**으로 한 번 더 요청해 더 나은 결과로 합칩니다.
 */
async function translateGridWithQualityCheck(sources: GridSource[], settings: TranslationSettings) {
  const grid = await createGridImage(sources, { engine: gridEngineOf(settings) });
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
/**
 * 말풍선을 하나도 찾지 못한 페이지 처리 (한 장씩 번역·묶음 번역 공통).
 * - 그림도 글자도 거의 없는 빈 페이지: API 요청 없이 "번역 0건"
 * - 그 밖(스크린톤 위 나레이션, 테두리 없는 대사 등 검출이 놓친 글자): 페이지 전체를 보여주고 읽는 대체 경로
 *   (좌표까지 모델이 추정하므로 격자 경로보다 정확도는 떨어짐)
 */
async function translatePageWithoutBubbles(img: UploadedImage, darkRatio: number, settings: TranslationSettings): Promise<TranslationResult[]> {
  if (darkRatio < BLANK_PAGE_DARK_RATIO) {
    console.info(`[skip] 글자가 없는 빈 페이지로 보고 번역 요청을 건너뜁니다 (어두운 비율 ${darkRatio}).`);
    return [];
  }
  console.warn('말풍선을 찾지 못해 페이지 전체 인식으로 대체합니다.');
  const { mainEngine, openaiKey, openAiVersion, googleKey, geminiVersion, glossary, context, recentContext } = settings;
  // 화면용 주소(img.src)는 blob: 주소라, API로 보낼 때만 파일을 base64로 읽음
  const pageDataUrl = await readFileAsDataURL(img.file);
  const fullPage = mainEngine === 'gemini'
    ? await translateMangaImage(googleKey, base64Of(pageDataUrl), img.mimeType, geminiVersion, { glossary, context, recentContext })
    : await translateFullPageOpenAI(openAiVersion, openaiKey, pageDataUrl, { glossary, context, recentContext });
  const raw = fullPage.map(r => ({ ...r, translated_text: stripTypeTags(r.translated_text ?? '') }));
  return orderForSpread(sanitizeResults(raw) ?? [], !!img.isSpread);
}

export async function translatePage(img: UploadedImage, settings: TranslationSettings): Promise<TranslationResult[]> {
  requireKeys(settings);
  const imgElement = await loadImage(img.src);
  const { boxes: textBoxes, speakers, darkRatio } = await detectPage(imgElement, 'page');
  if (textBoxes.length === 0) return translatePageWithoutBubbles(img, darkRatio, settings);

  const checked = await translateGridWithQualityCheck(
    [{ pageId: 'page', image: imgElement, boxes: textBoxes, speakers }],
    settings,
  );
  if (!checked) return [];
  const rawResults = mapGridToResults(checked.translations, checked.grid.cells, imgElement.width, imgElement.height);
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
    const { boxes, speakers, darkRatio } = await detectPage(image, page.id);
    return { page, image, boxes, speakers, darkRatio };
  }));

  const withBubbles = prepared.filter(p => p.boxes.length > 0);
  const withoutBubbles = prepared.filter(p => p.boxes.length === 0);
  const sources: GridSource[] = withBubbles.map(p => ({ pageId: p.page.id, image: p.image, boxes: p.boxes, speakers: p.speakers }));
  const sizeById = new Map(prepared.map(p => [p.page.id, { width: p.image.width, height: p.image.height }]));
  const spreadById = new Map(prepared.map(p => [p.page.id, !!p.page.img.isSpread]));

  // 결과가 없는 페이지도 "번역 완료(0건)"로 남겨 다시 요청하지 않도록 빈 배열로 채워둠
  const byPage = new Map<string, TranslationResult[]>(pages.map(page => [page.id, []]));

  // 말풍선을 못 찾은 페이지는 한 장씩 번역할 때와 똑같이 빈 페이지 판정 → 페이지 전체 인식으로 처리
  // (예전에는 여기서 바로 0건으로 확정돼, 미리 번역한 페이지의 나레이션·스크린톤 위 글자가 영영 번역되지 않았음)
  const [checked] = await Promise.all([
    sources.length > 0 ? translateGridWithQualityCheck(sources, settings) : Promise.resolve(null),
    ...withoutBubbles.map(async p => {
      byPage.set(p.page.id, await translatePageWithoutBubbles(p.page.img, p.darkRatio, settings));
    }),
  ]);
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
  return { originalText: cell.original_text || '...', translatedText: normalizeEllipsis(cell.translated_text) };
}

/**
 * 말풍선 하나를 이미지에서 **다시 읽습니다** (대본의 "이미지에서 다시 읽기").
 * 원문을 잘못 읽은 경우를 위한 것이라, 품질 검사 재요청과 같은 경로로 보냅니다:
 * 2배 해상도(600px) PNG · 메인이 아닌 엔진(없으면 메인의 더 강한 모델).
 */
export async function rereadBubble(
  img: UploadedImage,
  box: Box2d,
  settings: TranslationSettings,
): Promise<{ originalText: string; translatedText: string; review?: string }> {
  requireKeys(settings);
  const imgElement = await loadImage(img.src);
  const [ymin, xmin, ymax, xmax] = box.map((v, i) => (v / 1000) * (i % 2 === 0 ? img.height : img.width));
  const grid = await createGridImage(
    [{ pageId: 'reread', image: imgElement, boxes: [{ xmin, ymin, xmax, ymax, classId: 3, confidence: 1 }] }],
    { plan: retryPlan(1), cellSize: RETRY_CELL_SIZE, format: 'png' },
  );
  if (!grid) throw new Error('크롭 실패');

  const [cell] = await retryRequesterFor(settings)(grid, undefined);
  if (!cell || !cell.original_text?.trim()) throw new Error('글자를 읽지 못했습니다.');
  const cleaned = { ...cell, translated_text: stripTypeTags(cell.translated_text ?? '') };
  const issue = assessCell(cleaned);
  return {
    originalText: cleaned.original_text,
    translatedText: normalizeEllipsis(cleaned.translated_text),
    ...(issue ? { review: REVIEW_LABELS[issue] } : {}),
  };
}

/** 원문 한 문장만 다시 번역합니다. (메인 엔진이 처리) */
export async function retranslateText(originalText: string, settings: TranslationSettings): Promise<string> {
  requireKeys(settings);
  const promptOptions = { glossary: settings.glossary, context: settings.context, recentContext: settings.recentContext };
  const translated = settings.mainEngine === 'gemini'
    ? await retranslateTextGemini(settings.googleKey, originalText, settings.geminiVersion, promptOptions)
    : await retranslateTextOpenAI(settings.openAiVersion, settings.openaiKey, originalText, promptOptions);
  return normalizeEllipsis(translated);
}

/** 말풍선에 들어가도록 번역문을 maxChars자 안쪽으로 짧게 다시 번역합니다. (메인 엔진이 처리) */
export async function shortenTranslation(originalText: string, currentTranslation: string, maxChars: number, settings: TranslationSettings): Promise<string> {
  requireKeys(settings);
  const clamped = Math.max(1, maxChars);
  const promptOptions = { glossary: settings.glossary, context: settings.context, recentContext: settings.recentContext };
  const shortened = settings.mainEngine === 'gemini'
    ? await shortenTranslationGemini(settings.googleKey, settings.geminiVersion, originalText, currentTranslation, clamped, promptOptions)
    : await shortenTranslationOpenAI(settings.openAiVersion, settings.openaiKey, originalText, currentTranslation, clamped, promptOptions);
  return normalizeEllipsis(shortened);
}
