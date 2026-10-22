import { describe, expect, it } from 'vitest';
import { bubbleCapacity, uniformFontTargets, ellipseShapeForBox, fillOutline, fitIntoShape, layoutBubbleOverflow, layoutBubbleText, layoutBubbleVertical, planBubble, splitTranslation, wrapToWidths } from './bubbleLayout';
import { buildGlyphMask, detectBubble, detectBubbleShape, estimateGlyphSize, NO_BUBBLE_FAILURES, searchRegionFor, type BubbleShape, type PixelBox, type PixelRegion } from './bubbleShape';

const W = 600;
const H = 600;

/** 흑백 그림판: luma 값을 채워 넣고 RGBA 영역으로 잘라냄 */
function canvas(fill = 255) {
  const luma = new Uint8Array(W * H).fill(fill);
  const set = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) luma[Math.floor(y) * W + Math.floor(x)] = v;
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, inside: number, outline: number, gapFrom?: number, gapHalf = 12) => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
        if (d <= 1) set(x, y, inside);
        else if (d <= 1 + 3 / Math.min(rx, ry)) {
          // gapFrom: 오른쪽 끝 부분 테두리를 끊음
          if (gapFrom !== undefined && x > gapFrom && Math.abs(y - cy) < gapHalf) set(x, y, inside);
          else set(x, y, outline);
        }
      }
    }
  };
  /** 테두리 없이 안쪽만 칠한 타원 (붙은 말풍선의 겹친 테두리를 지울 때) */
  const disc = (cx: number, cy: number, rx: number, ry: number, v: number) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) set(x, y, v);
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, v);
  };
  /** 세로쓰기 글자 흉내: 속이 빈 네모 글자(口)를 간격을 두고 늘어놓음 — 글자 속 구멍도 모양에 포함돼야 함 */
  const text = (box: PixelBox) => {
    for (let x = box.xmin + 2; x + 16 <= box.xmax; x += 22) {
      for (let y = box.ymin + 2; y + 16 <= box.ymax; y += 20) {
        rect(x, y, x + 16, y + 16, 20);
        rect(x + 3, y + 3, x + 13, y + 13, 255);
      }
    }
  };
  const region = (rect: PixelBox): PixelRegion => {
    const w = rect.xmax - rect.xmin;
    const h = rect.ymax - rect.ymin;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = luma[(y + rect.ymin) * W + (x + rect.xmin)];
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return { data, width: w, height: h, x: rect.xmin, y: rect.ymin };
  };
  const detect = (box: PixelBox, others: PixelBox[] = [], wide = false) =>
    detectBubbleShape(region(searchRegionFor(box, W, H, wide)), box, W, H, others);
  const why = (box: PixelBox, others: PixelBox[] = []) =>
    detectBubble(region(searchRegionFor(box, W, H)), box, W, H, others).failure;
  const full = (box: PixelBox, others: PixelBox[] = []) =>
    detectBubble(region(searchRegionFor(box, W, H)), box, W, H, others);
  const glyph = (box: PixelBox) => estimateGlyphSize(region(searchRegionFor(box, W, H)), box);
  const mask = (box: PixelBox, size: number) => {
    const d = detectBubble(region(searchRegionFor(box, W, H)), box, W, H, []);
    return buildGlyphMask(region(searchRegionFor(box, W, H)), box, size, W, H, d.shape ?? d.interior ?? null);
  };
  const regionFor = (box: PixelBox) => region(searchRegionFor(box, W, H));
  return { ellipse, disc, rect, text, detect, why, full, glyph, mask, regionFor };
}

const textBox: PixelBox = { xmin: 270, ymin: 240, xmax: 330, ymax: 360 };

