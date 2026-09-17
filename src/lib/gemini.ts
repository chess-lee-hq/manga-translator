import { GoogleGenAI, Type } from '@google/genai';
import { parseJsonResponse } from './prompt';
import { sortMangaBoxesByTier } from './readingOrder';
import { buildFullPagePrompt, buildGridPrompt, buildRetranslatePrompt, buildShortenPrompt, buildWorkNotesPrompt } from './translationPrompt';
import { parseWorkNotesResponse, type WorkNotesResult } from './glossaryCandidates';
import { assertHeaderSafeApiKey, toFriendlyError, withRetry } from './retry';
import { recordUsage } from './usageLog';

export interface TranslationResult {
  id: string;
  original_text: string;
  translated_text: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized to 1000
  is_edited_box?: boolean;
  /** 덮어쓰기 표시 방식. cover: 원문을 흰 말풍선으로 덮음 / tag: 원문은 두고 바깥에 작은 딱지 / 없으면 자동 판별 */
  display_mode?: 'cover' | 'tag';
  /** 글자 방향. 없으면 박스 모양을 보고 자동 판별(홀쭉한 박스는 세로쓰기) */
  text_direction?: 'horizontal' | 'vertical';
  /** 작은 딱지(tag)를 사용자가 직접 옮긴 위치 [ymin, xmin] (0~1000). 없으면 자동 배치 */
  tag_pos?: [number, number];
  /** 작은 딱지 크기 배율. 없으면 기본 크기(1) */
  tag_scale?: number;
  /**
   * 원본 말풍선 모양에 맞춰 넣기. 없으면 자동(직접 옮기거나 크기를 바꾼 박스는 끔),
   * true면 박스를 고쳤어도 켬, false면 끔 (둥근 사각형 덮기)
   */
  fit_bubble?: boolean;
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

/**
 * [메인 선택 시] 말풍선을 찾지 못한 페이지의 대체 경로: 페이지 전체를 보여주고 좌표까지 함께 받습니다.
 * 좌표는 모델 추정치라 정확도가 낮으므로, 격자 경로가 가능하면 그쪽을 씁니다.
 */
export async function translateMangaImage(
  apiKey: string,
  base64Image: string,
  mimeType: string,
  geminiVersion: GeminiVersion = '3.6',
  glossary?: Record<string, string>,
  context?: string,
): Promise<RawTranslationResult[]> {
  const prompt = buildFullPagePrompt({ output: 'array', glossary, context });

  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
    contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { data: base64Image, mimeType } }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            original_text: { type: Type.STRING },
            translated_text: { type: Type.STRING },
            box_2d: { type: Type.ARRAY, items: { type: Type.INTEGER } },
          },
          required: ['original_text', 'translated_text', 'box_2d'],
        },
      },
      temperature: 0.35,
    },
  }, '페이지 전체 번역');

  const text = response.text;
  if (!text) throw new Error('No response from Gemini API');

  try {
    const results = parseJsonResponse<RawTranslationResult[]>(text);
    return sortMangaBoxesByTier(results, r => r.box_2d);
  } catch (error: any) {
    throw new Error('Failed to parse JSON response: ' + error.message);
  }
}

/** [메인 선택 시] 원문 한 문장만 다시 번역합니다. */
export async function retranslateTextGemini(
  apiKey: string, originalText: string, geminiVersion: GeminiVersion = '3.6', glossary?: Record<string, string>, context?: string,
): Promise<string> {
  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
    contents: buildRetranslatePrompt(originalText, { glossary, context }),
    config: { temperature: 0.7 },
  }, '문장 재번역');

  return response.text?.trim() || '번역 실패';
}

/** [메인 선택 시] 말풍선에 들어가도록 번역문을 짧게 다듬습니다. */
export async function shortenTranslationGemini(
  apiKey: string, geminiVersion: GeminiVersion, originalText: string, currentTranslation: string, maxChars: number,
  glossary?: Record<string, string>, context?: string,
): Promise<string> {
  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
    contents: buildShortenPrompt(originalText, currentTranslation, maxChars, { glossary, context }),
  }, '짧게 다시 번역');

  const text = response.text?.trim();
  if (!text) throw new Error('No response from Gemini API');
  return text;
}

/** [메인 선택 시] 지금까지의 번역으로 작품 노트(말투·호칭 기억)를 정리합니다. */
export async function summarizeWorkNotes(
  apiKey: string,
  geminiVersion: GeminiVersion,
  pairs: { original: string; translated: string }[],
  previousNotes?: string,
  correctionSection?: string,
  existingGlossary: string[] = [],
): Promise<WorkNotesResult> {
  if (pairs.length === 0) return { notes: previousNotes?.trim() ?? '', glossary: [] };

  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
    contents: buildWorkNotesPrompt(pairs, previousNotes, correctionSection, existingGlossary),
    config: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          notes: { type: Type.STRING },
          glossary: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { original: { type: Type.STRING }, translated: { type: Type.STRING } },
              required: ['original', 'translated'],
            },
          },
        },
        required: ['notes', 'glossary'],
      },
    },
  }, '작품 노트 정리 (+단어장 후보)');
  return parseWorkNotesResponse(response.text ?? '');
}

export interface GridRequestOptions {
  /** 여러 페이지에서 모은 칸일 때 페이지별 칸 수 */
  pageCellCounts?: number[];
  glossary?: Record<string, string>;
  context?: string;
  /** 토큰 사용량 로그에 표시할 이름 */
  label?: string;
  /** 얼굴 위치로 추정한 화자 힌트 */
  speakerHint?: string;
}

/**
 * [보조] 품질 검사에 걸린 칸을 모은 격자를 Gemini로 다시 읽고 번역합니다.
 * 주력(OpenAI)과 다른 모델이 읽으므로, 같은 모델이 같은 글자를 반복해서 잘못 읽는 경우를 피할 수 있습니다.
 */
export async function translateGridImage(
  apiKey: string,
  gridBase64Image: string,
  mimeType: string,
  expectedCells: number,
  geminiVersion: GeminiVersion = '3.6',
  options: GridRequestOptions = {},
): Promise<GridTranslationResult[]> {
  const { pageCellCounts, glossary, context, label, speakerHint } = options;

  const prompt = buildGridPrompt({
    expectedCells,
    pageCellCounts,
    speakerHint,
    output: 'array',
    glossary,
    context,
  });

  const parts = [
    { text: prompt },
    { inlineData: { data: gridBase64Image, mimeType } },
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
  }, label ?? '격자 번역');

  const text = response.text;
  if (!text) throw new Error("No response from Gemini API");

  try {
    return parseJsonResponse<GridTranslationResult[]>(text);
  } catch (error: any) {
    throw new Error("Failed to parse JSON response: " + error.message);
  }
}
