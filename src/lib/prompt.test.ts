import { describe, expect, it } from 'vitest';
import { buildGlossaryInstruction, parseJsonResponse, stripFurigana } from './prompt';

describe('buildGlossaryInstruction', () => {
  const glossary = { 'センゴク': '센고쿠', '戦国武将': '전국무장', '織田': '오다' };

  it('단어장이 비어 있으면 빈 문자열', () => {
    expect(buildGlossaryInstruction(undefined)).toBe('');
    expect(buildGlossaryInstruction({})).toBe('');
  });

  it('원문을 모르면 전체 항목을 넣는다', () => {
    const text = buildGlossaryInstruction(glossary);
    expect(text).toContain('- センゴク -> 센고쿠');
    expect(text).toContain('- 織田 -> 오다');
  });

  it('원문을 주면 등장하는 항목만 넣고, 요미가나가 끼어 있어도 찾는다', () => {
    const text = buildGlossaryInstruction(glossary, '戦国(せんごく)武将(ぶしょう)が来た');
    expect(text).toContain('戦国武将');
    expect(text).not.toContain('センゴク');
    expect(text).not.toContain('織田');
  });

  it('등장하는 항목이 없으면 빈 문자열', () => {
    expect(buildGlossaryInstruction(glossary, 'こんにちは')).toBe('');
  });
});

describe('stripFurigana / parseJsonResponse', () => {
  it('요미가나를 제거한다', () => {
    expect(stripFurigana('漢字(かんじ)です')).toBe('漢字です');
  });

  it('코드펜스를 벗겨 JSON을 파싱한다', () => {
    expect(parseJsonResponse('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
    expect(parseJsonResponse(' {"b":2} ')).toEqual({ b: 2 });
  });
});
