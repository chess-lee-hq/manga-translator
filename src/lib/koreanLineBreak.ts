/**
 * 한글판 만화책처럼 번역문 줄을 나누는 규칙 (화면·이미지 저장 공통).
 *
 * 예전에는 "앞줄부터 꽉 채우고 남는 걸 다음 줄로"(greedy) 끊어 마지막 줄이 짧게 남거나
 * "괜찮으 / 십니까?"처럼 어절 한가운데가 잘렸습니다. 여기서는
 * 1. 가장 적은 줄 수를 먼저 정하고, 그 줄 수 안에서 줄 길이가 고른(말풍선 모양을 따르는) 끊는 자리를 고름
 * 2. AI가 표시한 "끊어도 자연스러운 자리"(BREAK_HINT)와 문장부호 뒤를 우선
 * 3. 한 글자만 남는 줄·한 글자 어절로 끝나는 줄("안 / 돼")은 피함
 * 4. 어절 안을 꼭 잘라야 할 때만, 어미 앞("괜찮으십 / 니까?")을 우선해 자름
 */

/** AI가 "|"로 표시한 줄바꿈 추천 자리를 저장하는 보이지 않는 글자 (폭 0, 편집해도 단어에 붙어 다님) */
export const BREAK_HINT = '​';
const BREAK_HINT_RE = /​/g;

/** 줄바꿈 추천 표시를 지운 글 (글자 수 세기·비교·단어장·AI에 다시 보낼 때) */
export function stripBreakHints(text: string): string {
  return text.includes(BREAK_HINT) ? text.replace(BREAK_HINT_RE, '') : text;
}

/**
 * AI 응답의 "|" 표시를 보이지 않는 추천 자리로 바꿉니다.
 * 띄어쓰기 자리의 표시만 살리고, 어절 안·문장 앞뒤의 표시는 그냥 지움.
 */
export function applyBreakHints(text: string): string {
  if (!text.includes('|')) return text;
  return text
    .replace(/[ \t]*\|[ \t]*/g, (match, offset: number, whole: string) => {
      const before = whole.slice(0, offset);
      const after = whole.slice(offset + match.length);
      const atEdge = !before.trim() || !after.trim() || /\n\s*$/.test(before) || /^\s*\n/.test(after);
      if (atEdge) return '';
      // 공백 없이 붙은 표시(어절 안)는 지움
      return /\s/.test(match) ? ` ${BREAK_HINT}` : '';
    })
    .trim();
}

/**
 * AI 응답 번역문에서 "|" 표시를 떼어 냅니다.
 * text: 표시를 지운 번역문 (화면·대본·감수 등 모든 곳에서 쓰는 글), hints: 표시가 있을 때만 줄바꿈 추천 글
 */
export function extractBreakHints(raw: string): { text: string; hints?: string } {
  if (!raw.includes('|')) return { text: raw };
  const hinted = applyBreakHints(raw);
  const text = stripBreakHints(hinted);
  return hinted.includes(BREAK_HINT) ? { text, hints: hinted } : { text };
}

/** 배치에 쓸 글: 줄바꿈 추천이 지금 번역문과 맞으면 그것, 아니면 번역문 */
export function layoutTextOf(result: { translated_text?: string; line_hints?: string }): string {
  const text = result.translated_text ?? '';
  const hints = result.line_hints;
  return hints && stripBreakHints(hints) === text ? hints : text;
}

