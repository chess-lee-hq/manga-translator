/**
 * 앱이 쓰는 IndexedDB 하나 (이미지·세션, 번역 기록).
 * 버전을 올릴 때는 onupgradeneeded에서 없는 저장소만 만들므로 기존 데이터는 그대로 남습니다.
 * - v1: pages(세션 이미지), meta(읽던 위치)
 * - v2: translations(번역 기록 — 예전에는 localStorage)
 */
const DB_NAME = 'manga-translator';
const DB_VERSION = 2;
export const PAGES_STORE = 'pages';
export const META_STORE = 'meta';
export const TRANSLATIONS_STORE = 'translations';
export const TRANSLATIONS_WORK_INDEX = 'workKey';

let dbPromise: Promise<IDBDatabase> | null = null;

export function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('이 브라우저에서는 IndexedDB를 사용할 수 없습니다.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PAGES_STORE)) db.createObjectStore(PAGES_STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
        if (!db.objectStoreNames.contains(TRANSLATIONS_STORE)) {
          const store = db.createObjectStore(TRANSLATIONS_STORE, { keyPath: 'key' });
          store.createIndex(TRANSLATIONS_WORK_INDEX, 'workKey', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // 다른 탭에서 새 버전으로 열면 이 연결을 닫아 업그레이드를 막지 않음 (다음 요청 때 다시 열림)
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB를 열지 못했습니다.'));
      request.onblocked = () => console.warn('다른 탭이 예전 버전의 저장소를 쓰고 있습니다. 그 탭을 닫거나 새로고침해 주세요.');
    }).catch(error => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션이 취소되었습니다.'));
  });
}
