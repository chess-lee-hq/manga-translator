import type { GridTranslationResult, RawTranslationResult } from './gemini';
import { parseJsonResponse } from './prompt';
import { sortMangaBoxesByTier } from './readingOrder';
import { assertHeaderSafeApiKey, toFriendlyError, withRetry } from './retry';
import { buildFullPagePrompt, buildGridPrompt, buildRetranslatePrompt, buildWorkNotesPrompt } from './translationPrompt';
import { recordUsage } from './usageLog';

type OpenAiVersion = 'sol' | 'terra';
type HttpError = Error & { status?: number; retryAfterMs?: number };

const modelFor = (openAiVersion: OpenAiVersion) => `gpt-5.6-${openAiVersion}`;

/** Chat Completions 호출. 429·5xx는 Retry-After 헤더를 존중하며 재시도하고, 최종 실패는 안내 메시지로 바꿉니다. */
async function createChatCompletion(apiKey: string, body: Record<string, unknown>, label = '요청'): Promise<any> {
  assertHeaderSafeApiKey(apiKey, 'OpenAI');
  try {
    const response = await withRetry(async () => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
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
    recordUsage('openai', label, response?.usage?.prompt_tokens ?? 0, response?.usage?.completion_tokens ?? 0);
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

function parseCells<T>(content: unknown): T[] {
  if (typeof content !== 'string' || !content) throw new Error('No response from OpenAI API');
  try {
    const parsed = parseJsonResponse<{ cells?: T[] }>(content);
    return parsed.cells ?? [];
  } catch (error: any) {
    throw new Error('Failed to parse JSON response: ' + error.message);
  }
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
  glossary?: Record<string, string>,
  context?: string,
): Promise<GridTranslationResult[]> {
  const prompt = buildGridPrompt({ expectedCells, output: 'cells', glossary, context });

  const response = await createChatCompletion(apiKey, {
    model: modelFor(openAiVersion),
    messages: [imageMessage(prompt, gridDataUrl)],
    response_format: { type: 'json_object' },
  }, '격자 번역');

  return parseCells<GridTranslationResult>(response?.choices?.[0]?.message?.content);
}

/**
 * 말풍선을 찾지 못한 페이지의 대체 경로: 페이지 전체를 보여주고 좌표까지 함께 받습니다.
 * 좌표는 모델 추정치라 정확도가 낮으므로, 격자 경로가 가능하면 그쪽을 씁니다.
 */
export async function translateFullPageOpenAI(
  openAiVersion: OpenAiVersion,
  apiKey: string,
  pageDataUrl: string,
  glossary?: Record<string, string>,
  context?: string,
): Promise<RawTranslationResult[]> {
  const prompt = buildFullPagePrompt({ output: 'cells', glossary, context });

  const response = await createChatCompletion(apiKey, {
    model: modelFor(openAiVersion),
    messages: [imageMessage(prompt, pageDataUrl)],
    response_format: { type: 'json_object' },
  }, '페이지 전체 번역');

  const cells = parseCells<RawTranslationResult>(response?.choices?.[0]?.message?.content);
  return sortMangaBoxesByTier(cells, c => c.box_2d);
}

/** 원문 한 문장만 다시 번역합니다. */
export async function retranslateTextOpenAI(
  openAiVersion: OpenAiVersion, apiKey: string, originalText: string, glossary?: Record<string, string>, context?: string): Promise<string> {
  const response = await createChatCompletion(apiKey, {
    model: modelFor(openAiVersion),
    messages: [{ role: 'user', content: buildRetranslatePrompt(originalText, { glossary, context }) }],
  }, '문장 재번역');

  return response?.choices?.[0]?.message?.content?.trim() || "번역 실패";
}

/** 지금까지의 번역으로 작품 노트(말투·호칭 기억)를 정리합니다. */
export async function summarizeWorkNotesOpenAI(
  openAiVersion: OpenAiVersion,
  apiKey: string,
  pairs: { original: string; translated: string }[],
  previousNotes?: string,
): Promise<string> {
  if (pairs.length === 0) return previousNotes?.trim() ?? '';

  const response = await createChatCompletion(apiKey, {
    model: modelFor(openAiVersion),
    messages: [{ role: 'user', content: buildWorkNotesPrompt(pairs, previousNotes) }],
  }, '작품 노트 정리');

  return response?.choices?.[0]?.message?.content?.trim() ?? '';
}
