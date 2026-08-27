import { GoogleGenAI } from '@google/genai';

export interface TranslationResult {
  original_text: string;
  translated_text: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized to 1000
}

export async function translateMangaImage(apiKey: string, base64Image: string, mimeType: string, aiModel: 'flash' | 'pro' = 'flash'): Promise<TranslationResult[]> {
  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `You are a professional manga translator with deep knowledge of Japanese culture, slang, and contextual nuances.
Analyze the provided manga page image and do the following:
1. Find all text bubbles and text elements containing Japanese.
2. Accurately transcribe the original Japanese text. **IMPORTANT**: For Kanji, you MUST include furigana in parentheses immediately after the Kanji, like this: 漢字(かんじ). Do not add parentheses for pure hiragana/katakana.
3. Translate the text into highly natural, conversational Korean. Adapt the tone, emotion, idioms, and character speech styles to match a high-quality professional Korean webtoon or comic book.
4. Provide the bounding box for each text element.
5. **IMPORTANT**: You must strictly sort the detected text elements according to these traditional manga reading rules:
   - Rule 1 (Panel Order): Manga panels are read from Right to Left as the primary direction, and then Top to Bottom. You must process the panels in this exact sequence.
   - Rule 2 (Text Order within Panel): Inside each panel, text bubbles are read from Top-Right to Bottom-Left.
   Always group text bubbles by their visually containing panel first, and then sort them internally using Rule 2.
6. **IMPORTANT**: Completely ignore and exclude repetitive formatting dots (leader dots, ellipses like "..........") often found in table of contents. Do not extract or translate them, and do not include them in bounding boxes.

Respond ONLY with a JSON array of objects. Each object must exactly match this format:
- "original_text": the original Japanese text with furigana in parentheses.
- "translated_text": the highly natural Korean translation.
- "box_2d": the bounding box as [ymin, xmin, ymax, xmax] where values are integers from 0 to 1000. 
Make sure the bounding box tightly surrounds the text.`;

  // 구글 API가 에러 메시지로 직접 지정해준 완벽하게 호환되는 버전으로 최종 세팅합니다.
  const modelName = aiModel === 'pro' ? 'gemini-3.1-pro-preview' : 'gemini-3.6-flash';

  let response;
  let retries = 3;
  while (retries > 0) {
    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents: [
          { role: 'user', parts: [
            { text: prompt },
            { inlineData: { data: base64Image, mimeType } }
          ]}
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.35,
        }
      });
      break; // Success
    } catch (err: any) {
      if (err.message?.includes('503') || err.message?.includes('UNAVAILABLE') || err.status === 503) {
        retries--;
        if (retries === 0) throw err;
        console.warn('503 Error, retrying in 2 seconds...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        throw err; // Other errors (like 404) crash immediately
      }
    }
  }

  const text = response?.text;
  if (!text) throw new Error("No response from Gemini API");
  
  try {
    let translationResults: TranslationResult[] = JSON.parse(text);

    // 프론트엔드에서 한 번 더 완벽한 일본 만화 읽는 순서로 정렬합니다.
    translationResults.sort((a, b) => {
      const [a_ymin, a_xmin, a_ymax, a_xmax] = a.box_2d;
      const [b_ymin, b_xmin, b_ymax, b_xmax] = b.box_2d;
      
      const a_cy = (a_ymin + a_ymax) / 2;
      const b_cy = (b_ymin + b_ymax) / 2;
      const a_cx = (a_xmin + a_xmax) / 2;
      const b_cx = (b_xmin + b_xmax) / 2;

      // 1. 세로 단(Tier) 구분: Y축 중심점 차이가 크면 다른 단락으로 간주 (위에서 아래로)
      const y_diff = Math.abs(a_cy - b_cy);
      const TIER_THRESHOLD = 250; // 1000 기준 250 이상이면 다른 단락

      if (y_diff > TIER_THRESHOLD) {
        return a_cy - b_cy; // 상단 먼저
      } else {
        // 2. 같은 단락 내에서는 우측에서 좌측으로
        const x_diff = Math.abs(a_cx - b_cx);
        // 만약 X 좌표가 비슷하다면(같은 칸 내부), 위에서 아래로
        if (x_diff > 100) {
          return b_cx - a_cx; // 우측 먼저
        } else {
          return a_cy - b_cy; // 상단 먼저
        }
      }
    });

    return translationResults;
  } catch (error: any) {
    throw new Error("Failed to parse JSON response: " + error.message);
  }
}

export async function retranslateTextGemini(apiKey: string, originalText: string, aiModel: 'flash' | 'pro' = 'flash'): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  // 부분 재번역 시에는 기존에 문제없이 작동했던 3.6 플래시 모델로 복구합니다.
  const modelName = aiModel === 'pro' ? 'gemini-3.1-pro-preview' : 'gemini-3.6-flash';
  
  const prompt = `You are a professional manga translator. Translate this specific Japanese text into highly natural, conversational Korean. Adapt the tone to match a high-quality Korean webtoon.
  
Original text: ${originalText}

Respond ONLY with the translated Korean text string, nothing else. Do not include quotes or JSON formatting.`;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: { temperature: 0.7 }
  });
  
  return response?.text?.trim() || "번역 실패";
}
