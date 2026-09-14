import { describe, expect, it } from 'vitest';
import { filterCandidates, mergeCandidates, parseWorkNotesResponse } from './glossaryCandidates';

describe('parseWorkNotesResponse', () => {
  it('JSON 응답에서 노트와 후보를 꺼낸다', () => {
    const r = parseWorkNotesResponse('{"notes":"- 료: 반말","glossary":[{"original":"雷神流","translated":"뇌신류"},{"bad":1}]}');
    expect(r).toEqual({ notes: '- 료: 반말', glossary: [{ original: '雷神流', translated: '뇌신류' }] });
  });

  it('코드펜스로 감싼 JSON도 읽는다', () => {
    expect(parseWorkNotesResponse('```json\n{"notes":"- 노트","glossary":[]}\n```').notes).toBe('- 노트');
  });

  it('JSON이 아니면 응답 전체를 노트로 쓰고 후보는 없다 (예전 형식 호환)', () => {
    expect(parseWorkNotesResponse('- 주인공: 반말\n- 스승: 존댓말')).toEqual({ notes: '- 주인공: 반말\n- 스승: 존댓말', glossary: [] });
  });
});

describe('filterCandidates', () => {
  const originals = ['雷神流の奥義だ', '雷神流(らいじんりゅう)を使え', 'リョウ、行くぞ', 'リョウ！', 'たった一度の技'];

  it('대사에 2번 이상 나온 일본어 용어만 남기고 요미가나는 뗀다', () => {
    const result = filterCandidates(
      [
        { original: '雷神流(らいじんりゅう)', translated: '뇌신류' },
        { original: 'リョウ', translated: '료' },
        { original: '奥義', translated: '오의' },         // 1번만 등장
        { original: '宇宙戦艦', translated: '우주전함' },  // 대사에 없음 (지어낸 용어)
      ],
      originals, {}, [],
    );
    expect(result).toEqual([{ original: '雷神流', translated: '뇌신류' }, { original: 'リョウ', translated: '료' }]);
  });

  it('이미 단어장에 있거나 무시한 원문, 형식이 이상한 후보는 뺀다', () => {
    const result = filterCandidates(
      [
        { original: '雷神流', translated: '뇌신류' },
        { original: 'リョウ', translated: '료' },
        { original: 'リョウ', translated: 'Ryo' },   // 한글 없음
        { original: '雷', translated: '뇌' },         // 한 글자
      ],
      originals, { 雷神流: '뇌신류' }, ['リョウ'],
    );
    expect(result).toEqual([]);
  });
});

describe('mergeCandidates', () => {
  it('같은 원문은 새 번역으로 바꾸고, 단어장·무시 목록에 들어간 건 뺀다', () => {
    const merged = mergeCandidates(
      [{ original: 'リョウ', translated: '료' }, { original: '雷神流', translated: '라이진류' }],
      [{ original: '雷神流', translated: '뇌신류' }, { original: '師匠', translated: '스승님' }],
      { リョウ: '료' }, ['師匠'],
    );
    expect(merged).toEqual([{ original: '雷神流', translated: '뇌신류' }]);
  });
});
