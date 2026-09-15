/** 말줄임표로 쓰이는 점 문자. …(U+2026)는 점 3개, ‥(U+2025)는 점 2개로 셈 */
const DOT_RUN = /[.．。・·…‥]+/g;

/**
 * 번역문의 말줄임표를 점 2개(..)로 통일합니다.
 * 원문의 "……"가 점 개수만큼 번역에 옮겨져 말풍선 줄바꿈·글자 크기를 망가뜨리는 경우가 많아,
 * 점이 3개 이상 이어지거나 말줄임 문자(…·‥)가 들어간 자리는 무조건 ".."로 바꿉니다.
 * 점 하나(마침표)나 가운뎃점 하나(이름 구분)는 그대로 둡니다.
 */
export function normalizeEllipsis(text: string): string {
  return text.replace(DOT_RUN, run => {
    const chars = Array.from(run);
    const dots = chars.reduce((count, ch) => count + (ch === '…' ? 3 : ch === '‥' ? 2 : 1), 0);
    return dots >= 3 || chars.some(ch => ch === '…' || ch === '‥') ? '..' : run;
  });
}
