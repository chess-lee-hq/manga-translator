import { GoogleGenAI, Type } from '@google/genai';
import { sortMangaBoxesByTier } from './readingOrder';
import { buildGlossaryInstruction, parseJsonResponse } from './prompt';
import { toFriendlyError, withRetry } from './retry';

export interface TranslationResult {
  id: string;
  original_text: string;
  translated_text: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized to 1000
  is_edited_box?: boolean;
  disable_keep_all?: boolean;
  /** 덮어쓰기 표시 방식. cover: 원문을 흰 말풍선으로 덮음 / tag: 원문은 두고 바깥에 작은 딱지 / 없으면 자동 판별 */
  display_mode?: 'cover' | 'tag';
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
async function generateContent(apiKey: string, request: GenerateContentRequest) {
  const ai = new GoogleGenAI({ apiKey });
  try {
    return await withRetry(() => ai.models.generateContent(request), {
      onRetry: ({ attempt, delayMs, error }) => {
        console.warn(`Gemini 요청 재시도 ${attempt}회 (${Math.round(delayMs / 1000)}초 후):`, (error as Error)?.message ?? error);
      },
    });
  } catch (error) {
    throw toFriendlyError(error, 'Gemini');
  }
}

export async function translateMangaImage(apiKey: string, base64Image: string, mimeType: string, geminiVersion: GeminiVersion = '3.6', glossary?: Record<string, string>, context?: string): Promise<RawTranslationResult[]> {
  const glossaryInstruction = buildGlossaryInstruction(glossary);

  const prompt = `# Role & Objective
너는 일본 만화 번역 및 시각 레이아웃 분석 전문가야.
제공된 일본 만화 페이지 이미지에서 텍스트를 정확히 인식(OCR)하고, 자연스러운 한국어로 번역하여 지정된 순서대로 출력해.
${glossaryInstruction}${context ?? ''}
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
  });

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
  // 원문이 정해져 있으므로 실제로 등장하는 단어장 항목만 넣음
  const glossaryInstruction = buildGlossaryInstruction(glossary, originalText);

  const prompt = `You are a professional manga translator. Translate this specific Japanese text into highly natural, conversational Korean. Adapt the tone to match a high-quality Korean webtoon.
${glossaryInstruction}${context ?? ''}

Original text: ${originalText}

Respond ONLY with the translated Korean text string, nothing else. Do not include quotes or JSON formatting.`;

  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
    contents: prompt,
    config: { temperature: 0.7 }
  });

  return response.text?.trim() || "번역 실패";
}

export async function translateGridImage(
  apiKey: string,
  fullBase64Image: string,
  gridBase64Image: string,
  mimeType: string,
  expectedCells: number,
  geminiVersion: GeminiVersion = '3.6',
  glossary?: Record<string, string>,
  context?: string,
): Promise<GridTranslationResult[]> {
  const glossaryInstruction = buildGlossaryInstruction(glossary);

  const prompt = `# Role & Objective
너는 최고 수준의 일본 만화 번역가야.
두 장의 이미지를 첨부했어:
1. 원본 만화 페이지 전체 이미지 (문맥, 상황, 인물 표정 파악용)
2. 해당 페이지에서 대사가 있는 말풍선들만 네모나게 잘라내어 바둑판(Grid) 형태로 이어 붙인 크롭 이미지.

크롭 이미지의 각 칸(Cell) 왼쪽 위에는 빨간색 글씨로 고유 번호(예: #1, #2)가 적혀 있어.
너의 임무는 원본 이미지를 통해 상황을 파악한 뒤, 크롭 이미지의 각 칸에 적힌 텍스트를 정확히 인식(OCR)하고 한국어로 번역하는 거야.
${glossaryInstruction}${context ?? ''}
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

  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
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

  const prompt = `너는 만화 번역 감수자야. 아래는 같은 작품에서 지금까지 번역한 대사들이야.
다음 페이지를 번역할 때 말투와 표기를 일관되게 유지할 수 있도록 "작품 노트"를 한국어로 정리해.

# 규칙
- 500자 이내, 불릿(-) 목록으로만 작성.
- 항목: 등장인물별 말투(반말/존댓말, 거친지 정중한지, 특징적인 어미), 인물 간 호칭, 반복되는 고유명사의 한국어 표기, 작품 전반의 톤.
- 대사에서 확인되는 내용만 적어. 추측은 적지 마.
- 설명이나 머리말 없이 노트 본문만 출력해.
${previousNotes?.trim() ? `\n# 기존 노트 (새 대사를 반영해 갱신해)\n${previousNotes.trim()}\n` : ''}
# 지금까지의 대사 (원문 → 번역)
${pairs.map(p => `- ${p.original || '(원문 없음)'} → ${p.translated}`).join('\n')}`;

  const response = await generateContent(apiKey, {
    model: modelNameFor(geminiVersion),
    contents: prompt,
    config: { temperature: 0.2 },
  });
  return response.text?.trim() ?? '';
}
