import type { Box2d, TranslationResult, TranslationSettings, UploadedImage } from '../types';
import { retranslateTextGemini, translateGridImage, translateMangaImage, type GridTranslationResult, type RawTranslationResult } from './gemini';
import { createGridImage, loadImage, type GridCellInfo, type GridResult, type GridSource } from './imageUtils';
import { retranslateTextOpenAI, translateFullPageOpenAI, translateGridImageOpenAI } from './openai';
import { sortTextByReadingOrder } from './readingOrder';
import { sanitizeResults } from './results';
import { RETRY_INSTRUCTION } from './translationPrompt';
import { applyQualityRetry, stripTypeTags, type QualityReport } from './translationQuality';
import { detectSpeechBubbles } from './yolo';
import type { BoundingBox } from './yoloPostprocess';

const base64Of = (dataUrl: string) => dataUrl.split(',')[1];

/**
 * 제공자별로 필요한 키만 확인합니다.
 * 두 엔진 모두 말풍선 위치는 YOLO(브라우저 내부)가 찾고, 원문 인식·번역만 API가 담당하므로
 * 고른 엔진의 키 하나만 있으면 됩니다.
 */
function requireKeys(settings: TranslationSettings) {
  if (settings.provider === 'openai') {
    if (!settings.openaiKey) throw new Error('OpenAI API 키를 먼저 입력해주세요.');
    return;
  }
  if (!settings.googleKey) throw new Error('Gemini API 키를 먼저 입력해주세요.');
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

/** 격자 한 장을 번역 엔진에 보냅니다. retry면 품질 검사에서 걸린 칸만 모은 재요청 */
type GridRequest = (grid: GridResult, pageCellCounts: number[] | undefined, retry: boolean) => Promise<GridTranslationResult[]>;

/** 고른 엔진으로 격자를 보내는 함수를 만듭니다. (재요청 안내·토큰 로그 이름 포함) */
function gridRequesterFor(settings: TranslationSettings, fullPage?: UploadedImage): GridRequest {
  const { provider, googleKey, openaiKey, geminiVersion, openAiVersion, glossary, context } = settings;
  return (grid, pageCellCounts, retry) => {
    const retryContext = retry ? `${context ?? ''}${RETRY_INSTRUCTION}` : context;
    const label = retry ? '격자 재요청 (품질 검사)' : undefined;
    return provider === 'openai'
      ? translateGridImageOpenAI(openAiVersion, openaiKey, grid.dataUrl, grid.cells.length, glossary, retryContext, { pageCellCounts, label })
      : translateGridImage(googleKey, base64Of(grid.dataUrl), fullPage?.mimeType ?? 'image/jpeg', grid.cells.length, geminiVersion, {
        fullBase64Image: fullPage ? base64Of(fullPage.src) : undefined,
        glossary,
        context: retryContext,
        label,
      });
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

/**
 * 말풍선들을 격자로 묶어 번역하고, 기계적으로 판정되는 실패 칸(빈 번역·일본어 남음·응답 누락)만
 * 작은 격자로 다시 만들어 **한 번 더** 요청해 더 나은 결과로 합칩니다.
 */
async function translateGridWithQualityCheck(sources: GridSource[], request: GridRequest) {
  const grid = await createGridImage(sources);
  if (!grid) return null;
  const countsOf = (list: GridSource[]) => (list.length > 1 ? list.map(s => s.boxes.length) : undefined);

  const first = await request(grid, countsOf(sources), false);
  const { translations, report } = await applyQualityRetry(first, grid.cells, async failed => {
    // 칸 번호 순서 = 페이지 순서 → 페이지 안 박스 순서이므로, 페이지별로 모으면 재요청 격자의 번호가 failed 순서와 같아짐
    const failedSources = sources
      .map(source => ({ ...source, boxes: failed.filter(c => c.pageId === source.pageId).map(c => c.box) }))
      .filter(source => source.boxes.length > 0);
    const retryGrid = await createGridImage(failedSources);
    return retryGrid ? request(retryGrid, countsOf(failedSources), true) : [];
  });
  logQualityReport(report);
  return { grid, translations };
}

/**
 * 한 페이지 번역: 말풍선 검출(YOLO) → 읽는 순서 정렬 → 말풍선 격자 이미지 → 번역 엔진 → 원래 좌표로 복원
 *
 * - OpenAI(주력): 격자 이미지 한 장으로 원문 인식·번역을 한 번에 처리
 * - Gemini(보조): 같은 일을 Gemini가 처리. 페이지 전체 이미지를 함께 보내 상황을 참고함
 * 어느 쪽이든 번역 지침·단어장·앞 페이지 맥락은 동일하게 적용됩니다.
 */
export async function translatePage(img: UploadedImage, settings: TranslationSettings): Promise<TranslationResult[]> {
  requireKeys(settings);
  const { provider, googleKey, openaiKey, geminiVersion, openAiVersion, glossary, context } = settings;
  const imgElement = await loadImage(img.src);
  const textBoxes = sortTextByReadingOrder(await detectSpeechBubbles(imgElement));

  let rawResults: RawTranslationResult[];
  if (textBoxes.length === 0) {
    // 말풍선을 찾지 못하면 페이지 전체를 읽는 대체 경로 (좌표까지 모델이 추정하므로 정확도는 떨어짐)
    console.warn('말풍선을 찾지 못해 페이지 전체 인식으로 대체합니다.');
    rawResults = (provider === 'openai'
      ? await translateFullPageOpenAI(openAiVersion, openaiKey, img.src, glossary, context)
      : await translateMangaImage(googleKey, base64Of(img.src), img.mimeType, geminiVersion, glossary, context)
    ).map(r => ({ ...r, translated_text: stripTypeTags(r.translated_text ?? '') }));
  } else {
    const checked = await translateGridWithQualityCheck(
      [{ pageId: 'page', image: imgElement, boxes: textBoxes }],
      gridRequesterFor(settings, img),
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
 * (OpenAI 전용. Gemini 보조 모드는 페이지 전체 이미지를 함께 보내는 구조라 묶지 않습니다.)
 */
export async function translatePageBatch(pages: BatchPage[], settings: TranslationSettings): Promise<Map<string, TranslationResult[]>> {
  requireKeys(settings);

  const prepared = await Promise.all(pages.map(async page => {
    const image = await loadImage(page.img.src);
    const boxes = sortTextByReadingOrder(await detectSpeechBubbles(image));
    return { page, image, boxes };
  }));

  const sources: GridSource[] = prepared.map(p => ({ pageId: p.page.id, image: p.image, boxes: p.boxes }));
  const sizeById = new Map(prepared.map(p => [p.page.id, { width: p.image.width, height: p.image.height }]));
  const spreadById = new Map(prepared.map(p => [p.page.id, !!p.page.img.isSpread]));

  // 대사를 하나도 못 찾은 페이지도 "번역 완료(0건)"로 남겨 다시 요청하지 않도록 빈 배열로 채워둠
  const byPage = new Map<string, TranslationResult[]>(pages.map(page => [page.id, []]));

  const checked = await translateGridWithQualityCheck(sources, gridRequesterFor(settings));
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
    gridRequesterFor(settings, img),
  );
  if (!checked) throw new Error('크롭 실패');
  const [cell] = checked.translations;

  if (!cell) return { originalText: '...', translatedText: '' };
  return { originalText: cell.original_text || '...', translatedText: cell.translated_text };
}

/** 원문 한 문장만 다시 번역합니다. */
export async function retranslateText(originalText: string, settings: TranslationSettings): Promise<string> {
  if (settings.provider === 'google') {
    if (!settings.googleKey) throw new Error('Gemini API 키가 필요합니다.');
    return retranslateTextGemini(settings.googleKey, originalText, settings.geminiVersion, settings.glossary, settings.context);
  }
  if (!settings.openaiKey) throw new Error('OpenAI API 키가 필요합니다.');
  return retranslateTextOpenAI(settings.openAiVersion, settings.openaiKey, originalText, settings.glossary, settings.context);
}