describe('detectBubbleShape', () => {
  it('테두리가 닫힌 흰 말풍선의 안쪽 모양을 찾는다 (가운데는 넓고 위아래는 좁음)', () => {
    const c = canvas(130); // 회색 그림 배경
    c.ellipse(300, 300, 90, 120, 255, 0);
    c.text(textBox);
    const shape = c.detect(textBox);
    expect(shape).not.toBeNull();

    const toPx = (v: number) => (v / 1000) * W;
    const widthAt = (row: [number, number] | null) => (row ? toPx(row[1] - row[0]) : 0);
    const middle = shape!.rows[Math.floor(shape!.rows.length / 2)];
    expect(widthAt(middle)).toBeGreaterThan(160);
    expect(widthAt(middle)).toBeLessThan(185);
    expect(widthAt(shape!.rows[1])).toBeLessThan(widthAt(middle) * 0.6);
    expect(toPx(shape!.rows.length * shape!.rowHeight)).toBeGreaterThan(220);
    expect(toPx(shape!.centerX)).toBeCloseTo(300, -1);
  });

  it('흰 배경 위 글자(말풍선 없음)는 흰색이 끝까지 번지므로 포기한다', () => {
    const c = canvas(255);
    c.text(textBox);
    expect(c.detect(textBox)).toBeNull();
  });

  it('테두리가 끊겨 흰 배경으로 새어 나가면 포기한다', () => {
    const c = canvas(255);
    c.rect(0, 0, W, H, 255);
    c.ellipse(300, 300, 90, 120, 255, 0, 360);
    c.text(textBox);
    expect(c.detect(textBox)).toBeNull();
  });

  it('스크린톤·그림 위 글자(배경이 흰색이 아님)는 포기한다', () => {
    const c = canvas(255);
    c.ellipse(300, 300, 90, 120, 150, 0);
    c.text(textBox);
    expect(c.detect(textBox)).toBeNull();
  });

  it('두 말풍선이 이어져 한 영역이면(붙은 말풍선) 대사마다 자기 쪽 말풍선 모양으로 나눈다', () => {
    const c = canvas(130);
    c.ellipse(230, 300, 90, 80, 255, 0);
    c.ellipse(370, 300, 90, 80, 255, 0);
    c.disc(230, 300, 90, 80, 255);
    c.disc(370, 300, 90, 80, 255);
    const left: PixelBox = { xmin: 205, ymin: 260, xmax: 255, ymax: 340 };
    const right: PixelBox = { xmin: 345, ymin: 260, xmax: 395, ymax: 340 };
    c.text(left);
    c.text(right);
    const px = (v: number) => (v / 1000) * W;
    const extent = (shape: BubbleShape) => {
      const rows = shape.rows.filter((r): r is [number, number] => !!r);
      return { min: px(Math.min(...rows.map(r => r[0]))), max: px(Math.max(...rows.map(r => r[1]))) };
    };

    const a = c.detect(left, [right], true)!;
    const b = c.detect(right, [left], true)!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // 왼쪽 몫은 왼쪽 말풍선 끝(140)부터 이어진 목(300) 근처까지, 오른쪽 말풍선 안으로 들어가지 않음
    expect(extent(a).min).toBeLessThan(150);
    expect(extent(a).max).toBeLessThan(320);
    expect(extent(b).min).toBeGreaterThan(280);
    expect(extent(b).max).toBeGreaterThan(450);
    expect(px(a.centerX)).toBeLessThan(260);
    expect(px(b.centerX)).toBeGreaterThan(340);
  });

  it('밝은 회색 컷 바탕(종이색과 비슷)으로 번져도 컷 전체가 아니라 말풍선 안쪽만 찾는다', () => {
    const c = canvas(200);
    // 컷 테두리로 닫힌 밝은 회색 바탕 + 그 안의 흰 말풍선. 글자 영역이 말풍선보다 커서 시작점 일부가 바탕에 걸림
    c.rect(90, 90, 510, 96, 0);
    c.rect(90, 504, 510, 510, 0);
    c.rect(90, 90, 96, 510, 0);
    c.rect(504, 90, 510, 510, 0);
    c.ellipse(300, 300, 70, 100, 255, 0);
    c.text({ xmin: 270, ymin: 250, xmax: 330, ymax: 350 });
    const px = (v: number) => (v / 1000) * W;
    const widthOf = (shape: BubbleShape) => {
      const rows = shape.rows.filter((r): r is [number, number] => !!r);
      return px(Math.max(...rows.map(r => r[1]))) - px(Math.min(...rows.map(r => r[0])));
    };
    // 검출 박스가 말풍선보다 커서 테두리선이 박스 안에 들어와도 말풍선 모양 그대로 (테두리선은 글자로 치지 않음)
    const loose = c.detect({ xmin: 220, ymin: 200, xmax: 380, ymax: 400 })!;
    expect(loose).not.toBeNull();
    expect(widthOf(loose)).toBeLessThan(150);
    const inner = c.detect({ xmin: 270, ymin: 250, xmax: 330, ymax: 350 })!;
    expect(widthOf(inner)).toBeLessThan(150);
  });

  it('글자 영역 하나가 이어진 말풍선 두 칸에 걸치면 칸별로 나눈다 (오른쪽 칸 먼저)', () => {
    const c = canvas(130);
    c.ellipse(230, 300, 90, 80, 255, 0);
    c.ellipse(370, 300, 90, 80, 255, 0);
    c.disc(230, 300, 90, 80, 255);
    c.disc(370, 300, 90, 80, 255);
    const left: PixelBox = { xmin: 185, ymin: 260, xmax: 255, ymax: 340 };
    const right: PixelBox = { xmin: 345, ymin: 260, xmax: 415, ymax: 340 };
    c.text(left);
    c.text(right);
    const merged: PixelBox = { xmin: 185, ymin: 260, xmax: 415, ymax: 340 };
    const detection = c.full(merged);
    expect(detection.shape).not.toBeNull();
    const lobes = detection.shape ? detection.lobes : undefined;
    expect(lobes).toHaveLength(2);
    const px = (v: number) => (v / 1000) * W;
    expect(px(lobes![0].shape.centerX)).toBeGreaterThan(330);
    expect(px(lobes![1].shape.centerX)).toBeLessThan(270);
    expect(lobes![0].inkShare).toBeCloseTo(0.5, 1);
    expect(lobes![0].box.xmin).toBeGreaterThan(300);
    expect(lobes![1].box.xmax).toBeLessThan(300);
  });

  it('둥근 말풍선 하나에 글자 묶음이 둘이어도(잘록한 목이 없음) 나누지 않는다', () => {
    const c = canvas(130);
    c.ellipse(300, 300, 160, 110, 255, 0);
    c.text({ xmin: 200, ymin: 260, xmax: 250, ymax: 340 });
    c.text({ xmin: 340, ymin: 260, xmax: 390, ymax: 340 });
    const detection = c.full({ xmin: 200, ymin: 260, xmax: 390, ymax: 340 });
    expect(detection.shape).not.toBeNull();
    expect(detection.shape ? detection.lobes : 'x').toBeUndefined();
  });

  it('보통 세로쓰기 말풍선(글자 줄 간격이 고름)은 나누지 않는다', () => {
    const c = canvas(130);
    c.ellipse(300, 300, 90, 120, 255, 0);
    c.text(textBox);
    const detection = c.full(textBox);
    expect(detection.shape ? detection.lobes : 'x').toBeUndefined();
  });

  it('혹이 달린 말풍선: 글자는 몸통 구간(safeRows)에만, 흰색은 혹까지 전체(rows)', () => {
    const c = canvas(130);
    // 몸통(세로로 긴 타원) + 오른쪽 위 혹(작은 원) — 혹과 몸통 사이 위쪽은 오목하게 테두리 밖
    c.ellipse(300, 320, 45, 110, 255, 0);
    c.ellipse(350, 250, 30, 30, 255, 0);
    c.disc(300, 320, 45, 110, 255);
    c.disc(350, 250, 30, 30, 255);
    const box: PixelBox = { xmin: 280, ymin: 260, xmax: 320, ymax: 380 };
    c.text(box);
    const shape = c.detect(box)!;
    expect(shape).not.toBeNull();
    const px = (v: number) => (v / 1000) * W;
    const rowAt = (y: number) => Math.floor(((y / H) * 1000 - shape.top) / shape.rowHeight);
    const i = rowAt(225); // 혹 높이: 몸통과 혹이 한 행에 따로 있음
    expect(px(shape.rows[i]![1])).toBeGreaterThan(360);
    expect(px(shape.safeRows![i]![1]) - px(shape.safeRows![i]![0])).toBeLessThan(px(shape.rows[i]![1]) - px(shape.rows[i]![0]) - 10);
  });

  it('멀리 있는 다른 글자는 영향을 주지 않는다', () => {
    const c = canvas(130);
    c.ellipse(300, 300, 90, 120, 255, 0);
    c.text(textBox);
    expect(c.detect(textBox, [{ xmin: 480, ymin: 280, xmax: 520, ymax: 320 }])).not.toBeNull();
  });

  it('글자가 테두리에 걸쳐 흰색으로 다 못 덮으면 포기한다', () => {
    const c = canvas(130);
    c.ellipse(300, 300, 50, 70, 255, 0);
    const wide: PixelBox = { xmin: 240, ymin: 250, xmax: 360, ymax: 350 };
    c.text(wide);
    expect(c.detect(wide)).toBeNull();
  });
});

