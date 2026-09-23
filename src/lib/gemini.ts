import { parseJsonResponse } from './prompt';
import { sortMangaBoxesByTier } from './readingOrder';
import { fullPageToResult, gridCellToResult, type FullPageWire, type GridCellWire } from './responseShape';
import { buildFullPagePrompt, buildGridPrompt, buildRetranslatePrompt, buildShortenPrompt, buildWorkNotesPrompt, type PromptContextOptions } from './translationPrompt';
import { parseWorkNotesResponse, type WorkNotesResult } from './glossaryCandidates';
import { assertHeaderSafeApiKey, toFriendlyError, withRetry } from './retry';
import { isUnsupportedParameterError, markReasoningControlUnsupported, shouldReduceReasoning } from './requestTuning';
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

const modelNameFor = (geminiVersion: GeminiVersion) => (geminiVersion === '3.7' ? 'gemini-3.7-flash' : 'gemini-3.6-flash');

/**
 * Gemini REST API를 직접 부릅니다. (예전에는 @google/genai SDK를 썼지만, 쓰는 기능이 generateContent 하나뿐이라
 * 번들이 무거워지는 SDK 대신 OpenAI 쪽과 같은 방식의 fetch 호출로 바꿈)
 */
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** 응답 스키마 타입 이름 (REST API가 받는 대문자 표기) */
const Type = { ARRAY: 'ARRAY', OBJECT: 'OBJECT', INTEGER: 'INTEGER', STRING: 'STRING' } as const;

type GeminiPart = { text: string } | { inlineData: { data: string; mimeType: string } };

interface GenerateContentRequest {
  model: string;
  /** 문자열이면 사용자 메시지 하나로 감쌈 */
  contents: string | { role: 'user'; parts: GeminiPart[] }[];
  /** REST의 generationConfig (temperature·responseMimeType·responseSchema 등) */
  config?: Record<string, unknown>;
}

interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
}

type HttpError = Error & { status?: number; retryAfterMs?: number };

