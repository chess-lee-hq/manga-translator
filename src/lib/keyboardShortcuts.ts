/**
 * 뷰어 키보드 단축키. 일본 만화는 오른쪽에서 왼쪽으로 넘기므로 화면의 페이지 버튼과 같은 방향으로:
 * ← 다음 페이지 / → 이전 페이지 / + 확대 / - 축소
 */
export type ShortcutAction = 'next' | 'prev' | 'zoomIn' | 'zoomOut';

interface KeyLike {
  key: string;
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
  // 브라우저 단축키(Ctrl/⌘ + =, 뒤로 가기 등)와 한글 조합 중 입력은 건드리지 않음
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
  if (isTypingTarget(event.target)) return null;
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