describe('detectBubble — 못 찾은 이유', () => {
  it('그림·스크린톤 위 글자(속이 흰 글자라 배경 검사는 통과해도 둘러싼 흰 영역이 없음)와 흰 바탕에 떠 있는 글자는 말풍선 없음', () => {
    const tone = canvas(255);
    tone.ellipse(300, 300, 90, 120, 150, 0);
    tone.text(textBox);
    expect(NO_BUBBLE_FAILURES.has(tone.why(textBox)!)).toBe(true);

    const darkTone = canvas(120);
    darkTone.rect(260, 230, 340, 370, 140);
    darkTone.rect(285, 260, 315, 340, 20);
    expect(darkTone.why({ xmin: 270, ymin: 240, xmax: 330, ymax: 360 })).toBe('not-paper');

    const plain = canvas(255);
    plain.text(textBox);
    expect(plain.why(textBox)).toBe('leak');
  });

  it('테두리에 걸친 글자는 uncovered-ink (말풍선은 있음)', () => {
    const d = canvas(130);
    d.ellipse(300, 300, 50, 70, 255, 0);
    const wide: PixelBox = { xmin: 240, ymin: 250, xmax: 360, ymax: 350 };
    d.text(wide);
    expect(d.why(wide)).toBe('uncovered-ink');
  });

  it('테두리의 작은 틈은 메우고 모양을 찾는다 (큰 틈은 여전히 포기)', () => {
    const small = canvas(255);
    small.ellipse(300, 300, 90, 120, 255, 0, 360, 1.5);
    small.text(textBox);
    expect(small.detect(textBox)).not.toBeNull();

    const big = canvas(255);
    big.ellipse(300, 300, 90, 120, 255, 0, 360, 12);
    big.text(textBox);
    expect(big.detect(textBox)).toBeNull();
  });
});

