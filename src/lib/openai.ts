import type { GridTranslationResult, RawTranslationResult } from './gemini';
import { buildGlossaryInstruction, parseJsonResponse } from './prompt';
import { toFriendlyError, withRetry } from './retry';
import { recordUsage } from './usageLog';

type OpenAiVersion = 'sol' | 'terra';
type HttpError = Error & { status?: number; retryAfterMs?: number };

/** Chat Completions 호출. 429·5xx는 Retry-After 헤더를 존중하며 재시도하고, 최종 실패는 안내 메시지로 바꿉니다. */
async function createChatCompletion(apiKey: string, body: Record<string, unknown>, label = '요청'): Promise<any> {
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

/**
 * [실험] 말풍선 격자 이미지를 OpenAI에게 직접 보여주고 원문 인식(OCR)과 번역을 한 번에 맡깁니다.
 * Gemini를 거치지 않는 경로라서, 비교 테스트가 끝나면 채택 여부에 따라 이 함수를 정식화하거나 삭제합니다.
 */
export async function translateGridImageOpenAI(
  openAiVersion: OpenAiVersion,
  apiKey: string,
  gridDataUrl: string,
  expectedCells: number,
  glossary?: Record<string, string>,
  context?: string,
): Promise<GridTranslationResult[]> {
  // 원문을 아직 모르므로 단어장은 전체를 넣음
  const glossaryInstruction = buildGlossaryInstruction(glossary);

  const prompt = `You are a professional manga translator and an expert at reading Japanese comic lettering.
The attached image is a grid: each cell is a speech bubble cropped from one manga page, stitched together.
Each cell has a red index number (e.g. #1, #2) printed at its top-left corner.
For every cell, read the Japanese text exactly, then translate it into highly natural, conversational Korean.
${glossaryInstruction}${context ?? ''}
# Reading rules
- Vertical text runs right-to-left by column, top-to-bottom within a column; join it into one sentence.
- Correct hand-lettering quirks (long vowel ー, small tsu っ) using context.
- After a kanji, add its reading in parentheses. Example: 漢字(かんじ)
- Ignore runs of dots ("……").

# Translation rules
- Avoid literal translation; match the character's tone and the mood of the scene, like a professional Korean comic.

# Output constraints
Respond ONLY with a JSON object having a single key "cells" mapping to an array of objects:
{ "id": [the red index number as an integer], "original_text": "[Japanese source text]", "translated_text": "[natural Korean translation]" }
The array MUST contain exactly ${expectedCells} objects, ids 1 through ${expectedCells}, in order. For a cell with no readable text use empty strings.`;

  const response = await createChatCompletion(apiKey, {
    model: `gpt-5.6-${openAiVersion}`,
    messages: [
      { role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: gridDataUrl, detail: 'high' } },
      ] },
    ],
    response_format: { type: 'json_object' },
  }, '격자 비전 인식+번역');

  const content = response?.choices?.[0]?.message?.content;
  if (!content) throw new Error('No response from OpenAI API');

  try {
    const parsed = parseJsonResponse<{ cells?: GridTranslationResult[] }>(content);
    return parsed.cells ?? [];
  } catch (error: any) {
    throw new Error('Failed to parse JSON response: ' + error.message);
  }
}

export async function translateMangaImageOpenAI(
  openAiVersion: OpenAiVersion,
  apiKey: string,
  geminiResults: RawTranslationResult[],
  glossary?: Record<string, string>,
  context?: string,
): Promise<RawTranslationResult[]> {

  if (geminiResults.length === 0) return [];

  const modelName = `gpt-5.6-${openAiVersion}`;

  // 구글이 뽑아준 원문을 인덱스와 함께 추출
  const textPayload = geminiResults.map((res, index) => ({
    id: index,
    original_text: res.original_text
  }));

  // 원문이 정해져 있으므로 실제로 등장하는 단어장 항목만 넣음
  const glossaryInstruction = buildGlossaryInstruction(glossary, geminiResults.map(r => r.original_text).join('\n'));

  const prompt = `You are a professional manga translator with deep knowledge of Japanese culture, slang, and contextual nuances.
I will provide you with a JSON array of extracted Japanese text elements from a manga page.
Your task is to translate the "original_text" of each element into highly natural, conversational Korean.
Adapt the tone, emotion, idioms, and character speech styles to match a high-quality professional Korean webtoon or comic book.
${glossaryInstruction}${context ?? ''}
You MUST respond ONLY with a JSON object containing a single key "translations" which maps to an array of objects.
Each object in the array MUST match this format:
{
  "id": [the exact same integer id from the input],
  "translated_text": "[your highly natural Korean translation]"
}`;

  const response = await createChatCompletion(apiKey, {
    model: modelName,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify(textPayload) }
    ],
    response_format: { type: 'json_object' }
  }, '원문 번역');

  const content = response?.choices?.[0]?.message?.content;
  if (!content) throw new Error("No response from OpenAI API");

  try {
    const parsed = parseJsonResponse<{ translations?: { id: number, translated_text: string }[] }>(content);
    const translatedItems = parsed.translations || [];

    // OpenAI의 번역 결과를 기존 Gemini의 좌표 데이터(원본 배열)에 병합
    return geminiResults.map((result, idx) => {
      const translated = translatedItems.find(item => item.id === idx);
      return translated ? { ...result, translated_text: translated.translated_text } : { ...result };
    });
  } catch (error: any) {
    throw new Error("Failed to parse JSON response: " + error.message);
  }
}

export async function retranslateTextOpenAI(
  openAiVersion: OpenAiVersion, apiKey: string, originalText: string, glossary?: Record<string, string>, context?: string): Promise<string> {
  const modelName = `gpt-5.6-${openAiVersion}`;
  const glossaryInstruction = buildGlossaryInstruction(glossary, originalText);

  const prompt = `You are a professional manga translator. Translate this specific Japanese text into highly natural, conversational Korean. Adapt the tone to match a high-quality Korean webtoon.
${glossaryInstruction}${context ?? ''}
Original text: ${originalText}

Respond ONLY with the translated Korean text string, nothing else. Do not include quotes or JSON formatting.`;

  const response = await createChatCompletion(apiKey, {
    model: modelName,
    messages: [
      { role: 'user', content: prompt }
    ]
  }, '문장 재번역');

  return response?.choices?.[0]?.message?.content?.trim() || "번역 실패";
}