/** 줄 끝에 매달아 가운데 맞춤에서 빼는 문장부호 / 줄 앞에 매다는 여는 부호 */
const TRAILING_PUNCT = /[.,!?~…‥。、！？～」』)\]"'”’]+$/;
const LEADING_PUNCT = /^[「『(["'“‘]+/;
/** 느낌표·물음표·물결은 눈에 잘 띄어 반만 매닮 */
const HEAVY_PUNCT = /[!?~！？～]/;

/**
 * 눈으로 볼 때 가운데로 보이도록 줄을 옮길 거리 (오른쪽이 +).
 * "요망!"이면 "!"를 빼고 "요망"이 가운데에 오도록 오른쪽으로 조금 밀어 줌.
 */
export function opticalShift(line: string, measure: (t: string) => number): number {
  const text = stripBreakHints(line);
  let shift = 0;
  const trail = text.match(TRAILING_PUNCT)?.[0];
  if (trail && trail.length < text.length) {
    for (const ch of Array.from(trail)) shift += measure(ch) * (HEAVY_PUNCT.test(ch) ? 0.25 : 0.5);
  }
  const lead = text.match(LEADING_PUNCT)?.[0];
  if (lead && lead.length < text.length) {
    for (const ch of Array.from(lead)) shift -= measure(ch) * 0.5;
  }
  return shift;
}

/** 끊은 뒤 남는 쪽이 이것으로 시작하면 어미 앞이라 비교적 자연스러움 */
const ENDING_STARTS = [
  '니까', '니다', '세요', '셔요', '어요', '아요', '여요', '에요', '예요', '네요', '군요', '지요', '죠',
  '지만', '는데', '은데', '니깐', '면서', '라고', '다고', '냐고', '자고', '거든', '잖아', '려고', '도록', '어서', '아서', '해서',
];

const COST = {
  /** 끊는 자리 덤: AI 추천 자리 / 문장부호 뒤 (음수 = 선호) */
  hint: -0.15,
  punct: -0.05,
  /** 한 글자만 남는 줄 (마지막 줄이면 더 나쁨) */
  singleChar: 0.5,
  singleCharLast: 1,
  /** "안 / 돼"처럼 한 글자 어절로 끝나는 줄 */
  shortWordEnd: 0.06,
  /** 어절 안 자르기 (어미 앞이면 덜) */
  breakWord: 0.6,
  breakWordEnding: 0.35,
  /** 어절 안을 잘라 한 글자만 떨어지는 조각 */
  breakWordOrphan: 0.8,
} as const;

interface Piece {
  /** 화면에 그릴 글 (추천 표시 제외) */
  text: string;
  /** 이 조각 앞의 경계: 줄이 이어지면 붙일 글자, 여기서 끊을 때의 덤, 반드시 끊어야 하는지(문단) */
  join: string;
  breakCost: number;
  forced: boolean;
  /** 앞 조각과 같은 어절인지 (어절 안 자르기) */
  inWord: boolean;
}

const PUNCT_END = /[.,!?~…‥。、！？～]$/;

function piecesOf(text: string, splitWord: (word: string) => boolean): Piece[] {
  const pieces: Piece[] = [];
  text.split('\n').forEach((paragraph, p) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    words.forEach((raw, w) => {
      const hinted = raw.startsWith(BREAK_HINT);
      const word = stripBreakHints(raw);
      if (!word) return;
      const prev = pieces[pieces.length - 1];
      let breakCost = 0;
      if (hinted) breakCost += COST.hint;
      if (prev && PUNCT_END.test(prev.text)) breakCost += COST.punct;
      if (prev && Array.from(prev.text).length === 1 && !PUNCT_END.test(prev.text)) breakCost += COST.shortWordEnd;
      const first = { join: ' ', breakCost, forced: p > 0 && w === 0, inWord: false };
      if (!splitWord(word)) {
        pieces.push({ text: word, ...first });
        return;
      }
      const chars = Array.from(word);
      chars.forEach((ch, c) => {
        if (c === 0) {
          pieces.push({ text: ch, ...first });
          return;
        }
        const rest = chars.slice(c).join('');
        const head = chars.slice(0, c).join('');
        const restLetters = rest.replace(/[^\p{L}\p{N}]/gu, '');
        let cost: number = ENDING_STARTS.some(e => rest.startsWith(e)) ? COST.breakWordEnding : COST.breakWord;
        if (Array.from(head).length < 2 || Array.from(restLetters).length < 2) cost += COST.breakWordOrphan;
        // 문장부호만 다음 줄로 넘기지 않음
        if (!restLetters) cost = Infinity;
        pieces.push({ text: ch, join: '', breakCost: cost, forced: false, inWord: true });
      });
    });
  });
  return pieces;
}

/**
 * 줄마다 쓸 수 있는 폭(widths[i])에 맞춰 줄 길이가 고르게 끊습니다. 들어가지 않으면 null.
 * 가장 적은 줄 수를 쓰고(넘는 줄 수는 쓰지 않음), 그 안에서 줄마다 "쓴 폭 ÷ 쓸 수 있는 폭"이 비슷하도록 —
 * 가운데가 넓은 말풍선이면 가운데 줄이 길고 위아래 줄이 짧은 모양이 됨.
 * allowBreakWord면 어느 줄에도 안 들어가는 긴 어절만 글자 단위로 자를 수 있음.
 */
export function balancedWrap(text: string, widths: number[], measure: (t: string) => number, allowBreakWord: boolean): string[] | null {
  const trimmed = text.trim();
  if (!trimmed || widths.length === 0) return null;
  const widest = Math.max(...widths);
  const pieces = piecesOf(trimmed, word => allowBreakWord && measure(word) > widest + 0.01);
  const count = pieces.length;
  if (count === 0) return null;

  // 조각 [a, b)를 한 줄로 이은 글과 폭 (같은 호출 안에서 재사용)
  const lineCache = new Map<number, { text: string; width: number } | null>();
  const lineOf = (a: number, b: number) => {
    const key = a * 1024 + b;
    if (lineCache.has(key)) return lineCache.get(key)!;
    let lineText = pieces[a].text;
    for (let k = a + 1; k < b; k++) {
      if (pieces[k].forced) {
        lineCache.set(key, null);
        return null;
      }
      lineText += pieces[k].join + pieces[k].text;
    }
    const value = { text: lineText, width: measure(lineText) };
    lineCache.set(key, value);
    return value;
  };

  const total = measure(stripBreakHints(trimmed).replace(/\n/g, ' '));
  let sumWidths = 0;
  for (let n = 1; n <= widths.length; n++) {
    sumWidths += widths[n - 1];
    if (sumWidths + 0.01 < total - measure(' ') * (n - 1)) continue;
    const fill = Math.min(1, total / sumWidths);
    // best[k][i]: 앞 조각 i개를 k줄에 넣을 때 가장 작은 비용, from: 그때 마지막 줄의 시작
    const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(count + 1).fill(Infinity));
    const from: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(count + 1).fill(-1));
    best[0][0] = 0;
    for (let k = 1; k <= n; k++) {
      const limit = widths[k - 1] + 0.01;
      const last = k === n;
      for (let i = 1; i <= count; i++) {
        // 다음 줄이 이 자리에서 시작해야 하는데 끊을 수 없는 경계(문장부호만 남는 자리)면 건너뜀
        if (i < count && !Number.isFinite(pieces[i].breakCost)) continue;
        if (last && i !== count) continue;
        for (let j = i - 1; j >= k - 1; j--) {
          if (!Number.isFinite(best[k - 1][j])) continue;
          const line = lineOf(j, i);
          if (!line) break;
          if (line.width > limit) break;
          const letters = Array.from(line.text.replace(/[^\p{L}\p{N}]/gu, '')).length;
          let cost = n > 1 ? (line.width / widths[k - 1] - fill) ** 2 : 0;
          if (n > 1 && letters <= 1) cost += last ? COST.singleCharLast : COST.singleChar;
          if (i < count) cost += pieces[i].breakCost;
          const value = best[k - 1][j] + cost;
          if (value < best[k][i]) {
            best[k][i] = value;
            from[k][i] = j;
          }
        }
      }
    }
    if (!Number.isFinite(best[n][count])) continue;
    const lines: string[] = [];
    let i = count;
    for (let k = n; k >= 1; k--) {
      const j = from[k][i];
      lines.unshift(lineOf(j, i)!.text);
      i = j;
    }
    return lines;
  }
  return null;
}