// 글자당 1em 고정폭
const measure = (t: string, size: number) => Array.from(t).length * size;

describe('wrapToWidths', () => {
  it('줄마다 다른 폭으로 어절 단위 줄바꿈', () => {
    expect(wrapToWidths('가나 다라마 바', [20, 50, 20], t => Array.from(t).length * 10, false)).toEqual(['가나', '다라마 바']);
  });

  it('어절이 줄보다 길면 글자 단위 자르기를 허용할 때만 자른다', () => {
    const m = (t: string) => Array.from(t).length * 10;
    expect(wrapToWidths('가나다라마', [30, 30], m, false)).toBeNull();
    expect(wrapToWidths('가나다라마', [30, 30], m, true)).toEqual(['가나다', '라마']);
  });

  it('줄이 모자라면 null', () => {
    expect(wrapToWidths('가나 다라 마바', [20, 20], t => Array.from(t).length * 10, false)).toBeNull();
  });
});

describe('layoutBubbleText', () => {
  const c = canvas(130);
  c.ellipse(300, 300, 90, 120, 255, 0);
  c.text(textBox);
  const shape = c.detect(textBox)!;

  it('짧은 번역은 최대 글자 크기로 말풍선 가운데에, 가운데 줄이 가장 넓게', () => {
    const layout = layoutBubbleText('안녕하세요 반갑습니다 오늘도 잘 부탁해요', shape, W, H, measure, 10, 28);
    expect(layout).not.toBeNull();
    expect(layout!.overflow).toBe(false);
    const centers = layout!.lines.map(l => l.cx);
    centers.forEach(cx => expect(cx).toBeCloseTo(300, -1));
    // 모든 줄이 말풍선 안쪽 폭 안에 들어감
    for (const line of layout!.lines) {
      const half = measure(line.text, layout!.fontSize) / 2;
      const row = shape.rows[Math.floor(((line.top / H) * 1000 - shape.top) / shape.rowHeight)]!;
      expect(line.cx - half).toBeGreaterThanOrEqual((row[0] / 1000) * W);
      expect(line.cx + half).toBeLessThanOrEqual((row[1] / 1000) * W);
    }
  });

  it('최소 글자 크기 아래로는 줄이지 않고, 흰 영역도 넓히지 않으며, 안 들어가면 null', () => {
    const long = '가'.repeat(30);
    const fitted = layoutBubbleText(long, shape, W, H, measure, 20, 40)!;
    expect(fitted.fontSize).toBeGreaterThanOrEqual(20);

    const capacity = bubbleCapacity('가'.repeat(400), shape, W, H, measure, 20);
    expect(capacity).toBeGreaterThan(20);
    const exact = layoutBubbleText('가'.repeat(capacity), shape, W, H, measure, 20, 20)!;
    expect(exact.overflow).toBe(false);
    // 흰색은 찾은 말풍선 모양 그대로 (넓히지 않음)
    expect(exact.fill.rows).toHaveLength(shape.rows.length);
    expect(exact.fill.top).toBeCloseTo((shape.top / 1000) * H);
    // 여백을 줄여도 안 들어가면 null (넘침 처리는 호출하는 쪽)
    expect(layoutBubbleText('가'.repeat(capacity * 2), shape, W, H, measure, 20, 20)).toBeNull();
  });

  it('넘치면 최소 글자로 위아래로 넘치게 두되 흰색은 말풍선 안쪽만', () => {
    const capacity = bubbleCapacity('가'.repeat(400), shape, W, H, measure, 20);
    const overflow = layoutBubbleOverflow('가'.repeat(capacity * 2), shape, W, H, measure, 20)!;
    expect(overflow.overflow).toBe(true);
    expect(overflow.fontSize).toBe(20);
    expect(overflow.lines.map(l => l.text).join('')).toBe('가'.repeat(capacity * 2));
    const bubbleTop = (shape.top / 1000) * H;
    expect(overflow.lines[0].top).toBeLessThan(bubbleTop);
    expect(overflow.fill.top).toBeCloseTo(bubbleTop);
  });

  it('단행본처럼 좁게 쌓는다: 넓은 말풍선이어도 한 줄은 가장 긴 어절 정도까지 (어절 유지)', () => {
    const wide = ellipseShapeForBox([400, 200, 600, 800], 1000, 1000);
    const layout = layoutBubbleText('고맙습니다. 하지만 제 결심은 변함없습니다.', wide, 1000, 1000, measure, 12, 22)!;
    expect(layout.fontSize).toBe(22);
    expect(layout.lines.length).toBeGreaterThanOrEqual(4);
    for (const line of layout.lines) expect(Array.from(line.text).length).toBeLessThanOrEqual(7); // 가장 긴 어절 '변함없습니다.'
    expect(layout.lines.map(l => l.text).join(' ')).toBe('고맙습니다. 하지만 제 결심은 변함없습니다.');
  });

  it('좁게 쌓으면 글자가 너무 작아지는 납작한 말풍선은 폭을 다 쓴다', () => {
    const flat = ellipseShapeForBox([480, 200, 520, 800], 1000, 1000);
    const layout = layoutBubbleText('고맙습니다. 하지만 제 결심은 변함없습니다.', flat, 1000, 1000, measure, 12, 22);
    expect(layout).not.toBeNull();
    expect(Math.max(...layout!.lines.map(l => Array.from(l.text).length))).toBeGreaterThan(7);
  });

  it('채우기 외곽선은 닫힌 다각형 (왼쪽 위→아래, 오른쪽 아래→위)', () => {
    const layout = layoutBubbleText('안녕', shape, W, H, measure, 10, 28)!;
    const outline = fillOutline(layout.fill);
    expect(outline.length).toBeGreaterThan(4);
    expect(outline[0][1]).toBeCloseTo(outline.at(-1)![1]);
  });
});

