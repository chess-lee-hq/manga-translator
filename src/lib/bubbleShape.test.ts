import { describe, expect, it } from 'vitest';
import { bubbleCapacity, ellipseShapeForBox, fillOutline, fitIntoShape, layoutBubbleText, layoutBubbleVertical, planBubble, wrapToWidths } from './bubbleLayout';
import { detectBubble, detectBubbleShape, NO_BUBBLE_FAILURES, searchRegionFor, type BubbleShape, type PixelBox, type PixelRegion } from './bubbleShape';

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
  const detect = (box: PixelBox, others: { x: number; y: number }[] = []) =>
    detectBubbleShape(region(searchRegionFor(box, W, H)), box, W, H, others);
  const why = (box: PixelBox, others: { x: number; y: number }[] = []) =>
    detectBubble(region(searchRegionFor(box, W, H)), box, W, H, others).failure;
  return { ellipse, rect, text, detect, why };
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

  it('다른 말풍선의 글자가 같은 영역에 들어오면(붙은 말풍선) 포기한다', () => {
    const c = canvas(130);
    c.ellipse(300, 300, 90, 120, 255, 0);
    c.text(textBox);
    expect(c.detect(textBox, [{ x: 300, y: 205 }])).toBeNull();
    expect(c.detect(textBox, [{ x: 500, y: 300 }])).not.toBeNull();
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

  it('붙은 말풍선은 merged, 테두리에 걸친 글자는 uncovered-ink (말풍선은 있음)', () => {
    const c = canvas(130);
    c.ellipse(300, 300, 90, 120, 255, 0);
    c.text(textBox);
    expect(c.why(textBox, [{ x: 300, y: 205 }])).toBe('merged');

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
    expect(layout!.expanded).toBe(false);
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

  it('최소 글자 크기 아래로는 줄이지 않고, 넘치면 흰 영역을 조금 넓히고, 그래도 안 되면 null', () => {
    const long = '가'.repeat(30);
    const fitted = layoutBubbleText(long, shape, W, H, measure, 20, 40)!;
    expect(fitted.fontSize).toBeGreaterThanOrEqual(20);

    const capacity = bubbleCapacity('가'.repeat(400), shape, W, H, measure, 20);
    expect(capacity).toBeGreaterThan(20);
    const exact = layoutBubbleText('가'.repeat(capacity), shape, W, H, measure, 20, 20)!;
    expect(exact.expanded).toBe(false);
    const overflow = layoutBubbleText('가'.repeat(capacity + 6), shape, W, H, measure, 20, 20)!;
    expect(overflow.fontSize).toBe(20);
    expect(overflow.expanded).toBe(true);
    expect(layoutBubbleText('가'.repeat(capacity * 3), shape, W, H, measure, 20, 20)).toBeNull();
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
  it('홀쭉한 말풍선에 가로로 어절을 지키며 안 들어가면 세로로 세운다', () => {
    const shape = tallBubble();
    const fit = fitIntoShape('그러니까 그건 절대로 안 된다고 했잖아', shape, 1000, 1000, measure, 12, 20);
    expect(fit?.direction).toBe('vertical');
  });

  it('세로 배치는 첫 열이 오른쪽이고 글자를 순서대로 담는다', () => {
    const layout = layoutBubbleVertical('가나다라마바사아자차', tallBubble(), 1000, 1000, 12, 20)!;
    expect(layout).not.toBeNull();
    const xs = layout.columns.map(c => c.cx);
    expect([...xs].sort((a, b) => b - a)).toEqual(xs);
    expect(layout.columns.flatMap(c => c.cells.map(cell => cell.text)).join('')).toBe('가나다라마바사아자차');
  });

  it('넓적한 말풍선은 가로쓰기 그대로', () => {
    const wide = ellipseShapeForBox([450, 350, 550, 650], 1000, 1000);
    expect(fitIntoShape('짧은 대사', wide, 1000, 1000, measure, 12, 20)?.direction).toBe('horizontal');
  });
});

describe('planBubble — 덮는 말풍선 배치 고르기', () => {
  const result = (over: Record<string, unknown> = {}) => ({
    box_2d: [440, 420, 560, 580] as [number, number, number, number], translated_text: '오늘은 날씨가 좋네', original_text: '今日はいい天気だね', ...over,
  });

  it('테두리를 못 딴 말풍선(merged 등)은 글자 영역을 감싸는 타원에 넣는다', () => {
    const plan = planBubble(result(), { shape: null, failure: 'merged' }, 1000, 1000, measure, 12, 20);
    expect(plan.kind === 'fit' && plan.source).toBe('ellipse');
  });

  it('말풍선 없는 글자·모양 계산 전·맞춤을 끈 항목은 네모 상자', () => {
    expect(planBubble(result(), { shape: null, failure: 'not-paper' }, 1000, 1000, measure, 12, 20).kind).toBe('box');
    expect(planBubble(result(), undefined, 1000, 1000, measure, 12, 20).kind).toBe('box');
    expect(planBubble(result({ fit_bubble: false }), { shape: null, failure: 'merged' }, 1000, 1000, measure, 12, 20).kind).toBe('box');
  });

  it('타원은 원문 글자 영역 네 모서리를 모두 덮는다', () => {
    const shape = ellipseShapeForBox([400, 400, 600, 600], 1000, 1000);
    const corner = shape.rows[Math.floor((400 - shape.top) / shape.rowHeight)];
    expect(corner![0]).toBeLessThanOrEqual(400);
    expect(corner![1]).toBeGreaterThanOrEqual(600);
  });
});
