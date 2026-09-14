import { describe, expect, it, vi } from 'vitest';
import type { GridCellInfo } from './imageUtils';
import { applyQualityRetry, assessCell, pickBetter, stripTypeTags } from './translationQuality';
import type { BoundingBox } from './yoloPostprocess';

const r = (id: number, original_text: string, translated_text: string) => ({ id, original_text, translated_text });
const box = { xmin: 0, ymin: 0, xmax: 10, ymax: 10, confidence: 1, classId: 3 } as BoundingBox;
const cell = (id: number, pageId = 'p'): GridCellInfo => ({ id, box, pageId });

describe('assessCell', () => {
  it('정상 번역은 통과', () => {
    expect(assessCell(r(1, 'おはよう', '좋은 아침'))).toBeNull();
    expect(assessCell(r(1, 'ドドド', '두두두'))).toBeNull();
  });

  it('장음 부호·가운뎃점·문장부호만 섞인 번역은 통과', () => {
    expect(assessCell(r(1, 'うわー', '으아ー!'))).toBeNull();
    expect(assessCell(r(1, '……!?', '……!?'))).toBeNull();
    expect(assessCell(r(1, '100円', '100엔'))).toBeNull();
  });

  it('응답에서 칸이 빠지면 missing', () => {
    expect(assessCell(undefined)).toBe('missing');
  });

  it('원문은 있는데 번역이 비면 empty', () => {
    expect(assessCell(r(1, '待って', ''))).toBe('empty');
    expect(assessCell(r(1, '待って', '   '))).toBe('empty');
  });

  it('원문도 번역도 없으면 글자 없는 칸이라 재요청하지 않음', () => {
    expect(assessCell(r(1, '', ''))).toBeNull();
    expect(assessCell(r(1, '……', ''))).toBeNull();
  });

  it('한국어 없이 일본어만 있으면 untranslated (한자만 베낀 경우 포함)', () => {
    expect(assessCell(r(1, 'まさか', 'まさか'))).toBe('untranslated');
    expect(assessCell(r(1, '本当', '本当'))).toBe('untranslated');
  });

  it('한국어 사이에 가나가 눈에 띄게 남으면 japanese_left', () => {
    expect(assessCell(r(1, 'それはさくらのだ', '그건 さくら의 거야'))).toBe('japanese_left');
  });

  it('긴 한국어 문장에 가나 한 글자 정도는 통과', () => {
    expect(assessCell(r(1, '', '이건 정말 대단한 일이야, ね'))).toBeNull();
  });
});

describe('stripTypeTags', () => {
  it('앞에 새어 나온 분류 태그만 지운다', () => {
    expect(stripTypeTags('[대사] 가자!')).toBe('가자!');
    expect(stripTypeTags('【효과음】쾅')).toBe('쾅');
    expect(stripTypeTags('그건 [대사]가 아니야')).toBe('그건 [대사]가 아니야');
  });
});

describe('pickBetter', () => {
  it('문제가 덜한 쪽을 고르고, 같으면 원래 것을 유지', () => {
    const empty = r(1, '待って', '');
    const japanese = r(1, '待って', '待って');
    const good = r(1, '待って', '기다려');
    expect(pickBetter(empty, good)).toBe(good);
    expect(pickBetter(empty, japanese)).toBe(japanese);
    expect(pickBetter(good, japanese)).toBe(good);
    expect(pickBetter(japanese, r(1, '待って', '待って!'))).toBe(japanese);
    expect(pickBetter(undefined, good)).toBe(good);
  });
});

describe('applyQualityRetry', () => {
  it('문제가 없으면 재요청하지 않는다', async () => {
    const retry = vi.fn();
    const { report } = await applyQualityRetry([r(1, 'あ', '가'), r(2, 'い', '나')], [cell(1), cell(2)], retry);
    expect(retry).not.toHaveBeenCalled();
    expect(report).toMatchObject({ checked: 2, issues: {}, fixed: 0 });
  });

  it('문제 칸만 칸 번호 순서로 넘기고, 재요청 결과를 원래 칸 번호로 되돌려 합친다', async () => {
    const retry = vi.fn(async (failed: GridCellInfo[]) => {
      expect(failed.map(c => c.id)).toEqual([2, 4]); // 2번(빈 번역), 4번(누락)
      return [r(1, 'い', '나'), r(2, 'え', '라')];     // 재요청 격자에서는 1번부터 다시 번호가 매겨짐
    });
    const { translations, report } = await applyQualityRetry(
      [r(3, 'う', '다'), r(1, 'あ', '가'), r(2, 'い', ''), r(5, '', '')],
      [cell(1), cell(2), cell(3), cell(4), cell(5)],
      retry,
    );
    expect(translations.map(t => [t.id, t.translated_text])).toEqual([[1, '가'], [2, '나'], [3, '다'], [4, '라'], [5, '']]);
    expect(report).toMatchObject({ issues: { empty: 1, missing: 1 }, fixed: 2, retryFailed: false });
  });

  it('재요청 결과가 더 나쁘면 원래 결과를 유지한다', async () => {
    const { translations, report } = await applyQualityRetry(
      [r(1, 'それはさくらのだ', '그건 さくら의 거야')],
      [cell(1)],
      async () => [r(1, 'それはさくらのだ', 'それはさくらのだ')],
    );
    expect(translations[0].translated_text).toBe('그건 さくら의 거야');
    expect(report.fixed).toBe(0);
  });

  it('재요청이 실패해도 첫 결과로 계속 진행한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { translations, report } = await applyQualityRetry(
      [r(1, '待って', ''), r(2, 'あ', '가')],
      [cell(1), cell(2)],
      async () => { throw new Error('429'); },
    );
    expect(translations.map(t => t.translated_text)).toEqual(['', '가']);
    expect(report.retryFailed).toBe(true);
  });

  it('중복 칸 번호는 첫 번째만 쓰고, 태그 누출은 재요청 없이 지운다', async () => {
    const retry = vi.fn();
    const { translations } = await applyQualityRetry(
      [r(1, 'あ', '[대사] 가'), r(1, 'あ', '가(중복)')],
      [cell(1)],
      retry,
    );
    expect(translations).toEqual([r(1, 'あ', '가')]);
    expect(retry).not.toHaveBeenCalled();
  });
});