/** 모든 줄 폭이 같을 때(네모 상자) — 줄 수는 maxLines까지 */
export function balancedWrapUniform(text: string, width: number, measure: (t: string) => number, allowBreakWord: boolean, maxLines = 64): string[] | null {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    const wrapped = balancedWrap(paragraph, new Array<number>(maxLines).fill(width), measure, allowBreakWord);
    if (!wrapped) return null;
    lines.push(...wrapped);
  }
  return lines;
}

/**
 * 한글 글자(잉크)가 줄 상자 가운데에 오도록 아래로 옮길 거리 (글자 크기 배수).
 * 글꼴의 위아래 여백이 달라 줄 상자 기준 가운데에 두면 글자가 살짝 위·아래로 치우쳐 보임.
 * 글꼴마다 한 번만 재고, 잘못 잰 값으로 크게 틀어지지 않게 ±0.08 안으로.
 */
const inkShiftCache = new Map<string, number>();
export function inkCenterShiftEm(fontFamily: string, fontWeight: number): number {
  const key = `${fontWeight} ${fontFamily}`;
  const cached = inkShiftCache.get(key);
  if (cached !== undefined) return cached;
  let shift = 0;
  try {
    const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    if (ctx) {
      ctx.font = `${fontWeight} 100px ${fontFamily}`;
      const m = ctx.measureText('한글가나다');
      if (m.fontBoundingBoxAscent && m.actualBoundingBoxAscent) {
        const boxCenter = (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;
        const inkCenter = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
        shift = Math.max(-0.08, Math.min(0.08, (inkCenter - boxCenter) / 100));
      }
    }
  } catch {
    shift = 0;
  }
  inkShiftCache.set(key, shift);
  return shift;
}
