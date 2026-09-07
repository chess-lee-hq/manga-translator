import { GoogleGenAI, Type } from '@google/genai';

export interface TranslationResult {
  original_text: string;
  translated_text: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized to 1000
  is_edited_box?: boolean;
  disable_keep_all?: boolean;
}

export async function translateMangaImage(apiKey: string, base64Image: string, mimeType: string, geminiVersion: '3.6' | '3.7' = '3.6', glossary?: Record<string, string>): Promise<TranslationResult[]> {
  const ai = new GoogleGenAI({ apiKey });
  
  const glossaryInstruction = glossary && Object.keys(glossary).length > 0
    ? `\n# Glossary (Translation Memory)\n해당 단어장이 제공된 경우, 원문에 아래 단어가 포함되어 있다면 반드시 단어장대로 번역해:\n${Object.entries(glossary).map(([k, v]) => `- ${k} -> ${v}`).join('\n')}\n`
    : '';

  const prompt = `# Role & Objective
너는 일본 만화 번역 및 시각 레이아웃 분석 전문가야. 
제공된 일본 만화 페이지 이미지에서 텍스트를 정확히 인식(OCR)하고, 자연스러운 한국어로 번역하여 지정된 순서대로 출력해.
${glossaryInstruction}
# Layout & Reading Order Rules (중요)
1. **일본 만화 읽기 순서 준수 (우→좌, 상→하)**:
   - 컷(Panel) 순서: 페이지의 **[오른쪽 위 → 왼쪽 위 → 오른쪽 아래 → 왼쪽 아래]** 흐름으로 번역해.
   - 컷 내부 말풍선 순서: 동일 컷 안에서도 **[우측 상단 말풍선 → 좌측/하단 말풍선]** 순서로 처리해.
2. **세로쓰기 인식**:
   - 세로로 적힌 일본어는 **[오른쪽 열에서 왼쪽 열로, 각 열은 위에서 아래로]** 읽어 하나의 문장으로 완성해.
   - 장음 부호(ー), 촉음(っ), 손글씨 오탈자를 문맥에 맞게 보정해.
3. **요소 분리 (Type Classification)**:
   - \`[대사]\`: 일반 말풍선, 생각 풍선, 내레이션 박스 속 텍스트.
   - \`[효과음]\`: 배경에 그려진 의성어/의태어(오노마토페).
   - \`[지문/배경]\`: 말풍선 밖 손글씨 츳코미, 간판, 배경 문자 등.

# Translation Guidelines
- 직역투를 피하고, 컷 속 인물의 표정과 상황에 어울리는 자연스러운 한국어 구어체로 번역해.
- 캐릭터의 말투(반말, 존댓말, 격식체, 비꼬는 말투 등)를 문맥에 맞게 살려줘.
- 효과음은 한국 만화 연출에 어울리는 의성어/의태어로 치환해 (예: ドキドキ → 두근두근).

# System Output Constraints (절대 규칙)
1. **Furigana**: 한자(Kanji) 뒤에는 반드시 괄호 안에 요미가나를 적어. 예: 漢字(かんじ). 히라가나/가타카나만 있는 경우는 적지 마.
2. **Exclude Dots**: 목차 등에 나오는 반복되는 점("..........")은 절대 인식하지도, 번역하지도 마.
3. **JSON Only**: 반드시 JSON 배열(Array) 형식으로만 응답해. 마크다운이나 다른 설명은 절대 추가하지 마.
4. **No Tags in Output**: 번역된 텍스트 앞에 [대사], [효과음] 등의 분류 태그를 절대 적지 마. (분류는 번역 톤을 정할 때만 속으로 참고해)
5. **JSON Schema**: 배열 안의 각 객체는 반드시 아래 3개의 key를 가져야 해.
  - "original_text": 요미가나가 포함된 일본어 원문.
  - "translated_text": 자연스러운 고품질 한국어 번역문 (태그 없이 번역된 내용만).
  - "box_2d": 텍스트를 감싸는 바운딩 박스. [ymin, xmin, ymax, xmax] 형식의 0~1000 사이 정수 배열.`;

  // 사용자가 선택한 제미나이 엔진 버전을 사용합니다.
  const modelName = geminiVersion === '3.7' ? 'gemini-3.7-flash' : 'gemini-3.6-flash';

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
      });
      break; // Success
    } catch (err: any) {
      let errMessage = err.message;
      if (typeof errMessage === 'string' && errMessage.includes('503')) {
        try {
          const parsed = JSON.parse(errMessage);
          if (parsed.error?.message) errMessage = parsed.error.message;
        } catch(e) {}
      }

      if (errMessage?.includes('503') || errMessage?.includes('UNAVAILABLE') || errMessage?.includes('high demand') || err.status === 503) {
        retries--;
        if (retries === 0) {
          throw new Error(`구글 서버 과부하 (503): 사용량이 너무 많습니다. 잠시 후 다시 시도해주세요. (${errMessage})`);
        }
        
        const waitTime = (4 - retries) * 3000; // 3s, 6s, 9s...
        console.warn(`503 Error (High Demand), retrying in ${waitTime/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw err; // Other errors (like 404) crash immediately
      }
    }
  }

  const text = response?.text;
  if (!text) throw new Error("No response from Gemini API");
  
  try {
    let cleanText = text.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.substring(7);
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.substring(3);
    }
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.substring(0, cleanText.length - 3);
    }
    cleanText = cleanText.trim();
    
    let translationResults: TranslationResult[] = JSON.parse(cleanText);

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

export async function retranslateTextGemini(apiKey: string, originalText: string, geminiVersion: '3.6' | '3.7' = '3.6', glossary?: Record<string, string>): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const modelName = geminiVersion === '3.7' ? 'gemini-3.7-flash' : 'gemini-3.6-flash';
  
  const glossaryInstruction = glossary && Object.keys(glossary).length > 0
    ? `\n# Glossary (Translation Memory)\n해당 단어장이 제공된 경우, 원문에 아래 단어가 포함되어 있다면 반드시 단어장대로 번역해:\n${Object.entries(glossary).map(([k, v]) => `- ${k} -> ${v}`).join('\n')}\n`
    : '';

  const prompt = `You are a professional manga translator. Translate this specific Japanese text into highly natural, conversational Korean. Adapt the tone to match a high-quality Korean webtoon.
${glossaryInstruction}
  
Original text: ${originalText}

Respond ONLY with the translated Korean text string, nothing else. Do not include quotes or JSON formatting.`;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: { temperature: 0.7 }
  });
  
  return response?.text?.trim() || "번역 실패";
}

