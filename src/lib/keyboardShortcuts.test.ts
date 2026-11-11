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

  it('E는 영역 수정, Ctrl·⌘+Z는 되돌리기 (한글 자판·입력칸 고려)', () => {
    expect(shortcutFor({ key: 'e' })).toBe('toggleEdit');
    expect(shortcutFor({ key: 'ㄷ', code: 'KeyE' })).toBe('toggleEdit');
    expect(shortcutFor({ key: 'z', metaKey: true })).toBe('undo');
    expect(shortcutFor({ key: 'ㅋ', code: 'KeyZ', ctrlKey: true })).toBe('undo');
    expect(shortcutFor({ key: 'z', metaKey: true, shiftKey: true })).toBeNull();
    expect(shortcutFor({ key: 'z' })).toBeNull();
    expect(shortcutFor({ key: 'z', metaKey: true, target: { tagName: 'INPUT' } as unknown as EventTarget })).toBeNull();
    expect(shortcutFor({ key: 'e', metaKey: true })).toBeNull();
  });
});
