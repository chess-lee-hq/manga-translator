const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function basename(path: string): string {
  return path.split('/').pop() || path;
}

function getExtension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * ZIP/CBZ 내부 경로가 실제 만화 이미지인지 판별합니다.
 * - macOS Finder 압축이 끼워 넣는 `__MACOSX/` 메타데이터와 `._파일`, 숨김 파일을 제외
 * - 확장자는 대소문자 구분 없이 비교 (.JPG, .PNG 허용)
 */
export function isImageEntryPath(path: string): boolean {
  const segments = path.split('/');
  if (segments.includes('__MACOSX')) return false;
  const name = segments[segments.length - 1];
  if (!name || name.startsWith('.')) return false;
  return Object.hasOwn(IMAGE_MIME_BY_EXTENSION, getExtension(name));
}

export function mimeTypeFromPath(path: string): string {
  return IMAGE_MIME_BY_EXTENSION[getExtension(path)] ?? 'application/octet-stream';
}

/** 숫자를 인식하는 자연 정렬: 1.jpg, 2.jpg, 10.jpg 순서 */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function stripArchiveExtension(name: string): string {
  return name.replace(/\.(zip|cbz)$/i, '');
}
