import type { GridTranslationResult, RawTranslationResult } from './gemini';
import { parseJsonResponse } from './prompt';
import { sortMangaBoxesByTier } from './readingOrder';
import { parseWorkNotesResponse, type WorkNotesResult } from './glossaryCandidates';
import {
  fullPageToResult, gridCellToResult, OPENAI_FULL_PAGE_SCHEMA, OPENAI_GRID_SCHEMA, OPENAI_WORK_NOTES_SCHEMA,
  type FullPageWire, type GridCellWire,
} from './responseShape';
import { assertHeaderSafeApiKey, toFriendlyError, withRetry } from './retry';
import { buildFullPagePrompt, buildGridPrompt, buildRetranslatePrompt, buildShortenPrompt, buildWorkNotesPrompt, type PromptContextOptions } from './translationPrompt';
import { isUnsupportedParameterError, LOW_REASONING_EFFORT, markReasoningControlUnsupported, shouldReduceReasoning } from './requestTuning';
import { recordUsage } from './usageLog';

type OpenAiVersion = 'terra' | 'sol' | 'luna';
type HttpError = Error & { status?: number; retryAfterMs?: number };

/**
 * 헤더에서 고르는 이름 → 실제 모델 ID.
 * 세대가 섞여 있어(5.6 / 6) 이름만 이어 붙이지 않고 표로 둡니다.
 * - terra: 기본값. 일본어 인식이 안정적
 * - sol: 가장 강한 인식·번역 (품질 검사 재요청의 승격 대상이기도 함)
 * - luna: 시험용. 고어체·붓글씨체 원문을 잘못 읽는 경우가 있어 지켜보는 중
 */
export const OPENAI_MODELS: Record<OpenAiVersion, string> = {
  terra: 'gpt-5.6-terra',
  sol: 'gpt-6-sol',
  luna: 'gpt-6-luna',
};

const modelFor = (openAiVersion: OpenAiVersion) => OPENAI_MODELS[openAiVersion] ?? OPENAI_MODELS.terra;

/** Chat Completions 호출. 429·5xx는 Retry-After 헤더를 존중하며 재시도하고, 최종 실패는 안내 메시지로 바꿉니다. */
async function createChatCompletion(apiKey: string, body: Record<string, unknown>, label = '요청'): Promise<any> {
  assertHeaderSafeApiKey(apiKey, 'OpenAI');
  const model = String(body.model);
  const send = (payload: Record<string, unknown>) => withRetry(async () => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorText = await res.text();
        const error: HttpError = new Error(`OpenAI API Error ${res.status}: ${errorText}`);
        error.status = res.status;
        const retryAfterSeconds = Number(res.headers.get('retry-after'));
        if (retryAfterSeconds > 0) error.retryAfterMs = retryAfterSeconds * 1000;
        throw error;
      }

      return res.json();
    }, {
      onRetry: ({ attempt, delayMs, error }) => {
        console.warn(`OpenAI 요청 재시도 ${attempt}회 (${Math.round(delayMs / 1000)}초 후):`, (error as Error)?.message ?? error);
      },
    });

  try {
    let response;
    if (shouldReduceReasoning(model)) {
      // 추론 줄이기(사용량 창의 실험 옵션): 지원하지 않는 모델이면 기억해 두고 설정 없이 다시 보냄
      try {
        response = await send({ ...body, reasoning_effort: LOW_REASONING_EFFORT });
      } catch (error) {
        if (!isUnsupportedParameterError(error, 'reasoning_effort')) throw error;
        markReasoningControlUnsupported(model);
        response = await send(body);
      }
    } else {
      response = await send(body);
    }
    const usage = response?.usage;
    recordUsage({
      provider: 'openai',
      model,
      label,
      inputTokens: usage?.prompt_tokens ?? 0,
      cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    });
    return response;
  } catch (error) {
    throw toFriendlyError(error, 'OpenAI');
  }
}

/** 이미지 한 장을 붙인 사용자 메시지 */
function imageMessage(prompt: string, imageDataUrl: string) {
  return {
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
    ],
  };
}

/** 응답 형태는 json_schema(strict)로 강제되므로, 여기서는 파싱만 합니다. */
function parseCells<T>(content: unknown): T[] {
  if (typeof content !== 'string' || !content) throw new Error('No response from OpenAI API');
  try {
    const parsed = parseJsonResponse<{ cells?: T[] }>(content);
    return parsed.cells ?? [];
  } catch (error: any) {
    throw new Error('Failed to parse JSON response: ' + error.message);
  }
}

const contentOf = (response: any): unknown => response?.choices?.[0]?.message?.content;