export interface GridTranslationResult {
  id: number;
  original_text: string;
  translated_text: string;
}

export async function translateGridImage(
  apiKey: string, 
  fullBase64Image: string, 
  gridBase64Image: string, 
  mimeType: string, 
  expectedCells: number, 
  geminiVersion: '3.6' | '3.7' = '3.6', 
  glossary?: Record<string, string>
): Promise<GridTranslationResult[]> {
  const ai = new GoogleGenAI({ apiKey });
  
  const glossaryInstruction = glossary && Object.keys(glossary).length > 0
    ? `\n# Glossary (Translation Memory)\n해당 단어장이 제공된 경우, 원문에 아래 단어가 포함되어 있다면 반드시 단어장대로 번역해:\n${Object.entries(glossary).map(([k, v]) => `- ${k} -> ${v}`).join('\n')}\n`
    : '';

  const prompt = `# Role & Objective
너는 최고 수준의 일본 만화 번역가야.
두 장의 이미지를 첨부했어:
1. 원본 만화 페이지 전체 이미지 (문맥, 상황, 인물 표정 파악용)
2. 해당 페이지에서 대사가 있는 말풍선들만 네모나게 잘라내어 바둑판(Grid) 형태로 이어 붙인 크롭 이미지.

크롭 이미지의 각 칸(Cell) 왼쪽 위에는 빨간색 글씨로 고유 번호(예: #1, #2)가 적혀 있어.
너의 임무는 원본 이미지를 통해 상황을 파악한 뒤, 크롭 이미지의 각 칸에 적힌 텍스트를 정확히 인식(OCR)하고 한국어로 번역하는 거야.
${glossaryInstruction}
# Translation Guidelines
- 직역을 피하고, 원본 이미지의 인물 표정과 상황에 어울리는 한국어 구어체로 번역해.
- 캐릭터의 말투를 문맥에 맞게 살려줘.
- 세로쓰기 텍스트는 오른쪽 열에서 왼쪽 열로, 각 열은 위에서 아래로 읽어 하나의 문장으로 완성해.
- 한자(Kanji) 뒤에는 괄호 안에 요미가나를 적어.

# System Output Constraints (절대 규칙)
1. **JSON Only**: 반드시 JSON 배열(Array) 형식으로만 응답해.
2. **JSON Schema**: 배열 안의 각 객체는 반드시 아래 3개의 key를 가져야 해.
  - "id": 크롭 이미지에 적힌 빨간색 번호 (숫자형). 1부터 ${expectedCells}까지 빠짐없이 출력해.
  - "original_text": 일본어 원문 (단어장이나 원문 확인용).
  - "translated_text": 자연스러운 한국어 번역문.
  
결과 JSON 배열의 길이는 정확히 ${expectedCells}개여야 해. 빈 칸이더라도 빈 문자열("")을 넣어서라도 맞춰.`;

  const modelName = geminiVersion === '3.7' ? 'gemini-3.7-flash' : 'gemini-3.6-flash';

  let response;
  let retries = 3;
  while (retries > 0) {
    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents: [
          { role: 'user', parts: [
            { text: prompt },
            { inlineData: { data: fullBase64Image, mimeType } },
            { inlineData: { data: gridBase64Image, mimeType: 'image/jpeg' } }
          ]}
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.INTEGER },
                original_text: { type: Type.STRING },
                translated_text: { type: Type.STRING }
              },
              required: ['id', 'original_text', 'translated_text']
            }
          },
          temperature: 0.35,
        }
      });
      break; 
    } catch (err: any) {
      let errMessage = err.message || err.toString();
      if (errMessage?.includes('503') || errMessage?.includes('UNAVAILABLE') || errMessage?.includes('high demand') || err.status === 503) {
        retries--;
        if (retries === 0) throw new Error(`구글 서버 과부하 (503). 잠시 후 다시 시도해주세요.`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        throw err;
      }
    }
  }

  const text = response?.text;
  if (!text) throw new Error("No response from Gemini API");
  
  try {
    let cleanText = text.trim();
    if (cleanText.startsWith('\`\`\`json')) cleanText = cleanText.substring(7);
    else if (cleanText.startsWith('\`\`\`')) cleanText = cleanText.substring(3);
    if (cleanText.endsWith('\`\`\`')) cleanText = cleanText.substring(0, cleanText.length - 3);
    cleanText = cleanText.trim();
    
    let results: GridTranslationResult[] = JSON.parse(cleanText);
    return results;
  } catch (error: any) {
    throw new Error("Failed to parse JSON response: " + error.message);
  }
}
