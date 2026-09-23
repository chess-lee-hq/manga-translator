import { describe, expect, it } from 'vitest';
import { shortcutFor } from './keyboardShortcuts';

describe('shortcutFor', () => {
  it('만화 넘기는 방향대로 ←는 다음, →는 이전', () => {
    expect(shortcutFor({ key: 'ArrowLeft' })).toBe('next');
    expect(shortcutFor({ key: 'ArrowRight' })).toBe('prev');
  });

  it('+/=는 확대, -는 축소', () => {
    expect(shortcutFor({ key: '+' })).toBe('zoomIn');
    expect(shortcutFor({ key: '=' })).toBe('zoomIn');
    expect(shortcutFor({ key: '-' })).toBe('zoomOut');
  });

  it('입력칸에서 치거나 조합키와 함께 누르면 무시', () => {
    expect(shortcutFor({ key: 'ArrowLeft', target: { tagName: 'TEXTAREA' } as unknown as EventTarget })).toBeNull();
    expect(shortcutFor({ key: 'ArrowLeft', target: { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget })).toBeNull();
    expect(shortcutFor({ key: '=', metaKey: true })).toBeNull();
    expect(shortcutFor({ key: 'ArrowLeft', isComposing: true })).toBeNull();
    expect(shortcutFor({ key: 'a' })).toBeNull();
  });
});
