import type { Box2d, TranslationResult, TranslationSettings, UploadedImage } from '../types';
import { retranslateTextGemini, translateGridImage, translateMangaImage, type GridTranslationResult, type RawTranslationResult } from './gemini';
import { createGridImageFromBoxes, loadImage, type GridCellInfo } from './imageUtils';
import { retranslateTextOpenAI, translateFullPageOpenAI, translateGridImageOpenAI } from './openai';
import { sortTextByReadingOrder } from './readingOrder';
import { sanitizeResults } from './results';
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
    rawResults = provider === 'openai'
      ? await translateFullPageOpenAI(openAiVersion, openaiKey, img.src, glossary, context)
      : await translateMangaImage(googleKey, base64Of(img.src), img.mimeType, geminiVersion, glossary, context);
  } else {
    const gridResult = await createGridImageFromBoxes(imgElement, textBoxes);
    if (!gridResult) return [];
    const cellCount = gridResult.cells.length;

    const gridTranslations = provider === 'openai'
      ? await translateGridImageOpenAI(openAiVersion, openaiKey, gridResult.dataUrl, cellCount, glossary, context)
      : await translateGridImage(googleKey, base64Of(gridResult.dataUrl), img.mimeType, cellCount, geminiVersion, {
        fullBase64Image: base64Of(img.src),
        glossary,
        context,
      });

    rawResults = mapGridToResults(gridTranslations, gridResult.cells, imgElement.width, imgElement.height);
  }

  const results = sanitizeResults(rawResults) ?? []; // 좌표가 깨진 응답 제거 + id 부여

  // 양면 펼침면은 오른쪽 페이지(가로 중심 ≥ 500) 텍스트를 먼저 읽도록 재정렬
  if (img.isSpread && results.length > 0) {
    const centerX = (r: TranslationResult) => (r.box_2d[1] + r.box_2d[3]) / 2;
    return [...results.filter(r => centerX(r) >= 500), ...results.filter(r => centerX(r) < 500)];
  }
  return results;
}

/** 사용자가 직접 그린 영역 하나를 인식·번역합니다. */
export async function translateRegion(img: UploadedImage, box: Box2d, settings: TranslationSettings): Promise<{ originalText: string; translatedText: string }> {
  requireKeys(settings);
  const { provider, googleKey, openaiKey, geminiVersion, openAiVersion, glossary, context } = settings;
  const imgElement = await loadImage(img.src);
  const [ymin, xmin, ymax, xmax] = box.map((v, i) => (v / 1000) * (i % 2 === 0 ? img.height : img.width));

  const gridResult = await createGridImageFromBoxes(imgElement, [{ xmin, ymin, xmax, ymax, classId: 3, confidence: 1 }]);
  if (!gridResult) throw new Error('크롭 실패');

  const [cell] = provider === 'openai'
    ? await translateGridImageOpenAI(openAiVersion, openaiKey, gridResult.dataUrl, 1, glossary, context)
    : await translateGridImage(googleKey, base64Of(gridResult.dataUrl), img.mimeType, 1, geminiVersion, {
      fullBase64Image: base64Of(img.src),
      glossary,
      context,
    });

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
