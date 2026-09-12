import { buildGlossaryInstruction } from './prompt';

/**
 * 번역 지침·단어장·앞 페이지 맥락을 한곳에서 만듭니다.
 * OpenAI(주력)와 Gemini(보조) 어느 엔진을 쓰더라도 같은 규칙·같은 단어장·같은 맥락이 적용되도록,
 * 프롬프트 본문은 반드시 이 모듈을 거쳐 만듭니다.
 */

/** 일본 만화 원문을 읽는 규칙 (OCR 공통) */
export const READING_RULES = `# 원문 읽기 규칙
- 세로쓰기 텍스트는 오른쪽 열에서 왼쪽 열로, 각 열은 위에서 아래로 읽어 하나의 문장으로 완성해.
- 장음 부호(ー), 촉음(っ), 손글씨 특유의 흘림이나 오탈자는 문맥에 맞게 보정해.
- 한자(Kanji) 뒤에는 괄호 안에 요미가나를 적어. 예: 漢字(かんじ)
- 이어지는 점("……")은 무시해.`;

/** 한국어 번역 지침 (번역 공통) */
export const TRANSLATION_RULES = `# 번역 지침
- 직역을 피하고, 인물의 표정과 상황에 어울리는 자연스러운 한국어 구어체로 번역해.
- 캐릭터의 말투(반말/존댓말, 거친 말투, 특징적인 어미)를 일관되게 살려.
- 한국 정식 출판 만화·웹툰 수준의 문장으로 다듬어.
- 효과음(의성어·의태어)은 한국 만화에 어울리는 표현으로 바꿔. 예: ドキドキ → 두근두근
- 번역문에 [대사]·[효과음] 같은 분류 태그는 절대 넣지 마. (톤을 정할 때만 속으로 참고)`;

export interface PromptContextOptions {
  glossary?: Record<string, string>;
  /** 앞 페이지 대사·작품 노트로 만든 맥락 지시문 */
  context?: string;
  /** 원문을 미리 아는 경우(텍스트 재번역 등). 주면 원문에 등장하는 단어장 항목만 넣어 토큰을 아낌 */
  sourceText?: string;
}

/** 단어장 + 앞 페이지 맥락. 엔진과 무관하게 같은 내용이 들어갑니다. */
export function buildSharedContext({ glossary, context, sourceText }: PromptContextOptions): string {
  return `${buildGlossaryInstruction(glossary, sourceText)}${context ?? ''}`;
}

export interface GridPromptOptions extends PromptContextOptions {
  /** 격자 이미지의 칸 수 */
  expectedCells: number;
  /** 격자 외에 원본 페이지 전체 이미지도 함께 보내는 경우 (Gemini 보조 모드) */
  withFullPage?: boolean;
  /**
   * 응답 형식. Gemini는 responseSchema로 배열을 강제할 수 있고,
   * OpenAI는 json_object만 강제되므로 "cells" 키로 감싸 받습니다.
   */
  output: 'array' | 'cells';
}

/** 말풍선 격자 이미지를 읽고 번역하도록 요청하는 프롬프트 */
export function buildGridPrompt({ expectedCells, withFullPage = false, output, ...contextOptions }: GridPromptOptions): string {
  const images = withFullPage
    ? `두 장의 이미지를 첨부했어:
1. 원본 만화 페이지 전체 이미지 (문맥·상황·인물 표정 파악용)
2. 그 페이지에서 대사가 있는 말풍선만 네모나게 잘라내어 바둑판(Grid) 형태로 이어 붙인 크롭 이미지`
    : `첨부한 이미지는 만화 페이지에서 대사가 있는 말풍선만 네모나게 잘라내어 바둑판(Grid) 형태로 이어 붙인 크롭 이미지야.`;

  const outputRule = output === 'array'
    ? `반드시 JSON 배열(Array)로만 응답해. 배열의 각 객체는 아래 3개 key를 가져야 해.`
    : `반드시 "cells" 하나만 key로 가지는 JSON 객체로 응답하고, 그 값은 배열이어야 해. 배열의 각 객체는 아래 3개 key를 가져야 해.`;

  return `# 역할
너는 최고 수준의 일본 만화 번역가야. 원문을 정확히 읽고(OCR) 한국어로 번역해.

${images}
크롭 이미지의 각 칸(Cell) 왼쪽 위에는 빨간색 글씨로 고유 번호(예: #1, #2)가 적혀 있어.

${READING_RULES}

${TRANSLATION_RULES}
${buildSharedContext(contextOptions)}
# 출력 형식 (절대 규칙)
${outputRule}
- "id": 칸에 적힌 빨간색 번호 (숫자형)
- "original_text": 일본어 원문
- "translated_text": 자연스러운 한국어 번역문
1번부터 ${expectedCells}번까지 빠짐없이, 정확히 ${expectedCells}개를 순서대로 출력해. 글자가 없는 칸은 빈 문자열("")로 둬.
설명·머리말 없이 JSON만 출력해.`;
}

