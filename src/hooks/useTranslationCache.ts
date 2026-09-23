import { useEffect, useRef, useState } from 'react';
import { buildCacheKey } from '../lib/cacheKey';
import { deleteTranslations, loadTranslations, migrateLocalStorageTranslations, saveTranslation } from '../lib/translationStore';
import type { TranslationCache, TranslationResult, UploadedImage } from '../types';

export const getCacheKey = (file: File) => buildCacheKey(file.name, file.size);

interface UpdateOptions {
  /** false면 화면에만 반영 (예: "번역 중..." 임시 말풍선) */
  persist?: boolean;
  /** 캐시가 없는 페이지면 빈 배열에서 시작 */
  createIfMissing?: boolean;
}

const isQuotaError = (error: unknown) => (error as DOMException)?.name === 'QuotaExceededError';

/**
 * 번역 기록(페이지별 번역 배열). 저장은 IndexedDB(lib/translationStore), 화면에는 지금 연 페이지 것만 읽어 둡니다.
 * isCacheReady가 false인 동안에는 아직 기록을 읽는 중이므로 자동 번역을 시작하면 안 됩니다. (이미 번역한 페이지를 다시 요청하게 됨)
 */
export function useTranslationCache(images: UploadedImage[], workKey: string, onStorageFull: () => void) {
  const [translationCache, setTranslationCache] = useState<TranslationCache>({});
  /** IndexedDB에서 읽기를 마친 페이지 (기록이 없던 페이지 포함) */
  const [loadedKeys, setLoadedKeys] = useState<Set<string>>(() => new Set());
  const loadedKeysRef = useRef(loadedKeys);
  const workKeyRef = useRef(workKey);
  const onStorageFullRef = useRef(onStorageFull);
  useEffect(() => {
    loadedKeysRef.current = loadedKeys;
    workKeyRef.current = workKey;
    onStorageFullRef.current = onStorageFull;
  });

  const persist = (key: string, results: TranslationResult[], workKey: string | undefined = workKeyRef.current) => {
    saveTranslation(key, results, workKey).catch(error => {
      console.error('번역 기록 저장 실패:', error);
      if (isQuotaError(error)) onStorageFullRef.current();
    });
  };

  // 새로 연 페이지의 번역 기록을 읽어 옴 (처음 한 번은 localStorage의 예전 기록을 먼저 복사)
  useEffect(() => {
    const keys = images.map(img => getCacheKey(img.file)).filter(key => !loadedKeysRef.current.has(key));
    if (keys.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        await migrateLocalStorageTranslations();
        const loaded = await loadTranslations(keys, workKeyRef.current);
        if (cancelled) return;
        // 읽는 사이 화면에서 새로 번역된 페이지가 있으면 그쪽이 최신
        setTranslationCache(prev => ({ ...loaded, ...prev }));
      } catch (error) {
        if (cancelled) return;
        // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이어도 번역은 되도록, 기록 없이 진행
        console.error('번역 기록을 읽지 못했습니다:', error);
      }
      setLoadedKeys(prev => new Set([...prev, ...keys]));
    })();
    return () => {
      cancelled = true;
    };
  }, [images]);

  const isCacheReady = images.every(img => loadedKeys.has(getCacheKey(img.file)));

  /** 한 페이지의 번역 배열을 갱신합니다. updater가 null을 돌려주면 그 페이지 캐시를 지웁니다(다시 자동 번역 대상이 됨). */
  const updatePageResults = (key: string, updater: (results: TranslationResult[]) => TranslationResult[] | null, options: UpdateOptions = {}) => {
    const { persist: shouldPersist = true, createIfMissing = false } = options;
    setTranslationCache(prev => {
      const current = prev[key] ?? (createIfMissing ? [] : undefined);
      if (!current) return prev;
      const next = updater(current);
      if (next === null) {
        deleteTranslations([key]).catch(error => console.error('번역 기록 삭제 실패:', error));
        const rest = { ...prev };
        delete rest[key];
        return rest;
      }
      if (shouldPersist) persist(key, next);
      return { ...prev, [key]: next };
    });
  };

  const setPageResults = (key: string, results: TranslationResult[]) => {
    persist(key, results);
    setTranslationCache(prev => ({ ...prev, [key]: results }));
  };

  const mergeTranslations = (entries: TranslationCache) => {
    const keys = Object.keys(entries);
    if (keys.length === 0) return;
    // 가져온 기록은 아직 어느 작품인지 확정 전(가져오기로 작품이 바뀌는 중)이라 작품 표시 없이 저장하고,
    // 새 페이지를 읽어 들일 때 그때의 작품으로 표시됨 (translationStore.loadTranslations)
    keys.forEach(key => persist(key, entries[key], undefined));
    setTranslationCache(prev => ({ ...prev, ...entries }));
  };

  const removePages = (keys: string[]) => {
    deleteTranslations(keys).catch(error => console.error('번역 기록 삭제 실패:', error));
    forgetPages(keys);
  };

  /** 저장소에서 이미 지운 페이지를 화면에서도 지움 (저장소 창에서 작품 기록을 지웠을 때) */
  const forgetPages = (keys: string[]) => {
    setTranslationCache(prev => {
      const next = { ...prev };
      keys.forEach(key => delete next[key]);
      return next;
    });
  };

  return { translationCache, isCacheReady, updatePageResults, setPageResults, mergeTranslations, removePages, forgetPages };
}
