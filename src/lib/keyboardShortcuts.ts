/**
 * 뷰어 키보드 단축키. 일본 만화는 오른쪽에서 왼쪽으로 넘기므로 화면의 페이지 버튼과 같은 방향으로:
 * ← 다음 페이지 / → 이전 페이지 / + 확대 / - 축소 / E 영역 수정 켜기·끄기 / Ctrl(⌘)+Z 말풍선 편집 되돌리기
 */
export type ShortcutAction = 'next' | 'prev' | 'zoomIn' | 'zoomOut' | 'toggleEdit' | 'undo';

interface KeyLike {
  key: string;
  /** 자판 위치 (한글 입력 상태에서는 key가 'ㄷ'·'ㅋ'로 오므로 위치로 판단) */
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  target?: EventTarget | null;
}

/** 글자를 입력하는 중인 곳(입력칸·드롭다운·편집 가능한 영역)인지 */
function isTypingTarget(target: EventTarget | null | undefined): boolean {
  const el = target as HTMLElement | null | undefined;
  if (!el || typeof el.tagName !== 'string') return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.isContentEditable;
}

export function shortcutFor(event: KeyLike): ShortcutAction | null {
  // 글자를 입력 중인 곳·한글 조합 중에는 건드리지 않음 (입력칸의 Ctrl+Z는 그 칸의 되돌리기)
  if (event.isComposing || isTypingTarget(event.target)) return null;
  const isKey = (letter: string) => event.code === `Key${letter.toUpperCase()}` || event.key.toLowerCase() === letter;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && isKey('z')) return 'undo';
  // 그 밖의 브라우저 단축키(Ctrl/⌘ + =, 뒤로 가기 등)는 건드리지 않음
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isKey('e')) return 'toggleEdit';
  switch (event.key) {
    case 'ArrowLeft': return 'next';
    case 'ArrowRight': return 'prev';
    case '+':
    case '=': return 'zoomIn';
    case '-':
    case '_': return 'zoomOut';
    default: return null;
  }
}
