/** 요미가나 표기 `漢字(かんじ)`에서 괄호 부분을 제거한 원문 */
export function stripFurigana(text: string): string {
  return text.replace(/\(([ぁ-んァ-ヶー]+)\)/g, '');
}

/**
 * 프롬프트에 붙이는 단어장 지시문.
 * sourceText를 주면 원문에 실제로 등장하는 항목만 넣어 토큰을 아낍니다. (이미지 번역처럼 원문을 미리 모르면 전체를 넣음)
 */
export function buildGlossaryInstruction(glossary: Record<string, string> | undefined, sourceText?: string): string {
  if (!glossary) return '';
  let entries = Object.entries(glossary).filter(([original, translated]) => original && translated);
  if (sourceText !== undefined) {
    const plain = stripFurigana(sourceText);
    entries = entries.filter(([original]) => plain.includes(original) || sourceText.includes(original));
  }
  if (entries.length === 0) return '';
  return `\n# Glossary (Translation Memory)\n해당 단어장이 제공된 경우, 원문에 아래 단어가 포함되어 있다면 반드시 단어장대로 번역해:\n${entries.map(([k, v]) => `- ${k} -> ${v}`).join('\n')}\n`;
}

/** 모델이 ```json 코드펜스로 감싸 응답해도 JSON으로 파싱합니다. */
export function parseJsonResponse<T = unknown>(text: string): T {
  let clean = text.trim();
  if (clean.startsWith('```json')) clean = clean.substring(7);
  else if (clean.startsWith('```')) clean = clean.substring(3);
  if (clean.endsWith('```')) clean = clean.substring(0, clean.length - 3);
  return JSON.parse(clean.trim()) as T;
}
