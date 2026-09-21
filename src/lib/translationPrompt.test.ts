import { describe, expect, it } from 'vitest';
import { buildGridPrompt, buildShortenPrompt, READING_RULES } from './translationPrompt';

describe('원문 읽기 규칙', () => {
  it('요미가나를 만들어 붙이라고 요구하지 않고, 인쇄된 루비는 빼라고 지시한다', () => {
    expect(READING_RULES).not.toContain('요미가나를 적어');
    expect(READING_RULES).toContain('루비');
    expect(buildGridPrompt({ expectedCells: 1 })).not.toContain('漢字(かんじ)');
  });
});

describe('짧게 다시 번역 프롬프트', () => {
  it('목표 글자 수·지금 번역문·원문과 말투 유지 지시를 담는다', () => {
    const prompt = buildShortenPrompt('本気で言ってるのか', '진심으로 하는 말이야?', 8, { glossary: { 本気: '진심' } });
    expect(prompt).toContain('8자 이내');
    expect(prompt).toContain('진심으로 하는 말이야?');
    expect(prompt).toContain('本気で言ってるのか');
    expect(prompt).toContain('말투');
    expect(prompt).toContain('本気 -> 진심');
  });
});

describe('프롬프트 캐시 구간 (순서가 곧 비용)', () => {
  const base = { glossary: { 拳王: '권왕' }, context: '## 작품 노트\n- 주인공은 반말' };
  const pageA = buildGridPrompt({ ...base, expectedCells: 10, speakerHint: '- 같은 컷: #1 / #2', recentContext: '## 직전까지의 번역\n- あ → 가' });
  const pageB = buildGridPrompt({ ...base, expectedCells: 7, speakerHint: '- 같은 인물: #3·#4', recentContext: '## 직전까지의 번역\n- い → 나' });

  const commonPrefix = (a: string, b: string) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return a.slice(0, i);
  };

  it('페이지가 달라도 규칙·단어장·작품 노트까지는 완전히 같은 앞부분을 공유한다', () => {
    const shared = commonPrefix(pageA, pageB);
    expect(shared).toContain('# 역할');
    expect(shared).toContain('원문 읽기 규칙');
    expect(shared).toContain('번역 지침');
    expect(shared).toContain('拳王 -> 권왕');
    expect(shared).toContain('- 주인공은 반말');
    // 캐시는 넉넉한 길이의 동일 구간이 있어야 걸린다
    expect(shared.length).toBeGreaterThan(900);
  });

  it('요청마다 바뀌는 것(화자 힌트·직전 대사·칸 수)은 모두 공통 구간 뒤에 온다', () => {
    const shared = commonPrefix(pageA, pageB);
    for (const volatilePart of ['같은 컷', '직전까지의 번역', '정확히 10개']) {
      expect(pageA).toContain(volatilePart);
      expect(shared).not.toContain(volatilePart);
    }
  });

  it('단어장이 바뀌어도 그 앞의 고정 구간은 그대로 유지된다', () => {
    const other = buildGridPrompt({ ...base, glossary: { 南斗: '남두' }, expectedCells: 10 });
    const shared = commonPrefix(pageA, other);
    expect(shared).toContain('번역 지침');
    expect(shared).not.toContain('拳王');
  });

  it('재요청 프롬프트도 같은 고정 구간으로 시작하고, 재요청 안내는 맨 뒤에 붙는다', () => {
    const retry = buildGridPrompt({ ...base, expectedCells: 3, retry: true });
    expect(commonPrefix(pageA, retry).length).toBeGreaterThan(900);
    expect(retry).toContain('재요청 안내');
    expect(retry.indexOf('재요청 안내')).toBeGreaterThan(retry.indexOf('번역 지침'));
  });
});
