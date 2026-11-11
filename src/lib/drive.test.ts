import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCacheKey } from './cacheKey';
import { createMangaZip, defaultBackupFilename, extractMangaZip, uploadToGoogleDrive } from './drive';

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

describe('uploadToGoogleDrive', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (existing: { id: string }[]) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/drive/v3/files?q=')) return new Response(JSON.stringify({ files: existing }), { status: 200 });
      return new Response(JSON.stringify({ id: 'new-id' }), { status: 200 });
    });
    return calls;
  };

  it('같은 이름이 없으면 새로 만들고, 메타데이터와 ZIP 내용을 그대로 이어 보낸다', async () => {
    const calls = stubFetch([]);
    const id = await uploadToGoogleDrive('token', new Blob(['ZIPDATA'], { type: 'application/zip' }), "It's.zip");
    expect(id).toBe('new-id');
    expect(decodeURIComponent(calls[0].url)).toContain("name='It\\'s.zip'");
    expect(calls[1].init?.method).toBe('POST');
    const body = await (calls[1].init!.body as Blob).text();
    expect(body).toContain('{"name":"It\'s.zip","mimeType":"application/zip"}');
    expect(body).toContain('Content-Type: application/zip\r\n\r\nZIPDATA\r\n--');
    expect((calls[1].init!.body as Blob).type).toContain('multipart/related; boundary=');
  });

  it('같은 이름이 있으면 그 파일을 덮어쓰고, 권한이 만료됐으면 AUTH_EXPIRED', async () => {
    const calls = stubFetch([{ id: 'old' }]);
    await uploadToGoogleDrive('token', new Blob(['x']), 'a.zip');
    expect(calls[1].url).toContain('/files/old?uploadType=multipart');
    expect(calls[1].init?.method).toBe('PATCH');

    vi.stubGlobal('fetch', async () => new Response('', { status: 401 }));
    await expect(uploadToGoogleDrive('token', new Blob(['x']), 'a.zip')).rejects.toThrow('AUTH_EXPIRED');
  });
});