export interface GridRequestOptions extends PromptContextOptions {
  /** 여러 페이지를 한 격자에 묶었을 때 페이지별 칸 수 */
  pageCellCounts?: number[];
  /** 얼굴 위치로 추정한 화자 힌트 */
  speakerHint?: string;
  /** 품질 검사에 걸린 칸을 다시 보내는 요청 */
  retry?: boolean;
  /** 토큰 사용량 로그에 표시할 이름 */
  label?: string;
}

/**
 * [주력] 말풍선 격자 이미지를 OpenAI에게 직접 보여주고 원문 인식(OCR)과 번역을 한 번에 받습니다.
 * 이미지 한 장·요청 한 번으로 끝나므로 다른 엔진을 거치지 않습니다.
 */
export async function translateGridImageOpenAI(
  openAiVersion: OpenAiVersion,
  apiKey: string,
  gridDataUrl: string,
  expectedCells: number,
  options: GridRequestOptions = {},
): Promise<GridTranslationResult[]> {
  const { pageCellCounts, label, ...promptOptions } = options;
  const prompt = buildGridPrompt({ expectedCells, pageCellCounts, ...promptOptions });

  const response = await createChatCompletion(apiKey, {
    model: modelFor(openAiVersion),
    messages: [imageMessage(prompt, gridDataUrl)],
    response_format: { type: 'json_schema', json_schema: OPENAI_GRID_SCHEMA },
  }, label ?? (pageCellCounts && pageCellCounts.length > 1 ? `격자 번역 (${pageCellCounts.length}장 묶음)` : '격자 번역'));

  return parseCells<GridCellWire>(contentOf(response)).map(gridCellToResult);
}

/**
 * 말풍선을 찾지 못한 페이지의 대체 경로: 페이지 전체를 보여주고 좌표까지 함께 받습니다.
 * 좌표는 모델 추정치라 정확도가 낮으므로, 격자 경로가 가능하면 그쪽을 씁니다.
 */
export async function translateFullPageOpenAI(
  openAiVersion: OpenAiVersion,
  apiKey: string,
  pageDataUrl: string,
  options: PromptContextOptions = {},
): Promise<RawTranslationResult[]> {
  const response = await createChatCompletion(apiKey, {
    model: modelFor(openAiVersion),
    messages: [imageMessage(buildFullPagePrompt(options), pageDataUrl)],
    response_format: { type: 'json_schema', json_schema: OPENAI_FULL_PAGE_SCHEMA },
  }, '페이지 전체 번역');

  const cells = parseCells<FullPageWire>(contentOf(response)).map(fullPageToResult);
  return sortMangaBoxesByTier(cells, c => c.box_2d);
}

/** 원문 한 문장만 다시 번역합니다. */
export async function retranslateTextOpenAI(
  openAiVersion: OpenAiVersion, apiKey: string, originalText: string, options: PromptContextOptions = {},
): Promise<string> {
  const response = await createChatCompletion(apiKey, {
    model: modelFor(openAiVersion),
    messages: [{ role: 'user', content: buildRetranslatePrompt(originalText, options) }],
  }, '문장 재번역');

  const text = contentOf(response);
  return (typeof text === 'string' ? text.trim() : '') || '번역 실패';
}

/** 말풍선에 들어가도록 번역문을 짧게 다듬습니다. */
export async function shortenTranslationOpenAI(
  openAiVersion: OpenAiVersion, apiKey: string, originalText: string, currentTranslation: string, maxChars: number,
  options: PromptContextOptions = {},
): Promise<string> {
  const response = await createChatCompletion(apiKey, {
    model: modelFor(openAiVersion),
    messages: [{ role: 'user', content: buildShortenPrompt(originalText, currentTranslation, maxChars, options) }],
  }, '짧게 다시 번역');

  const content = contentOf(response);
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) throw new Error('No response from OpenAI API');
  return text;
}

/** 지금까지의 번역으로 작품 노트(말투·호칭 기억)를 정리합니다. */
export async function summarizeWorkNotesOpenAI(
  openAiVersion: OpenAiVersion,
  apiKey: string,
  pairs: { original: string; translated: string }[],
  previousNotes?: string,
  correctionSection?: string,
  existingGlossary: string[] = [],
): Promise<WorkNotesResult> {
  if (pairs.length === 0) return { notes: previousNotes?.trim() ?? '', glossary: [] };

  const response = await createChatCompletion(apiKey, {
    model: modelFor(openAiVersion),
    messages: [{ role: 'user', content: buildWorkNotesPrompt(pairs, previousNotes, correctionSection, existingGlossary) }],
    response_format: { type: 'json_schema', json_schema: OPENAI_WORK_NOTES_SCHEMA },
  }, '작품 노트 정리 (+단어장 후보)');

  const content = contentOf(response);
  return parseWorkNotesResponse(typeof content === 'string' ? content : '');
}
