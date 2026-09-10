import { describe, expect, it } from 'vitest';
import { basename, isImageEntryPath, mimeTypeFromPath, naturalCompare, stripArchiveExtension } from './fileImport';

describe('isImageEntryPath', () => {
  it('일반 이미지와 대문자 확장자를 허용한다', () => {
    expect(isImageEntryPath('001.jpg')).toBe(true);
    expect(isImageEntryPath('vol1/002.JPG')).toBe(true);
    expect(isImageEntryPath('003.Png')).toBe(true);
    expect(isImageEntryPath('004.webp')).toBe(true);
  });

  it('macOS 메타데이터, 숨김 파일, 이미지가 아닌 파일은 제외한다', () => {
    expect(isImageEntryPath('__MACOSX/._001.jpg')).toBe(false);
    expect(isImageEntryPath('__MACOSX/vol1/._002.jpg')).toBe(false);
    expect(isImageEntryPath('vol1/._003.jpg')).toBe(false);
    expect(isImageEntryPath('.DS_Store')).toBe(false);
    expect(isImageEntryPath('manga_data.json')).toBe(false);
    expect(isImageEntryPath('folder/')).toBe(false);
    expect(isImageEntryPath('constructor')).toBe(false);
  });
});

describe('naturalCompare', () => {
  it('숫자를 인식해 정렬한다', () => {
    expect(['10.jpg', '2.jpg', '1.jpg'].sort(naturalCompare)).toEqual(['1.jpg', '2.jpg', '10.jpg']);
  });

  it('폴더 경로를 기준으로 챕터가 섞이지 않는다', () => {
    expect(['ch2/001.jpg', 'ch1/002.jpg', 'ch1/001.jpg', 'ch10/001.jpg', 'ch2/002.jpg'].sort(naturalCompare)).toEqual([
      'ch1/001.jpg',
      'ch1/002.jpg',
      'ch2/001.jpg',
      'ch2/002.jpg',
      'ch10/001.jpg',
    ]);
  });
});

describe('경로 유틸', () => {
  it('확장자·파일명을 처리한다', () => {
    expect(mimeTypeFromPath('a/B.JPEG')).toBe('image/jpeg');
    expect(basename('a/b/c.png')).toBe('c.png');
    expect(stripArchiveExtension('One Piece 01.CBZ')).toBe('One Piece 01');
    expect(stripArchiveExtension('my.zip.backup.zip')).toBe('my.zip.backup');
  });
});
