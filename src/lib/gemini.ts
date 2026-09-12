import { GoogleGenAI, Type } from '@google/genai';
import { sortMangaBoxesByTier } from './readingOrder';
import { parseJsonResponse } from './prompt';
import { buildFullPagePrompt, buildGridPrompt, buildRetranslatePrompt, buildWorkNotesPrompt } from './translationPrompt';
import { assertHeaderSafeApiKey, toFriendlyError, withRetry } from './retry';
import { recordUsage } from './usageLog';

export interface TranslationResult {
  id: string;
  original_text: string;
  translated_text: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized to 1000
  is_edited_box?: boolean;
  disable_keep_all?: boolean;
  /** 덮어쓰기 표시 방식. cover: 원문을 흰 말풍선으로 덮음 / tag: 원문은 두고 바깥에 작은 딱지 / 없으면 자동 판별 */
  display_mode?: 'cover' | 'tag';
  /** 글자 방향. 없으면 박스 모양을 보고 자동 판별(홀쭉한 박스는 세로쓰기) */
  text_direction?: 'horizontal' | 'vertical';
}

/** API가 돌려준 가공 전 결과 (앱에서 id를 붙이기 전) */
export type RawTranslationResult = Omit<TranslationResult, 'id'>;

export interface GridTranslationResult {
  id: number;
  original_text: string;
  translated_text: string;
}

type GeminiVersion = '3.6' | '3.7';
type GenerateContentRequest = Parameters<GoogleGenAI['models']['generateContent']>[0];

const modelNameFor = (geminiVersion: GeminiVersion) => (geminiVersion === '3.7' ? 'gemini-3.7-flash' : 'gemini-3.6-flash');

/** 429(요청 한도)·5xx·네트워크 오류는 지수 백오프로 재시도하고, 최종 실패는 화면에 보여줄 안내로 바꿉니다. */
async function generateContent(apiKey: string, request: GenerateContentRequest, label = '요청') {
  assertHeaderSafeApiKey(apiKey, 'Gemini');
  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await withRetry(() => ai.models.generateContent(request), {
      onRetry: ({ attempt, delayMs, error }) => {
        console.warn(`Gemini 요청 재시도 ${attempt}회 (${Math.round(delayMs / 1000)}초 후):`, (error as Error)?.message ?? error);
      },
    });
    const usage = response.usageMetadata;
    recordUsage('gemini', label, usage?.promptTokenCount ?? 0, (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0));
    return response;
  } catch (error) {
    throw toFriendlyError(error, 'Gemini');
  }
}

export async function translateMangaImage(apiKey: string, base64Image: string, mimeType: string, geminiVersion: GeminiVersion = '3.6', glossary?: Record<string, string>, context?: string): Promise<RawTranslationResult[]> {
  const prompt = buildFullPagePrompt({ output: 'array', glossary, context });

  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
    contents: [
      { role: 'user', parts: [
        { text: prompt },
        { inlineData: { data: base64Image, mimeType } }
      ]}
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            original_text: { type: Type.STRING },
            translated_text: { type: Type.STRING },
            box_2d: {
              type: Type.ARRAY,
              items: { type: Type.INTEGER }
            }
          },
          required: ['original_text', 'translated_text', 'box_2d']
        }
      },
      temperature: 0.35,
    }
  }, '페이지 전체 번역');

  const text = response.text;
  if (!text) throw new Error("No response from Gemini API");

  try {
    const translationResults = parseJsonResponse<RawTranslationResult[]>(text);
    // 프론트엔드에서 한 번 더 완벽한 일본 만화 읽는 순서로 정렬합니다.
    return sortMangaBoxesByTier(translationResults, t => t.box_2d);
  } catch (error: any) {
    throw new Error("Failed to parse JSON response: " + error.message);
  }
}

export async function retranslateTextGemini(apiKey: string, originalText: string, geminiVersion: GeminiVersion = '3.6', glossary?: Record<string, string>, context?: string): Promise<string> {
  const prompt = buildRetranslatePrompt(originalText, { glossary, context });

  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
    contents: prompt,
    config: { temperature: 0.7 }
  }, '문장 재번역');

  return response.text?.trim() || "번역 실패";
}

export interface GridRequestOptions {
  /** 원본 페이지 전체 이미지 (상황·표정 파악용). Gemini 보조 모드에서만 함께 보냅니다. */
  fullBase64Image?: string;
  glossary?: Record<string, string>;
  context?: string;
}

/** [보조] 말풍선 격자 이미지를 Gemini로 읽고 번역합니다. */
export async function translateGridImage(
  apiKey: string,
  gridBase64Image: string,
  mimeType: string,
  expectedCells: number,
  geminiVersion: GeminiVersion = '3.6',
  options: GridRequestOptions = {},
): Promise<GridTranslationResult[]> {
  const { fullBase64Image, glossary, context } = options;

  const prompt = buildGridPrompt({
    expectedCells,
    withFullPage: !!fullBase64Image,
    output: 'array',
    glossary,
    context,
  });

  const parts = [
    { text: prompt },
    ...(fullBase64Image ? [{ inlineData: { data: fullBase64Image, mimeType } }] : []),
    { inlineData: { data: gridBase64Image, mimeType: 'image/jpeg' } },
  ];

  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
    contents: [{ role: 'user', parts }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.INTEGER },
            original_text: { type: Type.STRING },
            translated_text: { type: Type.STRING },
          },
          required: ['id', 'original_text', 'translated_text'],
        },
      },
      temperature: 0.35,
    },
  }, '격자 번역');

  const text = response.text;
  if (!text) throw new Error("No response from Gemini API");

  try {
    return parseJsonResponse<GridTranslationResult[]>(text);
  } catch (error: any) {
    throw new Error("Failed to parse JSON response: " + error.message);
  }
}

/**
 * 지금까지의 번역을 바탕으로 "작품 노트"(인물별 말투·호칭·고유명사 표기)를 만듭니다.
 * 이후 페이지의 번역 프롬프트에 넣어 말투와 표기를 일관되게 유지하는 데 씁니다.
 */
export async function summarizeWorkNotes(
  apiKey: string,
  geminiVersion: GeminiVersion,
  pairs: { original: string; translated: string }[],
  previousNotes?: string,
): Promise<string> {
  if (pairs.length === 0) return previousNotes?.trim() ?? '';

  const prompt = buildWorkNotesPrompt(pairs, previousNotes);

  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
    contents: prompt,
    config: { temperature: 0.2 },
  }, '작품 노트 정리');
  return response.text?.trim() ?? '';
}
