import { useEffect, useState } from 'react';
import { buildCacheKey } from '../lib/cacheKey';
import { sanitizeResults } from '../lib/results';
import type { TranslationCache, TranslationResult, UploadedImage } from '../types';

const CACHE_PREFIX = 'manga-cache-';

export const getCacheKey = (file: File) => buildCacheKey(file.name, file.size);

/** localStorage의 번역 캐시를 읽습니다. 좌표가 깨진 항목은 걸러냅니다. */
function loadCacheFromStorage(): TranslationCache {
  const cache: TranslationCache = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CACHE_PREFIX)) continue;
    try {
      const sanitized = sanitizeResults(JSON.parse(localStorage.getItem(key) || '[]'));
      if (sanitized) cache[key] = sanitized;
    } catch {
      console.warn('손상된 번역 캐시를 건너뜁니다:', key);
    }
  }
  return cache;
}

interface UpdateOptions {
  /** false면 화면에만 반영 (예: "번역 중..." 임시 말풍선) */
  persist?: boolean;
  /** 캐시가 없는 페이지면 빈 배열에서 시작 */
  createIfMissing?: boolean;
}

export function useTranslationCache(images: UploadedImage[], onStorageFull: () => void) {
  const [translationCache, setTranslationCache] = useState<TranslationCache>(loadCacheFromStorage);

  const persist = (key: string, results: TranslationResult[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(results));
    } catch (err) {
      console.error(err);
      onStorageFull();
    }
  };

  /** 한 페이지의 번역 배열을 갱신합니다. updater가 null을 돌려주면 그 페이지 캐시를 지웁니다(다시 자동 번역 대상이 됨). */
  const updatePageResults = (key: string, updater: (results: TranslationResult[]) => TranslationResult[] | null, options: UpdateOptions = {}) => {
    const { persist: shouldPersist = true, createIfMissing = false } = options;
    setTranslationCache(prev => {
      const current = prev[key] ?? (createIfMissing ? [] : undefined);
      if (!current) return prev;
      const next = updater(current);
      if (next === null) {
        localStorage.removeItem(key);
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
    keys.forEach(key => persist(key, entries[key]));
    setTranslationCache(prev => ({ ...prev, ...entries }));
  };

  const removePages = (keys: string[]) => {
    keys.forEach(key => localStorage.removeItem(key));
    setTranslationCache(prev => {
      const next = { ...prev };
      keys.forEach(key => delete next[key]);
      return next;
    });
  };

  const clearAll = () => {
    Object.keys(localStorage)
      .filter(key => key.startsWith(CACHE_PREFIX))
      .forEach(key => localStorage.removeItem(key));
    setTranslationCache({});
  };

  // 예전 형식(제공자·모델별로 나뉜 키)의 캐시를 통합 키로 옮김
  useEffect(() => {
    if (images.length === 0) return;
    setTranslationCache(prev => {
      let next: TranslationCache | null = null;
      for (const img of images) {
        const unifiedKey = getCacheKey(img.file);
        if (prev[unifiedKey]?.length) continue;
        const suffix = `-${img.file.name}-${img.file.size}`;
        const bestOldKey = Object.keys(prev)
          .filter(k => k !== unifiedKey && k.endsWith(suffix))
          .reduce<string | null>((best, k) => (!best || prev[k].length > prev[best].length ? k : best), null);
        if (bestOldKey && prev[bestOldKey].length > 0) {
          next ??= { ...prev };
          next[unifiedKey] = [...prev[bestOldKey]];
          persist(unifiedKey, next[unifiedKey]);
        }
      }
      return next ?? prev;
    });
  }, [images]);

  return { translationCache, updatePageResults, setPageResults, mergeTranslations, removePages, clearAll };
}
