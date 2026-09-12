import { describe, expect, it } from 'vitest';
import { defaultBackupFilename } from './drive';

describe('defaultBackupFilename', () => {
  it('드라이브에서 불러오거나 저장한 이름이 있으면 그 이름을 그대로 쓴다 (덮어쓰기용)', () => {
    expect(defaultBackupFilename('내 번역본.zip', '【一般コミック】원문명')).toBe('내 번역본.zip');
  });

  it('드라이브 이름이 없으면 작품 이름으로 만든다', () => {
    expect(defaultBackupFilename(null, '원피스 1권')).toBe('원피스 1권.zip');
  });

  it('둘 다 없으면 날짜로 만든다', () => {
    expect(defaultBackupFilename(null, null, new Date('2026-09-12T01:02:03.000Z'))).toBe('Manga_2026-09-12T01-02-03-000Z.zip');
  });

  it('공백만 있는 이름은 무시한다', () => {
    expect(defaultBackupFilename('   ', '작품')).toBe('작품.zip');
  });
});
