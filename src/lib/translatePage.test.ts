import { describe, expect, it } from 'vitest';
import { fillJoinedGaps, keepUntranslatedCells, mapGridToPages, mapGridToResults, MISSING_TRANSLATION_REVIEW } from './translatePage';
import type { BoundingBox } from './yoloPostprocess';

const box = (over: Partial<BoundingBox> = {}) =>
  ({ xmin: 0, ymin: 0, xmax: 100, ymax: 200, confidence: 1, classId: 3, ...over }) as BoundingBox;
const cell = (id: number, pageId = 'page', over: Partial<BoundingBox> = {}) => ({ id, pageId, box: box(over) });

describe('mapGridToResults', () => {
  const cells = [cell(1), cell(2, 'page', { xmin: 200, xmax: 400, ymin: 300, ymax: 600 })];

  it('칸의 픽셀 좌표를 0~1000 좌표로 바꾼다', () => {
    const [first] = mapGridToResults([{ id: 1, original_text: 'あ', translated_text: '가' }], cells, 1000, 2000);
    expect(first.box_2d).toEqual([0, 0, 100, 100]);
  });

  it('같은 칸 번호가 두 번 오면 첫 번째만 쓴다 (중복 번역 방지)', () => {
    const results = mapGridToResults([
      { id: 1, original_text: 'あ', translated_text: '가' },
      { id: 1, original_text: 'あ', translated_text: '가(중복)' },
      { id: 2, original_text: 'い', translated_text: '나' },
    ], cells, 1000, 2000);
    expect(results.map(r => r.translated_text)).toEqual(['가', '나']);
  });

  it('없는 칸 번호는 버린다', () => {
    expect(mapGridToResults([{ id: 99, original_text: 'x', translated_text: 'y' }], cells, 1000, 2000)).toEqual([]);
  });
});

describe('mapGridToPages — 여러 페이지를 묶은 격자 되돌리기', () => {
  // 1~2번은 A 페이지(1000×2000), 3번은 B 페이지(500×1000)
  const cells = [
    cell(1, 'A'),
    cell(2, 'A', { xmin: 200, xmax: 400, ymin: 300, ymax: 600 }),
    cell(3, 'B'),
  ];
  const sizeOf = (id: string) => (id === 'A' ? { width: 1000, height: 2000 } : { width: 500, height: 1000 });

  it('칸을 원래 페이지별로 나누고 각 페이지 크기로 좌표를 환산한다', () => {
    const byPage = mapGridToPages([
      { id: 1, original_text: 'あ', translated_text: '가' },
      { id: 2, original_text: 'い', translated_text: '나' },
      { id: 3, original_text: 'う', translated_text: '다' },
    ], cells, sizeOf);

    expect([...byPage.keys()].sort()).toEqual(['A', 'B']);
    expect(byPage.get('A')!.map(r => r.translated_text)).toEqual(['가', '나']);
    // 같은 픽셀 박스라도 페이지 크기가 다르면 정규화 좌표가 달라야 함
    expect(byPage.get('A')![0].box_2d).toEqual([0, 0, 100, 100]);
    expect(byPage.get('B')![0].box_2d).toEqual([0, 0, 200, 200]);
  });

  it('중복 칸 번호는 첫 번째만 쓰고, 모르는 번호는 버린다', () => {
    const byPage = mapGridToPages([
      { id: 3, original_text: 'う', translated_text: '다' },
      { id: 3, original_text: 'う', translated_text: '다(중복)' },
      { id: 99, original_text: 'x', translated_text: '없는 칸' },
    ], cells, sizeOf);
    expect(byPage.get('B')!.map(r => r.translated_text)).toEqual(['다']);
    expect(byPage.has('A')).toBe(false);
  });
});

describe('fillJoinedGaps — 이어진 말풍선 칸에 몰아 쓴 번역 나누기', () => {
  const box = (joinGroup?: number) => ({ xmin: 0, ymin: 0, xmax: 1, ymax: 1, confidence: 1, classId: 3, ...(joinGroup ? { joinGroup } : {}) });
  const cells = [
    { id: 1, box: box(1), pageId: 'p' },
    { id: 2, box: box(1), pageId: 'p' },
    { id: 3, box: box(), pageId: 'p' },
  ];

  it('한 칸에 몰아 쓰고 다른 칸을 비우면 문장 끝에서 나눠 채운다', () => {
    const out = fillJoinedGaps([
      { id: 1, original_text: '何より', translated_text: '' },
      { id: 2, original_text: 'かつて自ら治めた高遠城を見捨てるとは承服し難し', translated_text: '무엇보다! 한때 직접 다스리던 다카토오성을 버리시다니 납득하기 어렵소.' },
      { id: 3, original_text: 'x', translated_text: '' },
    ] as never, cells as never);
    expect(out[0].translated_text).toBe('무엇보다!');
    expect(out[1].translated_text).toBe('한때 직접 다스리던 다카토오성을 버리시다니 납득하기 어렵소.');
    expect(out[2].translated_text).toBe('');
  });

  it('나눌 문장 끝이 없으면 빈 칸에 "…" (원문은 지워지게)', () => {
    const out = fillJoinedGaps([
      { id: 1, original_text: '然らば', translated_text: '' },
      { id: 2, original_text: '領民に慕われる五郎様は', translated_text: '백성의 신망을 얻으신 고로 님은 오다에게도 중요한 인물이옵니다' },
    ] as never, cells as never);
    expect(out[0].translated_text).toBe('…');
  });
});

describe('keepUntranslatedCells — 다시 물어봐도 번역이 빈 칸', () => {
  it('원문 글자가 있으면 버리지 않고 원문을 그대로 넣고 검토 표시 (「……何」)', () => {
    const out = keepUntranslatedCells([
      { id: 1, original_text: '……何', translated_text: '' },
      { id: 2, original_text: '是は!?', translated_text: '이건!?' },
    ] as never);
    expect(out[0]).toMatchObject({ translated_text: '……何', review: MISSING_TRANSLATION_REVIEW });
    expect(out[1].translated_text).toBe('이건!?');
    expect(out[1].review).toBeUndefined();
  });

  it('원문도 비었거나 기호뿐이면(그림을 글자로 잘못 잡은 자리) 그대로 둬서 빠지게 함', () => {
    const out = keepUntranslatedCells([
      { id: 1, original_text: '', translated_text: '' },
      { id: 2, original_text: '……', translated_text: ' ' },
    ] as never);
    expect(out.map(t => t.translated_text.trim())).toEqual(['', '']);
  });
});

describe('원문 글자 획(text_mask)을 번역 결과로 넘김', () => {
  it('칸에 붙여 둔 글자 획을 결과에 그대로 남긴다', () => {
    const textMask = { x: 10, y: 20, w: 3, h: 2, rle: '1,2,3' };
    const cells = [
      { id: 1, pageId: 'page', box: { xmin: 10, ymin: 20, xmax: 13, ymax: 22, confidence: 1, classId: 3, textMask } },
      { id: 2, pageId: 'page', box: { xmin: 50, ymin: 50, xmax: 60, ymax: 60, confidence: 1, classId: 3 } },
    ];
    const out = mapGridToResults([
      { id: 1, original_text: 'あ', translated_text: '아' },
      { id: 2, original_text: 'い', translated_text: '이' },
    ], cells as never, 100, 100);
    expect(out[0].text_mask).toEqual(textMask);
    expect(out[1].text_mask).toBeUndefined();
  });
});
