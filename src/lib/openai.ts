import type { RawTranslationResult } from './gemini';
import { buildGlossaryInstruction, parseJsonResponse } from './prompt';
import { toFriendlyError, withRetry } from './retry';

type OpenAiVersion = 'sol' | 'terra';
type HttpError = Error & { status?: number; retryAfterMs?: number };

/** Chat Completions 호출. 429·5xx는 Retry-After 헤더를 존중하며 재시도하고, 최종 실패는 안내 메시지로 바꿉니다. */
async function createChatCompletion(apiKey: string, body: Record<string, unknown>): Promise<any> {
  try {
    return await withRetry(async () => {
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
  } catch (error) {
    throw toFriendlyError(error, 'OpenAI');
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
  });

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
  });

  return response?.choices?.[0]?.message?.content?.trim() || "번역 실패";
}