/** 429(요청 한도)·5xx·네트워크 오류는 지수 백오프로 재시도하고, 최종 실패는 화면에 보여줄 안내로 바꿉니다. */
async function generateContent(apiKey: string, request: GenerateContentRequest, label = '요청'): Promise<{ text: string }> {
  assertHeaderSafeApiKey(apiKey, 'Gemini');
  const contents = typeof request.contents === 'string'
    ? [{ role: 'user', parts: [{ text: request.contents }] }]
    : request.contents;
  const send = (config: Record<string, unknown> | undefined) => withRetry(async () => {
      const res = await fetch(`${GEMINI_API_URL}/${request.model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents, ...(config ? { generationConfig: config } : {}) }),
      });
      if (!res.ok) {
        const error: HttpError = new Error(`Gemini API Error ${res.status}: ${await res.text()}`);
        error.status = res.status;
        const retryAfterSeconds = Number(res.headers.get('retry-after'));
        if (retryAfterSeconds > 0) error.retryAfterMs = retryAfterSeconds * 1000;
        throw error;
      }
      return res.json() as Promise<GenerateContentResponse>;
    }, {
      onRetry: ({ attempt, delayMs, error }) => {
        console.warn(`Gemini 요청 재시도 ${attempt}회 (${Math.round(delayMs / 1000)}초 후):`, (error as Error)?.message ?? error);
      },
    });

  try {
    let response: GenerateContentResponse;
    if (shouldReduceReasoning(request.model)) {
      // 추론 줄이기(사용량 창의 실험 옵션): thinking 예산 0. 지원하지 않는 모델이면 기억해 두고 설정 없이 다시 보냄
      try {
        response = await send({ ...request.config, thinkingConfig: { thinkingBudget: 0 } });
      } catch (error) {
        if (!isUnsupportedParameterError(error, 'thinking')) throw error;
        markReasoningControlUnsupported(request.model);
        response = await send(request.config);
      }
    } else {
      response = await send(request.config);
    }
    const usage = response.usageMetadata;
    const thoughts = usage?.thoughtsTokenCount ?? 0;
    recordUsage({
      provider: 'gemini',
      model: request.model,
      label,
      inputTokens: usage?.promptTokenCount ?? 0,
      cachedInputTokens: usage?.cachedContentTokenCount ?? 0,
      // Gemini는 생각 토큰을 답 토큰과 따로 세지만 둘 다 출력 단가로 청구되므로 출력에 합치고, 추론으로도 따로 기록
      outputTokens: (usage?.candidatesTokenCount ?? 0) + thoughts,
      reasoningTokens: thoughts,
    });
    // 생각(thought) 파트는 답이 아니므로 빼고 이어 붙임
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    return { text: parts.filter(part => !part.thought).map(part => part.text ?? '').join('') };
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
  options: PromptContextOptions = {},
): Promise<RawTranslationResult[]> {
  const prompt = buildFullPagePrompt(options);

  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
    contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { data: base64Image, mimeType } }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          cells: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                box: { type: Type.ARRAY, items: { type: Type.INTEGER } },
                jp: { type: Type.STRING },
                ko: { type: Type.STRING },
              },
              required: ['box', 'jp', 'ko'],
            },
          },
        },
        required: ['cells'],
      },
      temperature: 0.35,
    },
  }, '페이지 전체 번역');

  const text = response.text;
  if (!text) throw new Error('No response from Gemini API');

  try {
    const results = (parseJsonResponse<{ cells?: FullPageWire[] }>(text).cells ?? []).map(fullPageToResult);
    return sortMangaBoxesByTier(results, r => r.box_2d);
  } catch (error: any) {
    throw new Error('Failed to parse JSON response: ' + error.message);
  }
}

/** [메인 선택 시] 원문 한 문장만 다시 번역합니다. */
export async function retranslateTextGemini(
  apiKey: string, originalText: string, geminiVersion: GeminiVersion = '3.6', options: PromptContextOptions = {},
): Promise<string> {
  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
    contents: buildRetranslatePrompt(originalText, options),
    config: { temperature: 0.7 },
  }, '문장 재번역');

  return response.text?.trim() || '번역 실패';
}

/** [메인 선택 시] 말풍선에 들어가도록 번역문을 짧게 다듬습니다. */
export async function shortenTranslationGemini(
  apiKey: string, geminiVersion: GeminiVersion, originalText: string, currentTranslation: string, maxChars: number,
  options: PromptContextOptions = {},
): Promise<string> {
  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
    contents: buildShortenPrompt(originalText, currentTranslation, maxChars, options),
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

export interface GridRequestOptions extends PromptContextOptions {
  /** 여러 페이지에서 모은 칸일 때 페이지별 칸 수 */
  pageCellCounts?: number[];
  /** 얼굴 위치로 추정한 화자 힌트 */
  speakerHint?: string;
  /** 품질 검사에 걸린 칸을 다시 보내는 요청 */
  retry?: boolean;
  /** 토큰 사용량 로그에 표시할 이름 */
  label?: string;
}

/**
 * [보조] 품질 검사에 걸린 칸을 모은 격자를 Gemini로 다시 읽고 번역합니다.
 * 주력(OpenAI)과 다른 모델이 읽으므로, 같은 모델이 같은 글자를 반복해서 잘못 읽는 경우를 피할 수 있습니다.
 */
export async function translateGridImage(
  apiKey: string,
  gridImages: { data: string; mimeType: string }[],
  expectedCells: number,
  geminiVersion: GeminiVersion = '3.6',
  options: GridRequestOptions = {},
): Promise<GridTranslationResult[]> {
  const { pageCellCounts, label, ...promptOptions } = options;
  const prompt = buildGridPrompt({ expectedCells, pageCellCounts, ...promptOptions });

  // 격자가 여러 장이어도(칸 번호는 이어짐) 한 요청에 순서대로 싣는다
  const parts = [
    { text: prompt },
    ...gridImages.map(image => ({ inlineData: image })),
  ];

  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
    contents: [{ role: 'user', parts }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          cells: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.INTEGER },
                jp: { type: Type.STRING },
                ko: { type: Type.STRING },
              },
              required: ['id', 'jp', 'ko'],
            },
          },
        },
        required: ['cells'],
      },
      temperature: 0.35,
    },
  }, label ?? '격자 번역');

  const text = response.text;
  if (!text) throw new Error("No response from Gemini API");

  try {
    return (parseJsonResponse<{ cells?: GridCellWire[] }>(text).cells ?? []).map(gridCellToResult);
  } catch (error: any) {
    throw new Error("Failed to parse JSON response: " + error.message);
  }
}