/** 세로로 긴 타원 말풍선 (페이지 1000×1000 px 기준, 0~1000 좌표) */
function tallBubble(): BubbleShape {
  return ellipseShapeForBox([380, 485, 620, 515], 1000, 1000);
}

describe('세로쓰기로 말풍선 안에 넣기', () => {
  it('막대 말풍선이어도 어절이 가로 한 줄(좌우 살짝 넘침 포함)에 들어가면 가로쓰기', () => {
    const fit = fitIntoShape('그러니까 그건 절대로 안 된다고 했잖아', tallBubble(), 1000, 1000, measure, 12, 20);
    expect(fit?.direction).toBe('horizontal');
  });

  it('막대 말풍선에 어절이 가로 한 줄에도 안 들어가면 세로로 세운다', () => {
    const fit = fitIntoShape('다녀오겠습니다아아!', tallBubble(), 1000, 1000, measure, 12, 20);
    expect(fit?.direction).toBe('vertical');
  });

  it('세로 배치는 첫 열이 오른쪽이고 글자를 순서대로 담는다', () => {
    const layout = layoutBubbleVertical('가나다라마바사아자차', tallBubble(), 1000, 1000, 12, 20)!;
    expect(layout).not.toBeNull();
    const xs = layout.columns.map(c => c.cx);
    expect([...xs].sort((a, b) => b - a)).toEqual(xs);
    expect(layout.columns.flatMap(c => c.cells.map(cell => cell.text)).join('')).toBe('가나다라마바사아자차');
  });

  it('조금 긴 말풍선(막대 모양이 아님)은 좌우로 살짝 넘치더라도 가로쓰기', () => {
    const shape = ellipseShapeForBox([440, 475, 520, 525], 1000, 1000);
    const fit = fitIntoShape('실성한 영감님이요!?', shape, 1000, 1000, measure, 12, 12);
    expect(fit?.direction).toBe('horizontal');
    expect(fit?.direction === 'horizontal' && fit.layout.lines.map(l => l.text)).toEqual(['실성한', '영감님이요!?']);
    expect(fit?.layout.overflow).toBe(false);
  });

  it('넓적한 말풍선은 가로쓰기 그대로', () => {
    const wide = ellipseShapeForBox([450, 350, 550, 650], 1000, 1000);
    expect(fitIntoShape('짧은 대사', wide, 1000, 1000, measure, 12, 20)?.direction).toBe('horizontal');
  });
});

