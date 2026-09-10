import { useEffect, useRef, useState } from 'react';
import { readFileAsDataURL } from '../lib/imageUtils';
import { toUploadedImage } from '../lib/importFiles';
import { clearSession, loadSession, saveSession, updateSessionMeta } from '../lib/sessionStore';
import type { UploadedImage } from '../types';
import { getCacheKey } from './useTranslationCache';

const SAVE_DELAY_MS = 500;
const META_SAVE_DELAY_MS = 300;

export interface RestoredSession {
  images: UploadedImage[];
  loadedFilename: string | null;
  currentPageIndex: number;
}

interface Options {
  images: UploadedImage[];
  loadedFilename: string | null;
  currentPageIndex: number;
  onRestore: (session: RestoredSession) => void;
  /** true인 동안(예: ZIP 내보내기 중)에는 페이지 이탈 시 경고 */
  isBusy: boolean;
}

/**
 * 이미지와 읽던 위치를 IndexedDB에 저장해 새로고침해도 작업을 이어갑니다.
 * IndexedDB를 쓸 수 없는 환경(일부 사생활 보호 모드)에서는 예전처럼 이탈 시 경고만 합니다.
 */
export function useSessionPersistence({ images, loadedFilename, currentPageIndex, onRestore, isBusy }: Options) {
  const [isRestoring, setIsRestoring] = useState(true);
  const [isAvailable, setIsAvailable] = useState(true);

  const imagesRef = useRef(images);
  const currentPageRef = useRef(currentPageIndex);
  const isBusyRef = useRef(isBusy);
  const pendingSavesRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    imagesRef.current = images;
    isBusyRef.current = isBusy;
  });

  /** 저장 작업을 순서대로 실행 (동시에 쓰면 페이지 목록이 꼬일 수 있음) */
  const enqueueSave = (task: () => Promise<void>) => {
    const run = saveChainRef.current.then(task).catch(err => {
      console.warn('작업 저장 실패:', err);
    });
    saveChainRef.current = run;
    return run;
  };

  // 1) 처음 열 때 저장된 작업 복원
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await loadSession();
        // 복원이 끝나기 전에 사용자가 이미 파일을 올렸으면 그 작업을 우선
        if (!session || cancelled || imagesRef.current.length > 0) return;

        const restored: UploadedImage[] = [];
        for (const page of session.pages) {
          const file = new File([page.blob], page.name, { type: page.mimeType, lastModified: page.lastModified });
          try {
            restored.push(await toUploadedImage(file, await readFileAsDataURL(file), page.sortKey, page.mimeType));
          } catch (err) {
            console.warn('저장된 페이지 복원 실패:', page.name, err);
          }
        }
        if (cancelled || imagesRef.current.length > 0 || restored.length === 0) return;

        onRestore({
          images: restored,
          loadedFilename: session.meta.loadedFilename,
          currentPageIndex: Math.min(Math.max(0, session.meta.currentPageIndex), restored.length - 1),
        });
      } catch (err) {
        console.warn('이전 작업을 복원할 수 없습니다 (IndexedDB):', err);
        if (!cancelled) setIsAvailable(false);
      } finally {
        if (!cancelled) setIsRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2) 이미지 목록이 바뀌면 저장. 복원이 끝나기 전에는 저장하지 않아 기존 작업을 빈 목록으로 덮어쓰지 않음
  useEffect(() => {
    if (isRestoring || !isAvailable) return;
    const pendingSaves = pendingSavesRef;
    pendingSaves.current++;
    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
      const pages = images.map(img => ({ key: getCacheKey(img.file), file: img.file, mimeType: img.mimeType, sortKey: img.sortKey }));
      const meta = { loadedFilename, currentPageIndex: currentPageRef.current };
      enqueueSave(() => (pages.length > 0 ? saveSession(pages, meta) : clearSession())).finally(() => {
        pendingSaves.current--;
      });
    }, SAVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      if (!fired) pendingSaves.current--;
    };
  }, [images, loadedFilename, isRestoring, isAvailable]);

  // 3) 읽던 위치만 바뀌면 메타 정보만 갱신
  useEffect(() => {
    currentPageRef.current = currentPageIndex;
    if (isRestoring || !isAvailable || images.length === 0) return;
    const timer = setTimeout(() => {
      enqueueSave(() => updateSessionMeta({ currentPageIndex }));
    }, META_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [currentPageIndex]);

  // 4) 저장이 끝나지 않았거나 내보내기 중이면 페이지 이탈 경고
  useEffect(() => {
    const warnBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasUnsaved = pendingSavesRef.current > 0 || (!isAvailable && imagesRef.current.length > 0);
      if (!hasUnsaved && !isBusyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isAvailable]);

  return { isRestoring, isPersistenceAvailable: isAvailable };
}
