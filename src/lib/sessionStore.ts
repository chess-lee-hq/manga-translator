import { getDb, META_STORE, PAGES_STORE, requestToPromise, transactionDone } from './db';

/**
 * 새로고침해도 작업을 이어갈 수 있도록 이미지와 읽던 위치를 IndexedDB에 저장합니다.
 * (번역 기록은 translationStore, 단어장·노트는 localStorage)
 */
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