describe('원문 글자 크기 재기 · 페이지 글자 크기 통일', () => {
  it('세로쓰기 글자 영역에서 글자 한 자 크기(줄 폭)를 잰다', () => {
    const c = canvas(255);
    c.text(textBox); // 16px 글자
    expect(c.glyph(textBox)).toBe(16);
  });

  it('원문 크기가 기준과 비슷하면 모두 같은 크기, 확실히 큰 대사만 크게', () => {
    const targets = uniformFontTargets(
      [{ id: 'a', glyph: 20 }, { id: 'b', glyph: 22 }, { id: 'c', glyph: 18 }, { id: 'big', glyph: 40 }, { id: 'unknown' }],
      1000, 10, 60,
    );
    // 기준 = 가운데값 22
    expect(targets.get('a')).toBe(22);
    expect(targets.get('b')).toBe(22);
    expect(targets.get('c')).toBe(22);
    expect(targets.get('unknown')).toBe(22);
    expect(targets.get('big')).toBe(40);
  });

  it('원문 글자 획만 골라 마스크로 (테두리선·말풍선 안으로 들어온 큰 그림은 빼고)', () => {
    const c = canvas(130);
    c.ellipse(300, 300, 90, 120, 255, 0);
    c.text(textBox);
    // 글자 영역 아래에 걸친 큰 그림 덩어리 (인물 머리 흉내, 글자 크기의 3배 넘음)
    c.rect(260, 352, 340, 410, 30);
    const m = c.mask(textBox, 16)!;
    expect(m).not.toBeNull();
    const at = (x: number, y: number) => {
      const gx = x - m.x;
      const gy = y - m.y;
      return gx >= 0 && gy >= 0 && gx < m.width && gy < m.height ? m.data[gy * m.width + gx] : 0;
    };
    expect(at(textBox.xmin + 3, textBox.ymin + 3)).toBe(1); // 글자 획
    expect(at(300, 395)).toBe(0); // 그림
    expect(at(211, 300)).toBe(0); // 왼쪽 테두리선
    expect(m.color).toEqual([255, 255, 255]);
  });

  it('글자 영역 안의 가늘고 긴 기호(물결표 「〜〜〜」)도 원문으로 지운다', () => {
    const c = canvas(130);
    c.ellipse(300, 300, 90, 120, 255, 0);
    c.text(textBox);
    // 글자 4자 길이의 세로 물결표 (글자 크기 2.5배를 넘지만 가늘고 글자 영역 안)
    c.rect(318, 260, 322, 330, 20);
    const m = c.mask({ ...textBox, xmax: 335 }, 16)!;
    const at = (x: number, y: number) => {
      const gx = x - m.x;
      const gy = y - m.y;
      return gx >= 0 && gy >= 0 && gx < m.width && gy < m.height ? m.data[gy * m.width + gx] : 0;
    };
    expect(at(320, 300)).toBe(1);
  });

  it('같은 세로줄에 이어진 글자는 말풍선 안쪽 판정에서 빠져도 글자로 살린다', () => {
    const c = canvas(130);
    c.ellipse(300, 300, 90, 120, 255, 0);
    c.text(textBox);
    // 말풍선 안쪽을 위쪽(y 180~300)만으로 준 경우: 아래쪽 글자도 같은 세로줄이라 지워져야 함
    const upper: BubbleShape = {
      top: (180 / H) * 1000, rowHeight: (10 / H) * 1000,
      rows: Array.from({ length: 12 }, () => [(210 / W) * 1000, (390 / W) * 1000] as [number, number]),
      centerX: 500, centerY: 400,
    };
    const m = buildGlyphMask(c.regionFor(textBox), textBox, 16, W, H, upper)!;
    const at = (x: number, y: number) => {
      const gx = x - m.x;
      const gy = y - m.y;
      return gx >= 0 && gy >= 0 && gx < m.width && gy < m.height ? m.data[gy * m.width + gx] : 0;
    };
    expect(at(textBox.xmin + 3, textBox.ymin + 3)).toBe(1);
    expect(at(textBox.xmin + 3, 345)).toBe(1); // 안쪽 밖이지만 같은 줄
  });

  it('말풍선 안쪽을 모르면(효과음 등) 마스크를 만들지 않는다', () => {
    const c = canvas(255);
    c.text(textBox);
    expect(c.mask(textBox, 16)).toBeNull();
  });

  it('원문이 기준보다 작거나 조금 큰 대사(1.5배 미만)는 모두 기준 크기', () => {
    const targets = uniformFontTargets([{ id: 'a', glyph: 20 }, { id: 'b', glyph: 20 }, { id: 'small', glyph: 12 }, { id: 'bit', glyph: 28 }], 1000, 10, 60);
    expect(targets.get('small')).toBe(20);
    expect(targets.get('bit')).toBe(20);
  });

  it('여러 줄이 촘촘한 세로쓰기도 줄 묶음이 아니라 글자 한 자 크기로 잰다', () => {
    const c = canvas(255);
    // 16px 글자를 줄 간격 2px로 촘촘히 3줄 (예전 방식은 3줄이 한 덩어리로 잡혀 약 50px)
    const tight: PixelBox = { xmin: 270, ymin: 240, xmax: 326, ymax: 340 };
    for (let x = tight.xmin + 1; x + 16 <= tight.xmax; x += 18) {
      for (let y = tight.ymin + 2; y + 16 <= tight.ymax; y += 20) {
        c.rect(x, y, x + 16, y + 16, 20);
        c.rect(x + 3, y + 3, x + 13, y + 13, 255);
      }
    }
    c.rect(tight.xmin + 18, tight.ymin + 40, tight.xmin + 20, tight.ymin + 44, 20); // 줄 사이에 낀 작은 점(후리가나 흉내)
    expect(c.glyph(tight)).toBe(16);
  });

  it('원문 크기를 하나도 못 재면 비워 둠 (예전 기본 크기 사용)', () => {
    expect(uniformFontTargets([{ id: 'a' }], 1000, 10, 60).size).toBe(0);
  });
});

