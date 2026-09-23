import { describe, expect, it } from 'vitest';
import { buildCacheKey } from './cacheKey';
import { createMangaZip, defaultBackupFilename, extractMangaZip } from './drive';

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

describe('백업 ZIP 만들기·풀기', () => {
  it('이미지는 파일 그대로 담기고, 풀었을 때 같은 바이트·번역으로 돌아온다', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const file = new File([bytes], 'p1.png', { type: 'image/png' });
    const results = [{ id: 'a', original_text: 'あ', translated_text: '가', box_2d: [0, 0, 10, 10] as [number, number, number, number] }];
    const zip = await createMangaZip([{ file, mimeType: 'image/png' }], { [buildCacheKey('p1.png', file.size)]: results }, 0);

    const restored = await extractMangaZip(zip);
    const restoredFile = restored.images[0].file;
    expect(new Uint8Array(await restoredFile.arrayBuffer())).toEqual(bytes);
    expect(restored.translations[buildCacheKey(restoredFile.name, restoredFile.size)]?.[0].translated_text).toBe('가');
  });
});
