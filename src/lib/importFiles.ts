import JSZip from 'jszip';
import type { Glossary, TranslationCache, UploadedImage } from '../types';
import { extractMangaZip } from './drive';
import { basename, isImageEntryPath, mimeTypeFromPath, naturalCompare, stripArchiveExtension } from './fileImport';
import { loadImage, readFileAsDataURL } from './imageUtils';
import { sanitizeResults } from './results';

export interface ImportResult {
  /** backup: 백업 ZIP 복원(현재 작업을 대체) / append: 현재 작업에 이미지 추가 */
  mode: 'backup' | 'append';
  images: UploadedImage[];
  translations: TranslationCache;
  glossary?: Glossary;
  lastReadPage?: number;
  /** 작품 이름으로 표시할 압축 파일 이름 */
  loadedFilename?: string;
  failedImages: number;
  jsonFailed: boolean;
}

export async function toUploadedImage(file: File, src: string, sortKey: string, mimeType: string): Promise<UploadedImage> {
  const imageObj = await loadImage(src);
  return {
    src,
    file,
    mimeType,
    sortKey,
    width: imageObj.width,
    height: imageObj.height,
    isSpread: imageObj.width > imageObj.height,
  };
}

/** 이미지 후보를 읽습니다. 한 장이 깨져도 나머지는 계속 읽고, 실패 수를 돌려줍니다. */
async function loadCandidates(candidates: { file: File; sortKey: string; src?: string; mimeType?: string }[]) {
  const images: UploadedImage[] = [];
  let failed = 0;
  for (const { file, sortKey, src, mimeType } of candidates) {
    try {
      images.push(await toUploadedImage(file, src ?? (await readFileAsDataURL(file)), sortKey, mimeType || file.type || mimeTypeFromPath(file.name)));
    } catch (err) {
      console.warn('이미지 로드 실패:', file.name, err);
      failed++;
    }
  }
  return { images, failed };
}

/** 백업 ZIP(manga_data.json 포함)을 읽습니다. */
export async function importBackupZip(zipBlob: Blob, name: string): Promise<ImportResult> {
  const { images, translations, lastReadPage, glossary } = await extractMangaZip(zipBlob);
  const loaded = await loadCandidates(images.map(img => ({ file: img.file, sortKey: img.file.name, src: img.src, mimeType: img.mimeType })));
  return {
    mode: 'backup',
    images: loaded.images,
    translations,
    glossary,
    lastReadPage,
    loadedFilename: name,
    failedImages: loaded.failed,
    jsonFailed: false,
  };
}

/** 드롭하거나 선택한 파일(이미지, ZIP/CBZ, 백업 ZIP, 번역 JSON)을 읽습니다. 지원하는 파일이 없으면 null. */
export async function importFiles(fileList: FileList | File[]): Promise<ImportResult | null> {
  const files = Array.from(fileList);
  const looseImages = files.filter(f => f.type.startsWith('image/') || isImageEntryPath(f.name));
  const jsonFile = files.find(f => f.name.toLowerCase().endsWith('.json'));
  const archiveFile = files.find(f => /\.(zip|cbz)$/i.test(f.name));
  if (looseImages.length === 0 && !archiveFile && !jsonFile) return null;

  const candidates = looseImages.map(file => ({ file, sortKey: file.webkitRelativePath || file.name }));
  let loadedFilename: string | undefined;

  if (archiveFile) {
    const zip = await JSZip.loadAsync(archiveFile);
    if (zip.file('manga_data.json')) return importBackupZip(archiveFile, stripArchiveExtension(archiveFile.name));

    loadedFilename = stripArchiveExtension(archiveFile.name);
    // __MACOSX 메타데이터·숨김 파일은 제외하고, 확장자는 대소문자 구분 없이 판별
    const entries = Object.values(zip.files).filter(entry => !entry.dir && isImageEntryPath(entry.name));
    for (const entry of entries) {
      const blob = await entry.async('blob');
      candidates.push({
        file: new File([blob], basename(entry.name), { type: mimeTypeFromPath(entry.name) }),
        // 폴더 경로까지 정렬 기준으로 써서 ch1/001, ch2/001이 섞이지 않게 함
        sortKey: entry.name,
      });
    }
  }

  const translations: TranslationCache = {};
  let jsonFailed = false;
  if (jsonFile) {
    try {
      const imported = JSON.parse(await jsonFile.text());
      for (const key of Object.keys(imported)) {
        if (!key.startsWith('manga-cache-')) continue;
        const sanitized = sanitizeResults(imported[key]);
        if (sanitized) translations[key] = sanitized;
      }
    } catch (err) {
      console.error('JSON 파싱 에러:', err);
      jsonFailed = true;
    }
  }

  const loaded = await loadCandidates(candidates);
  return { mode: 'append', images: loaded.images, translations, loadedFilename, failedImages: loaded.failed, jsonFailed };
}

/** 기존 이미지에 새 이미지를 합칩니다. 같은 파일(이름+크기)은 건너뛰고 자연 정렬합니다. */
export function mergeImages<T extends { file: { name: string; size: number }; sortKey: string }>(existing: T[], incoming: T[]): T[] {
  const combined = [...existing];
  for (const image of incoming) {
    if (!combined.some(e => e.file.name === image.file.name && e.file.size === image.file.size)) combined.push(image);
  }
  return combined.sort((a, b) => naturalCompare(a.sortKey, b.sortKey));
}
