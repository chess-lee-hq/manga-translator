import type { Box2d, TranslationResult, TranslationSettings, UploadedImage } from '../types';
import { retranslateTextGemini, translateGridImage, translateMangaImage, type GridTranslationResult, type RawTranslationResult } from './gemini';
import { createGridImageFromBoxes, loadImage, type GridCellInfo } from './imageUtils';
import { retranslateTextOpenAI, translateMangaImageOpenAI } from './openai';
import { sortTextByReadingOrder } from './readingOrder';
import { sanitizeResults } from './results';
import { detectSpeechBubbles } from './yolo';
import type { BoundingBox } from './yoloPostprocess';

const base64Of = (dataUrl: string) => dataUrl.split(',')[1];

function requireKeys(settings: TranslationSettings, purpose: 'page' | 'region') {
  if (settings.provider === 'google') {
    if (!settings.googleKey) throw new Error('Google API 키를 먼저 입력해주세요.');
    return;
  }
  // OpenAI 모드도 원문 인식(OCR)은 Gemini가 담당
  if (!settings.googleKey) {
    throw new Error(purpose === 'page'
      ? 'OpenAI 모드를 사용하려면 말풍선 위치 인식을 위한 Google API 키도 반드시 입력되어야 합니다.'
      : '새 박스 인식을 위해 Google API 키가 반드시 필요합니다.');
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
    results.push({ original_text: t.original_text, translated_text: t.translated_text, box_2d: toBox2d(cell.box, width, height) });
  }
  return results;
}

/** 한 페이지 번역: 말풍선 검출 → 읽는 순서 정렬 → 말풍선 격자 이미지 → LLM 번역 → 원래 좌표로 복원 */
export async function translatePage(img: UploadedImage, settings: TranslationSettings): Promise<TranslationResult[]> {
  requireKeys(settings, 'page');
  const { provider, googleKey, openaiKey, geminiVersion, openAiVersion, glossary, context } = settings;
  const base64Data = base64Of(img.src);
  const imgElement = await loadImage(img.src);
  const textBoxes = sortTextByReadingOrder(await detectSpeechBubbles(imgElement));

  let rawResults: RawTranslationResult[];
  if (textBoxes.length === 0) {
    // 말풍선을 찾지 못하면 페이지 전체 OCR로 대체
    console.warn('No text bubbles detected by YOLO, falling back to full page OCR.');
    if (provider === 'google') {
      rawResults = await translateMangaImage(googleKey, base64Data, img.mimeType, geminiVersion, glossary, context);
    } else {
      const geminiResults = await translateMangaImage(googleKey, base64Data, img.mimeType, geminiVersion);
      rawResults = await translateMangaImageOpenAI(openAiVersion, openaiKey, geminiResults, glossary, context);
    }
  } else {
    const gridResult = await createGridImageFromBoxes(imgElement, textBoxes);
    if (!gridResult) return [];
    const gridTranslations = await translateGridImage(
      googleKey, base64Data, base64Of(gridResult.dataUrl), img.mimeType, gridResult.cells.length, geminiVersion,
      provider === 'google' ? glossary : undefined,
      provider === 'google' ? context : undefined,
    );
    rawResults = mapGridToResults(gridTranslations, gridResult.cells, imgElement.width, imgElement.height);
    // OpenAI 모드: Gemini가 인식한 원문을 OpenAI가 다시 번역
    if (provider === 'openai') rawResults = await translateMangaImageOpenAI(openAiVersion, openaiKey, rawResults, glossary, context);
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
  requireKeys(settings, 'region');
  const { provider, googleKey, openaiKey, geminiVersion, openAiVersion, glossary, context } = settings;
  const imgElement = await loadImage(img.src);
  const [ymin, xmin, ymax, xmax] = box.map((v, i) => (v / 1000) * (i % 2 === 0 ? img.height : img.width));

  const gridResult = await createGridImageFromBoxes(imgElement, [{ xmin, ymin, xmax, ymax, classId: 3, confidence: 1 }]);
  if (!gridResult) throw new Error('크롭 실패');

  const [cell] = await translateGridImage(googleKey, base64Of(img.src), base64Of(gridResult.dataUrl), img.mimeType, 1, geminiVersion, glossary, context);
  if (!cell) return { originalText: '...', translatedText: '' };

  const originalText = cell.original_text || '...';
  if (provider === 'google') return { originalText, translatedText: cell.translated_text };

  const hasText = originalText !== '...' && originalText.trim() !== '';
  return {
    originalText,
    translatedText: hasText ? await retranslateTextOpenAI(openAiVersion, openaiKey, originalText, glossary, context) : '인식된 텍스트가 없습니다.',
  };
}

/** 원문 한 문장만 다시 번역합니다. */
export async function retranslateText(originalText: string, settings: TranslationSettings): Promise<string> {
  if (settings.provider === 'google') {
    if (!settings.googleKey) throw new Error('Google API 키가 필요합니다.');
    return retranslateTextGemini(settings.googleKey, originalText, settings.geminiVersion, settings.glossary, settings.context);
  }
  if (!settings.openaiKey) throw new Error('OpenAI API 키가 필요합니다.');
  return retranslateTextOpenAI(settings.openAiVersion, settings.openaiKey, originalText, settings.glossary, settings.context);
}
