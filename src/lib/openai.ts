import type { TranslationResult } from './gemini';

export async function translateMangaImageOpenAI(
  apiKey: string, 
  geminiResults: TranslationResult[], 
  _geminiVersion: '3.6' | '3.7' = '3.6',
  glossary?: Record<string, string>
): Promise<TranslationResult[]> {
  
  if (geminiResults.length === 0) return [];

  // 사용자의 요청에 따라 Pro/Flash 구분 없이 gpt-5.6-terra 엔진을 사용합니다.
  const modelName = 'gpt-5.6-terra';
  
  // 구글이 뽑아준 원문을 인덱스와 함께 추출
  const textPayload = geminiResults.map((res, index) => ({
    id: index,
    original_text: res.original_text
  }));

  const glossaryInstruction = glossary && Object.keys(glossary).length > 0
    ? `\n# Glossary (Translation Memory)\n해당 단어장이 제공된 경우, 원문에 아래 단어가 포함되어 있다면 반드시 단어장대로 번역해:\n${Object.entries(glossary).map(([k, v]) => `- ${k} -> ${v}`).join('\n')}\n`
    : '';

  const prompt = `You are a professional manga translator with deep knowledge of Japanese culture, slang, and contextual nuances.
I will provide you with a JSON array of extracted Japanese text elements from a manga page. 
Your task is to translate the "original_text" of each element into highly natural, conversational Korean. 
Adapt the tone, emotion, idioms, and character speech styles to match a high-quality professional Korean webtoon or comic book.
${glossaryInstruction}
You MUST respond ONLY with a JSON object containing a single key "translations" which maps to an array of objects. 
Each object in the array MUST match this format:
{
  "id": [the exact same integer id from the input],
  "translated_text": "[your highly natural Korean translation]"
}`;

  let response;
  let retries = 3;
  while (retries > 0) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: 'system',
              content: prompt
            },
            {
              role: 'user',
              content: JSON.stringify(textPayload)
            }
          ],
          response_format: { type: 'json_object' }
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`OpenAI API Error ${res.status}: ${errorText}`);
      }
      
      response = await res.json();
      break;
    } catch (err: any) {
      if (err.message?.includes('502') || err.message?.includes('503') || err.message?.includes('429')) {
        retries--;
        if (retries === 0) throw err;
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        throw err;
      }
    }
  }

  const content = response?.choices?.[0]?.message?.content;
  if (!content) throw new Error("No response from OpenAI API");
  
  try {
    const parsed = JSON.parse(content);
    const translatedItems: { id: number, translated_text: string }[] = parsed.translations || [];

    // OpenAI의 번역 결과를 기존 Gemini의 좌표 데이터(원본 배열)에 병합
    const finalResults: TranslationResult[] = [...geminiResults];
    
    for (const item of translatedItems) {
      if (finalResults[item.id]) {
        finalResults[item.id].translated_text = item.translated_text;
      }
    }

    return finalResults;
  } catch (error: any) {
    throw new Error("Failed to parse JSON response: " + error.message);
  }
}

export async function retranslateTextOpenAI(apiKey: string, originalText: string, _geminiVersion: '3.6' | '3.7' = '3.6', glossary?: Record<string, string>): Promise<string> {
  const modelName = 'gpt-5.6-terra';
  
  const glossaryInstruction = glossary && Object.keys(glossary).length > 0
    ? `\n# Glossary (Translation Memory)\n해당 단어장이 제공된 경우, 원문에 아래 단어가 포함되어 있다면 반드시 단어장대로 번역해:\n${Object.entries(glossary).map(([k, v]) => `- ${k} -> ${v}`).join('\n')}\n`
    : '';

  const prompt = `You are a professional manga translator. Translate this specific Japanese text into highly natural, conversational Korean. Adapt the tone to match a high-quality Korean webtoon.
${glossaryInstruction}
Original text: ${originalText}

Respond ONLY with the translated Korean text string, nothing else. Do not include quotes or JSON formatting.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!res.ok) throw new Error(`OpenAI API Error`);
  const response = await res.json();
  return response?.choices?.[0]?.message?.content?.trim() || "번역 실패";
}