describe('splitTranslation — 이어진 말풍선 두 칸에 번역문 나누기', () => {
  it('원문 비율에 가장 가까운 문장 끝에서 나눈다', () => {
    expect(splitTranslation('고맙습니다. 하지만 제 결심은 변함없습니다. 제 존재가 일본에 도움이 안 된다면', [0.47, 0.53]))
      .toEqual(['고맙습니다. 하지만 제 결심은 변함없습니다.', '제 존재가 일본에 도움이 안 된다면']);
    expect(splitTranslation('어디 가? 금방 올게!', [0.5, 0.5])).toEqual(['어디 가?', '금방 올게!']);
  });

  it('문장이 하나뿐이거나 비율이 크게 어긋나면 나누지 않는다', () => {
    expect(splitTranslation('제 존재가 일본에 도움이 안 된다면', [0.5, 0.5])).toBeNull();
    expect(splitTranslation('응. 그럼 내일 아침 일찍 역 앞에서 다시 만나서 같이 가자', [0.5, 0.5])).toBeNull();
  });
});

describe('planBubble — 덮는 말풍선 배치 고르기', () => {
  const result = (over: Record<string, unknown> = {}) => ({
    box_2d: [440, 420, 560, 580] as [number, number, number, number], translated_text: '오늘은 날씨가 좋네', original_text: '今日はいい天気だね', ...over,
  });

  it('테두리를 못 딴 말풍선은 원문 글자 영역만 하얗게 지우고 그 둘레 타원에 넣는다', () => {
    const plan = planBubble(result(), { shape: null, failure: 'too-big' }, 1000, 1000, measure, 12, 20);
    expect(plan.kind === 'fit' && plan.source).toBe('erase');
    if (plan.kind !== 'fit') return;
    // 흰색은 글자 영역(420~580)에 여백만 조금
    expect(plan.fit.layout.fill.rows).toHaveLength(1);
    const [l, r] = plan.fit.layout.fill.rows[0]!;
    expect(l).toBeGreaterThan(410);
    expect(r).toBeLessThan(590);
  });

  it('테두리를 다 못 땄어도 말풍선 안쪽을 알면 그 범위만 칠한다 (그림 쪽으로 삐져나온 글자 영역은 안 칠함)', () => {
    const erase = ellipseShapeForBox([450, 450, 550, 550], 1000, 1000);
    const plan = planBubble(result(), { shape: null, failure: 'uncovered-ink', erase }, 1000, 1000, measure, 12, 20);
    expect(plan.kind === 'fit' && plan.source).toBe('erase');
    if (plan.kind !== 'fit') return;
    expect(plan.fit.layout.fill.rows.length).toBe(erase.rows.length);
  });

  it('붙은 글자가 테두리에 걸친 말풍선은 원문만 지울 자리(말풍선 안쪽)를 함께 돌려준다', () => {
    const c = canvas(130);
    c.ellipse(300, 300, 50, 70, 255, 0);
    const wide: PixelBox = { xmin: 240, ymin: 250, xmax: 360, ymax: 350 };
    c.text(wide);
    const detection = c.full(wide);
    expect(detection.failure).toBe('uncovered-ink');
    const erase = detection.shape ? undefined : detection.erase;
    expect(erase).toBeDefined();
    const rows = erase!.rows.filter((r): r is [number, number] => !!r);
    // 말풍선 폭(100px)을 넘지 않음
    expect(((Math.max(...rows.map(r => r[1])) - Math.min(...rows.map(r => r[0]))) / 1000) * W).toBeLessThanOrEqual(104);
  });

  it('찾은 말풍선에 안 들어가면 네모 상자로 덮지 않고 넘침으로 표시', () => {
    const shape = ellipseShapeForBox([480, 480, 520, 520], 1000, 1000);
    const plan = planBubble(result({ translated_text: '가'.repeat(80) }), { shape }, 1000, 1000, measure, 12, 20);
    expect(plan.kind).toBe('fit');
    expect(plan.kind === 'fit' && plan.source).toBe('bubble');
    expect(plan.kind === 'fit' && plan.fit.layout.overflow).toBe(true);
  });

  it('이어진 말풍선 두 칸에 하나로 번역된 글은 나눠서 칸마다 넣는다', () => {
    const lobeA = ellipseShapeForBox([420, 600, 580, 760], 1000, 1000);
    const lobeB = ellipseShapeForBox([420, 240, 580, 400], 1000, 1000);
    const whole = ellipseShapeForBox([420, 240, 580, 760], 1000, 1000);
    const lobes = [
      { shape: lobeA, inkShare: 0.5, box: { xmin: 600, ymin: 420, xmax: 760, ymax: 580 } },
      { shape: lobeB, inkShare: 0.5, box: { xmin: 240, ymin: 420, xmax: 400, ymax: 580 } },
    ];
    const plan = planBubble(result({ translated_text: '어디 가는 거야? 금방 올게.' }), { shape: whole, lobes }, 1000, 1000, measure, 12, 20);
    expect(plan.kind).toBe('fit');
    if (plan.kind !== 'fit') return;
    expect(plan.more).toHaveLength(1);
    const textOf = (fit: typeof plan.fit) => (fit.direction === 'horizontal' ? fit.layout.lines.map(l => l.text).join(' ') : '');
    expect(textOf(plan.fit)).toBe('어디 가는 거야?');
    expect(textOf(plan.more![0].fit)).toBe('금방 올게.');
    expect(plan.fit.direction === 'horizontal' && plan.fit.layout.lines[0].cx).toBeGreaterThan(600);
  });

  it('흰색은 원문 글자 영역과 번역문 줄 둘레만 칠한다 (말풍선 안으로 들어온 그림은 살림)', () => {
    // 큰 말풍선 위쪽에만 원문 글자가 있고 아래쪽은 그림이 들어와 있는 경우
    const shape = ellipseShapeForBox([300, 300, 700, 700], 1000, 1000);
    const plan = planBubble(result({ box_2d: [240, 420, 360, 580], translated_text: '짧은 대사' }), { shape }, 1000, 1000, measure, 12, 20);
    expect(plan.kind).toBe('fit');
    if (plan.kind !== 'fit') return;
    const { top, rowHeight, rows } = plan.fit.layout.fill;
    const painted = rows.map((r, i) => (r ? top + (i + 1) * rowHeight : -Infinity));
    const lowest = Math.max(...painted);
    const fit = plan.fit;
    const textBottom = fit.direction === 'horizontal' ? Math.max(...fit.layout.lines.map(l => l.top + fit.layout.lineHeight)) : 0;
    // 말풍선 아래쪽(최대 약 800)까지 칠하지 않고 원문 영역(360)·번역문 아래 여백까지만
    expect(lowest).toBeLessThan(Math.max(360 + 12, textBottom + 20) + rowHeight);
    expect(lowest).toBeLessThan(700);
  });

  it('말풍선 없는 글자·모양 계산 전·맞춤을 끈 항목은 네모 상자', () => {
    expect(planBubble(result(), { shape: null, failure: 'not-paper' }, 1000, 1000, measure, 12, 20).kind).toBe('box');
    expect(planBubble(result(), undefined, 1000, 1000, measure, 12, 20).kind).toBe('box');
    expect(planBubble(result({ fit_bubble: false }), { shape: null, failure: 'merged' }, 1000, 1000, measure, 12, 20).kind).toBe('box');
  });

  it('타원은 원문 글자 영역 네 모서리를 모두 감싼다', () => {
    const shape = ellipseShapeForBox([400, 400, 600, 600], 1000, 1000);
    const corner = shape.rows[Math.floor((400 - shape.top) / shape.rowHeight)];
    expect(corner![0]).toBeLessThanOrEqual(400);
    expect(corner![1]).toBeGreaterThanOrEqual(600);
  });
});
