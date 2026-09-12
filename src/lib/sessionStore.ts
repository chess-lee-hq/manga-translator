/**
 * 새로고침해도 작업을 이어갈 수 있도록 이미지와 읽던 위치를 IndexedDB에 저장합니다.
 * (번역 결과와 단어장은 기존대로 localStorage에 저장)
 */
const DB_NAME = 'manga-translator';
const DB_VERSION = 1;
const PAGES_STORE = 'pages';
const META_STORE = 'meta';
const META_KEY = 'current';

export interface StoredPage {
  /** 번역 캐시 키 (파일 이름+크기) */
  key: string;
  blob: Blob;
  name: string;
  lastModified: number;
  mimeType: string;
  sortKey: string;
}

export interface SessionMeta {
  /** 페이지 순서 (StoredPage.key) */
  order: string[];
  loadedFilename: string | null;
  /** 구글 드라이브에 저장(덮어쓰기)할 파일 이름 */
  driveFileName?: string | null;
  currentPageIndex: number;
  savedAt: number;
}

export interface PageToStore {
  key: string;
  file: File;
  mimeType: string;
  sortKey: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
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
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB를 열지 못했습니다.'));
    }).catch(error => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션이 취소되었습니다.'));
  });
}

/** 페이지 목록과 순서를 저장합니다. 이미 저장된 이미지는 다시 쓰지 않고, 추가·삭제된 페이지만 반영합니다. */
export async function saveSession(pages: PageToStore[], meta: Omit<SessionMeta, 'order' | 'savedAt'>): Promise<void> {
  const db = await getDb();
  const existingKeys = new Set(
    (await requestToPromise(db.transaction(PAGES_STORE, 'readonly').objectStore(PAGES_STORE).getAllKeys())).map(String),
  );
  const wantedKeys = new Set(pages.map(p => p.key));

  const tx = db.transaction([PAGES_STORE, META_STORE], 'readwrite');
  const pagesStore = tx.objectStore(PAGES_STORE);
  for (const page of pages) {
    if (existingKeys.has(page.key)) continue;
    const record: StoredPage = {
      key: page.key,
      blob: page.file,
      name: page.file.name,
      lastModified: page.file.lastModified,
      mimeType: page.mimeType,
      sortKey: page.sortKey,
    };
    pagesStore.put(record);
  }
  existingKeys.forEach(key => {
    if (!wantedKeys.has(key)) pagesStore.delete(key);
  });
  const fullMeta: SessionMeta = { ...meta, order: pages.map(p => p.key), savedAt: Date.now() };
  tx.objectStore(META_STORE).put(fullMeta, META_KEY);
  await transactionDone(tx);
}

/** 읽던 위치 등 메타 정보만 갱신합니다. (페이지를 넘길 때마다 이미지를 다시 쓰지 않도록 분리) */
export async function updateSessionMeta(patch: Partial<Omit<SessionMeta, 'order'>>): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(META_STORE, 'readwrite');
  const store = tx.objectStore(META_STORE);
  const current = await requestToPromise(store.get(META_KEY) as IDBRequest<SessionMeta | undefined>);
  if (current) store.put({ ...current, ...patch, savedAt: Date.now() }, META_KEY);
  await transactionDone(tx);
}

export async function loadSession(): Promise<{ pages: StoredPage[]; meta: SessionMeta } | null> {
  const db = await getDb();
  const tx = db.transaction([PAGES_STORE, META_STORE], 'readonly');
  const [records, meta] = await Promise.all([
    requestToPromise(tx.objectStore(PAGES_STORE).getAll() as IDBRequest<StoredPage[]>),
    requestToPromise(tx.objectStore(META_STORE).get(META_KEY) as IDBRequest<SessionMeta | undefined>),
  ]);
  if (!meta || records.length === 0) return null;
  const byKey = new Map(records.map(record => [record.key, record]));
  const pages = meta.order.map(key => byKey.get(key)).filter((p): p is StoredPage => !!p);
  return pages.length > 0 ? { pages, meta } : null;
}

export async function clearSession(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([PAGES_STORE, META_STORE], 'readwrite');
  tx.objectStore(PAGES_STORE).clear();
  tx.objectStore(META_STORE).clear();
  await transactionDone(tx);
}
