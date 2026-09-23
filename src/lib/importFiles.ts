import JSZip from 'jszip';
import type { Correction } from './corrections';
import type { Glossary, TranslationCache, UploadedImage } from '../types';
import { extractMangaZip } from './drive';
import { basename, isImageEntryPath, mimeTypeFromPath, naturalCompare, stripArchiveExtension } from './fileImport';
import { loadImage } from './imageUtils';
import { sanitizeResults } from './results';

export interface ImportResult {
  /** backup: 백업 ZIP 복원(현재 작업을 대체) / append: 현재 작업에 이미지 추가 */
  mode: 'backup' | 'append';
  images: UploadedImage[];
  translations: TranslationCache;
  glossary?: Glossary;
  /** 백업에 들어 있던 작품 노트 */
  notes?: string;
  /** 백업에 들어 있던 "내가 고친 번역" 기록 */
  corrections?: Correction[];
  lastReadPage?: number;
  /** 작품 이름으로 표시할 압축 파일 이름 (확장자 없음) */
  loadedFilename?: string;
  /** 백업 ZIP의 원래 파일 이름 (확장자 포함) — 드라이브 저장 기본 이름으로 사용 */
  archiveFileName?: string;
  failedImages: number;
  jsonFailed: boolean;
}

/**
 * 파일을 화면에 띄울 이미지로 만듭니다.
 * 주소는 파일을 가리키는 object URL(blob:)이라, 예전처럼 base64 글자로 통째로 메모리에 올리지 않습니다.
 * (100장이면 수백 MB가 문자열로 떠 있었음) API로 보낼 때만 그 페이지를 base64로 읽고, 작업을 닫으면 해제합니다.
 */
export async function toUploadedImage(file: File, sortKey: string, mimeType: string): Promise<UploadedImage> {
  const src = URL.createObjectURL(file);
  let imageObj: HTMLImageElement;
  try {
    imageObj = await loadImage(src);
  } catch (error) {
    URL.revokeObjectURL(src);
    throw error;
  }
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
async function loadCandidates(candidates: { file: File; sortKey: string; mimeType?: string }[]) {
  const images: UploadedImage[] = [];
  let failed = 0;
  for (const { file, sortKey, mimeType } of candidates) {
    try {
      images.push(await toUploadedImage(file, sortKey, mimeType || file.type || mimeTypeFromPath(file.name)));
    } catch (err) {
      console.warn('이미지 로드 실패:', file.name, err);
      failed++;
    }
  }
  return { images, failed };
}

/** 백업 ZIP(manga_data.json 포함)을 읽습니다. */
export async function importBackupZip(zipBlob: Blob, name: string): Promise<ImportResult> {
  const { images, translations, lastReadPage, glossary, notes, corrections } = await extractMangaZip(zipBlob);
  const loaded = await loadCandidates(images.map(img => ({ file: img.file, sortKey: img.file.name, mimeType: img.mimeType })));
  return {
    mode: 'backup',
    images: loaded.images,
    translations,
    glossary,
    notes,
    corrections,
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
    if (zip.file('manga_data.json')) {
      const restored = await importBackupZip(archiveFile, stripArchiveExtension(archiveFile.name));
      return { ...restored, archiveFileName: archiveFile.name };
    }

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

/**
 * 다른 권(압축 파일)을 지금 작업 **뒤에** 이어 붙입니다. 같은 파일(이름+크기)은 건너뜁니다.
 * mergeImages처럼 전체를 파일 이름순으로 다시 정렬하면, 권마다 001.jpg부터 시작하는 경우
 * 1권·2권 페이지가 번갈아 섞이므로 기존 순서를 그대로 두고 새 권은 그 뒤에 붙입니다.
 */
export function appendImages<T extends { file: { name: string; size: number }; sortKey: string }>(existing: T[], incoming: T[]): T[] {
  const isDuplicate = (image: T) => existing.some(e => e.file.name === image.file.name && e.file.size === image.file.size);
  const added = incoming.filter(image => !isDuplicate(image)).sort((a, b) => naturalCompare(a.sortKey, b.sortKey));
  return [...existing, ...added];
}

/** 낱장 이미지를 지금 작업에 추가합니다. 같은 파일(이름+크기)은 건너뛰고 자연 정렬합니다. */
export function mergeImages<T extends { file: { name: string; size: number }; sortKey: string }>(existing: T[], incoming: T[]): T[] {
  const combined = [...existing];
  for (const image of incoming) {
    if (!combined.some(e => e.file.name === image.file.name && e.file.size === image.file.size)) combined.push(image);
  }
  return combined.sort((a, b) => naturalCompare(a.sortKey, b.sortKey));
}

/** 화면에서 내린 이미지의 object URL을 해제합니다. (data: 주소는 해제할 것이 없음) */
export function revokeImageUrls(images: { src: string }[]) {
  images.forEach(image => {
    if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
  });
}