/** 말풍선을 찾지 못해 페이지 전체를 읽어야 할 때 쓰는 프롬프트 (좌표까지 모델이 찍어야 함) */
export function buildFullPagePrompt(options: PromptContextOptions & { output: 'array' | 'cells' }): string {
  const { output, ...contextOptions } = options;
  const outputRule = output === 'array'
    ? `반드시 JSON 배열(Array)로만 응답해.`
    : `반드시 "cells" 하나만 key로 가지는 JSON 객체로 응답하고, 그 값은 배열이어야 해.`;

  return `# 역할
너는 최고 수준의 일본 만화 번역가야. 첨부한 만화 페이지에서 글자가 있는 모든 영역을 찾아 원문을 읽고(OCR) 한국어로 번역해.

${READING_RULES}

${TRANSLATION_RULES}
${buildSharedContext(contextOptions)}
# 읽는 순서 (일본 만화: 우→좌, 상→하)
- 컷(Panel) 순서: [오른쪽 위 → 왼쪽 위 → 오른쪽 아래 → 왼쪽 아래]
- 같은 컷 안에서는 [우측 상단 말풍선 → 좌측·하단 말풍선] 순서
- 목차 등에 나오는 반복되는 점("……")은 인식·번역하지 마.

# 출력 형식 (절대 규칙)
${outputRule} 각 객체는 아래 3개 key를 가져야 해.
- "box_2d": 글자 영역의 좌표 [ymin, xmin, ymax, xmax]. 페이지 왼쪽 위를 0, 오른쪽 아래를 1000으로 보는 정규화 좌표(정수).
- "original_text": 일본어 원문
- "translated_text": 자연스러운 한국어 번역문
설명·머리말 없이 JSON만 출력해.`;
}

/** 한 문장만 다시 번역할 때 쓰는 프롬프트 */
export function buildRetranslatePrompt(originalText: string, options: PromptContextOptions = {}): string {
  return `# 역할
너는 최고 수준의 일본 만화 번역가야. 아래 일본어 대사 한 줄을 한국어로 번역해.

${TRANSLATION_RULES}
${buildSharedContext({ ...options, sourceText: originalText })}
# 원문
${originalText}

번역문만 출력해. 따옴표·JSON·설명은 넣지 마.`;
}

/** 작품 노트(말투·호칭 기억)를 정리할 때 쓰는 프롬프트 */
export function buildWorkNotesPrompt(pairs: { original: string; translated: string }[], previousNotes?: string): string {
  return `너는 만화 번역 감수자야. 아래는 같은 작품에서 지금까지 번역한 대사들이야.
다음 페이지를 번역할 때 말투와 표기를 일관되게 유지할 수 있도록 "작품 노트"를 한국어로 정리해.

# 규칙
- 500자 이내, 불릿(-) 목록으로만 작성.
- 항목: 등장인물별 말투(반말/존댓말, 거친지 정중한지, 특징적인 어미), 인물 간 호칭, 반복되는 고유명사의 한국어 표기, 작품 전반의 톤.
- 대사에서 확인되는 내용만 적어. 추측은 적지 마.
- 설명이나 머리말 없이 노트 본문만 출력해.
${previousNotes?.trim() ? `\n# 기존 노트 (새 대사를 반영해 갱신해)\n${previousNotes.trim()}\n` : ''}
# 지금까지의 대사 (원문 → 번역)
${pairs.map(p => `- ${p.original || '(원문 없음)'} → ${p.translated}`).join('\n')}`;
}
