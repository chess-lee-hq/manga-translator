import type { TranslationCache, TranslationResult } from '../types';
import { getDb, requestToPromise, transactionDone, TRANSLATIONS_STORE } from './db';
import { sanitizeResults } from './results';

/**
 * 번역 기록 저장소 (IndexedDB).
 *
 * 예전에는 localStorage에 두었는데, localStorage는 브라우저당 5MB 남짓이라 몇 권만 번역해도 가득 차고,
 * 앱을 열 때마다 **모든 작품의 기록을 전부** 읽어 들였습니다. 지금은 IndexedDB에 두고 지금 연 페이지 것만 읽습니다.
 *
 * 옮길 때 localStorage의 기록은 지우지 않고 **복사만** 합니다. (저장소 창에서 확인 후 직접 정리)
 * 예전 버전으로 되돌려도 그때까지의 기록은 localStorage에 남아 있게 하기 위함입니다.
 */

/** 번역 기록 키 접두사 (lib/cacheKey.ts) */
const CACHE_PREFIX = 'manga-cache-';
const UNIFIED_PREFIX = 'manga-cache-unified';
/** localStorage → IndexedDB 복사를 마쳤다는 표시 */
const MIGRATED_FLAG = 'manga-translations-idb-migrated';

export interface TranslationRecord {
  key: string;
  results: TranslationResult[];
  /** 어느 작품의 기록인지 (저장소 창에서 작품별로 지우기 위함). 옮겨 온 예전 기록은 처음엔 없음 */
  workKey?: string;
  updatedAt: number;
}

function localCacheKeys(): string[] {
  try {
    return Object.keys(localStorage).filter(key => key.startsWith(CACHE_PREFIX));
  } catch {
    return [];
  }
}

let migration: Promise<number> | null = null;

/**
 * localStorage의 번역 기록을 IndexedDB로 한 번 복사합니다. (여러 번 불러도 한 번만 실행)
 * 이미 IndexedDB에 같은 키가 있으면(그사이 새로 번역됨) 덮어쓰지 않습니다.
 */
export function migrateLocalStorageTranslations(): Promise<number> {
  migration ??= (async () => {
    try {
      if (localStorage.getItem(MIGRATED_FLAG)) return 0;
    } catch {
      return 0;
    }
    const keys = localCacheKeys();
    const db = await getDb();
    const existing = new Set((await requestToPromise(db.transaction(TRANSLATIONS_STORE, 'readonly').objectStore(TRANSLATIONS_STORE).getAllKeys())).map(String));
    const tx = db.transaction(TRANSLATIONS_STORE, 'readwrite');
    const store = tx.objectStore(TRANSLATIONS_STORE);
    let copied = 0;
    for (const key of keys) {
      if (existing.has(key)) continue;
      try {
        const results = sanitizeResults(JSON.parse(localStorage.getItem(key) || 'null'));
        if (!results) continue;
        const record: TranslationRecord = { key, results, updatedAt: Date.now() };
        store.put(record);
        copied++;
      } catch {
        console.warn('손상된 번역 기록을 건너뜁니다:', key);
      }
    }
    await transactionDone(tx);
    localStorage.setItem(MIGRATED_FLAG, new Date().toISOString());
    if (copied > 0) console.info(`[storage] 번역 기록 ${copied}페이지를 localStorage에서 IndexedDB로 복사했습니다. (원본은 그대로 둠)`);
    return copied;
  })().catch(error => {
    migration = null;
    throw error;
  });
  return migration;
}

/**
 * 지정한 페이지들의 번역 기록을 읽습니다. 없는 페이지는 결과에서 빠집니다.
 * 통합 키로 저장되기 전 형식(엔진·모델별로 나뉜 키, 끝이 `-파일이름-크기`로 같음)만 있으면 그중 가장 많은 쪽을 가져와 통합 키로 옮겨 둡니다.
 */
