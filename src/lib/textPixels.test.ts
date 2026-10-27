import { describe, expect, it } from 'vitest';
import { decodeRle, encodeRle, isTextMask, splitByTextLines, textMaskFor, type TextPixels } from './textPixels';
import { glyphMaskFromText, type PixelBox } from './bubbleShape';

/** 글자 픽셀 모델이 잡는 모양: 세로 줄 가운데만 가늘게 (폭 9px) */
const line = (x: number, y0: number, y1: number): PixelBox => ({ xmin: x, ymin: y0, xmax: x + 9, ymax: y1 });

describe('splitByTextLines — 글자 줄로 붙은 말풍선 나누기', () => {
  it('오른쪽 위 짧은 줄만 비켜 있으면(「然らば」) 그 줄을 먼저, 아래로 내려온 줄들을 다음 칸으로', () => {
    const lines = [line(140, 591, 642), line(103, 641, 759), line(80, 642, 706), line(58, 641, 759), line(35, 641, 723)];
    const parts = splitByTextLines(lines, { xmin: 30, ymin: 588, xmax: 155, ymax: 763 });
    expect(parts).toHaveLength(2);
    expect(parts![0].xmin).toBeGreaterThan(125);
    expect(parts![0].ymax).toBeLessThan(660);
    expect(parts![1].xmax).toBeLessThan(130);
    expect(parts![1].ymin).toBeGreaterThan(620);
  });

  it('위아래로 비켜 붙은 말풍선(「新府に籠ったとて」/「兄者に勝機は——!?」): 줄표에서 끊긴 줄도 한 칸에', () => {
    const lines = [line(414, 76, 127), line(386, 76, 164), line(371, 230, 320), line(347, 231, 263), line(347, 266, 302)];
    const parts = splitByTextLines(lines, { xmin: 340, ymin: 70, xmax: 430, ymax: 330 });
    expect(parts).toHaveLength(2);
    expect(parts![0].ymax).toBeLessThan(200);
    expect(parts![1].ymin).toBeGreaterThan(200);
    expect(parts![1].xmin).toBeLessThan(347);
  });

  it('한 말풍선 안 길이가 다른 줄(가운데 정렬)은 나누지 않는다', () => {
    const lines = [line(300, 100, 300), line(278, 150, 250), line(256, 100, 280)];
    expect(splitByTextLines(lines, { xmin: 250, ymin: 90, xmax: 315, ymax: 310 })).toBeNull();
  });

  it('글자 영역 밖 줄은 보지 않는다', () => {
    const lines = [line(300, 100, 200), line(100, 400, 500)];
    expect(splitByTextLines(lines, { xmin: 290, ymin: 90, xmax: 315, ymax: 210 })).toBeNull();
  });
});

describe('원문 글자 획 저장·복원', () => {
  it('run-length로 줄였다가 그대로 되살린다', () => {
    const bits = Uint8Array.from([0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1]);
    expect(Array.from(decodeRle(encodeRle(bits), bits.length))).toEqual(Array.from(bits));
    const ones = Uint8Array.from([1, 1, 0]);
    expect(Array.from(decodeRle(encodeRle(ones), 3))).toEqual([1, 1, 0]);
  });

  it('모델 격자의 글자 픽셀을 원본 해상도 글자 영역으로 잘라 저장하고, 지울 때는 획 둘레로 넓힌다', () => {
    // 원본 200×100 → 격자 1024 (scale 5.12, 위아래 여백 256)
    const size = 1024;
    const scale = 5.12;
    const padY = 256;
    const mask = new Uint8Array(size * size);
    // 원본 (50~52, 40~49) 획
    for (let y = 40; y < 50; y++) for (let x = 50; x < 53; x++) {
      for (let gy = Math.floor(y * scale + padY); gy < Math.floor((y + 1) * scale + padY); gy++) {
        for (let gx = Math.floor(x * scale); gx < Math.floor((x + 1) * scale); gx++) mask[gy * size + gx] = 1;
      }
    }
    const tp: TextPixels = { mask, size, scale, padX: 0, padY, lines: [] };
    const textMask = textMaskFor(tp, { xmin: 45, ymin: 35, xmax: 60, ymax: 55 }, 2, 200, 100)!;
    expect(isTextMask(textMask)).toBe(true);
    expect(textMask).toMatchObject({ x: 43, y: 33, w: 19, h: 24 });
    const bits = decodeRle(textMask.rle, textMask.w * textMask.h);
    expect(bits[(45 - 33) * textMask.w + (51 - 43)]).toBe(1);
    expect(bits[(45 - 33) * textMask.w + (56 - 43)]).toBe(0);

    const data = new Uint8ClampedArray(200 * 100 * 4).fill(255);
    const glyph = glyphMaskFromText({ data, width: 200, height: 100, x: 0, y: 0 }, textMask, 16, 200, 100)!;
    expect(glyph.coverage).toBe(1);
    expect(glyph.color).toEqual([255, 255, 255]);
    // 획(50~52) 둘레 2px까지 넓힘
    const at = (x: number, y: number) => glyph.data[(y - glyph.y) * glyph.width + (x - glyph.x)];
    expect(at(48, 45)).toBe(1);
    expect(at(47, 45)).toBe(0);
    expect(at(54, 45)).toBe(1);
  });

  it('깨진 저장값은 쓰지 않는다', () => {
    expect(isTextMask({ x: 1, y: 2, w: 0, h: 3, rle: '1' })).toBe(false);
    expect(isTextMask({ x: 1, y: 2, w: 3, h: 3 })).toBe(false);
    expect(isTextMask(null)).toBe(false);
  });
});