export async function loadTranslations(keys: string[], workKey?: string): Promise<TranslationCache> {
  if (keys.length === 0) return {};
  const db = await getDb();
  const tx = db.transaction(TRANSLATIONS_STORE, 'readonly');
  const store = tx.objectStore(TRANSLATIONS_STORE);
  const records = await Promise.all(keys.map(key => requestToPromise(store.get(key) as IDBRequest<TranslationRecord | undefined>)));

  const cache: TranslationCache = {};
  const missing: string[] = [];
  const untagged: TranslationRecord[] = [];
  records.forEach((record, i) => {
    const results = record && sanitizeResults(record.results);
    if (!results) {
      missing.push(keys[i]);
      return;
    }
    cache[keys[i]] = results;
    if (workKey && !record!.workKey) untagged.push({ ...record!, results, workKey });
  });

  const legacyKeys = missing.length > 0
    ? (await requestToPromise(db.transaction(TRANSLATIONS_STORE, 'readonly').objectStore(TRANSLATIONS_STORE).getAllKeys())).map(String)
      .filter(key => !key.startsWith(UNIFIED_PREFIX))
    : [];
  const promoted: TranslationRecord[] = [];
  if (legacyKeys.length > 0) {
    const legacyStore = db.transaction(TRANSLATIONS_STORE, 'readonly').objectStore(TRANSLATIONS_STORE);
    for (const key of missing) {
      const suffix = key.slice(UNIFIED_PREFIX.length);
      let best: TranslationResult[] | null = null;
      for (const oldKey of legacyKeys.filter(k => k.endsWith(suffix))) {
        const old = await requestToPromise(legacyStore.get(oldKey) as IDBRequest<TranslationRecord | undefined>);
        const results = old && sanitizeResults(old.results);
        if (results && results.length > (best?.length ?? 0)) best = results;
      }
      if (best) {
        cache[key] = best;
        promoted.push({ key, results: best, workKey, updatedAt: Date.now() });
      }
    }
  }

  // 옮겨 온 예전 기록에 작품 표시를 붙이고, 예전 형식 키는 통합 키로 저장 (다음부터는 바로 읽힘)
  const toWrite = [...untagged, ...promoted];
  if (toWrite.length > 0) {
    const writeTx = db.transaction(TRANSLATIONS_STORE, 'readwrite');
    toWrite.forEach(record => writeTx.objectStore(TRANSLATIONS_STORE).put(record));
    await transactionDone(writeTx);
  }
  return cache;
}

export async function saveTranslation(key: string, results: TranslationResult[], workKey?: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(TRANSLATIONS_STORE, 'readwrite');
  const record: TranslationRecord = { key, results, updatedAt: Date.now(), ...(workKey ? { workKey } : {}) };
  tx.objectStore(TRANSLATIONS_STORE).put(record);
  await transactionDone(tx);
}

export async function deleteTranslations(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await getDb();
  const tx = db.transaction(TRANSLATIONS_STORE, 'readwrite');
  keys.forEach(key => tx.objectStore(TRANSLATIONS_STORE).delete(key));
  await transactionDone(tx);
}

export interface WorkStorageSummary {
  /** 작품 키. null = 작품 표시가 없는 예전 기록 */
  workKey: string | null;
  pages: number;
  /** 대략적인 크기(바이트, JSON 기준) */
  bytes: number;
  keys: string[];
}

/** 작품별 번역 기록 수·크기 (저장소 창) */
export async function summarizeTranslationsByWork(): Promise<WorkStorageSummary[]> {
  const db = await getDb();
  const records = await requestToPromise(db.transaction(TRANSLATIONS_STORE, 'readonly').objectStore(TRANSLATIONS_STORE).getAll() as IDBRequest<TranslationRecord[]>);
  const byWork = new Map<string | null, WorkStorageSummary>();
  for (const record of records) {
    const workKey = record.workKey ?? null;
    const summary = byWork.get(workKey) ?? { workKey, pages: 0, bytes: 0, keys: [] };
    summary.pages++;
    summary.bytes += JSON.stringify(record.results).length * 2;
    summary.keys.push(record.key);
    byWork.set(workKey, summary);
  }
  return [...byWork.values()].sort((a, b) => b.bytes - a.bytes);
}

export async function clearAllTranslations(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(TRANSLATIONS_STORE, 'readwrite');
  tx.objectStore(TRANSLATIONS_STORE).clear();
  await transactionDone(tx);
}

/** localStorage에 남아 있는 예전 번역 기록 (IndexedDB로 복사한 뒤의 원본) */
export function legacyLocalStorageStats(): { pages: number; bytes: number; migrated: boolean } {
  const keys = localCacheKeys();
  let bytes = 0;
  keys.forEach(key => { bytes += (localStorage.getItem(key)?.length ?? 0) * 2; });
  let migrated = false;
  try {
    migrated = !!localStorage.getItem(MIGRATED_FLAG);
  } catch {
    // 읽지 못하면 옮기지 않은 것으로 봄
  }
  return { pages: keys.length, bytes, migrated };
}

/** IndexedDB로 복사를 마친 뒤에만 localStorage의 예전 기록을 지웁니다. */
export function clearLegacyLocalStorage(): number {
  if (!legacyLocalStorageStats().migrated) return 0;
  const keys = localCacheKeys();
  keys.forEach(key => localStorage.removeItem(key));
  return keys.length;
}

