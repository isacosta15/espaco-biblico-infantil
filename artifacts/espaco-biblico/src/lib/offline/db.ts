// Wrapper fino sobre IndexedDB. Não usa nenhuma dependência externa —
// só a API nativa do navegador, disponível offline em qualquer navegador
// moderno (inclusive no modo standalone do PWA).

const DB_NAME = "ebi-offline";
const DB_VERSION = 1;

export const STORES = {
  CHILDREN: "children",
  CONGREGATIONS: "congregations",
  ATTENDANCE_BY_DATE: "attendanceByDate",
  DAILY_REPORTS: "dailyReports",
  MISC: "misc",
  OUTBOX: "outbox",
  ID_MAP: "idMap",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.CHILDREN)) {
        db.createObjectStore(STORES.CHILDREN, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.CONGREGATIONS)) {
        db.createObjectStore(STORES.CONGREGATIONS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.ATTENDANCE_BY_DATE)) {
        db.createObjectStore(STORES.ATTENDANCE_BY_DATE, { keyPath: "date" });
      }
      if (!db.objectStoreNames.contains(STORES.DAILY_REPORTS)) {
        db.createObjectStore(STORES.DAILY_REPORTS, { keyPath: "reportDate" });
      }
      if (!db.objectStoreNames.contains(STORES.MISC)) {
        db.createObjectStore(STORES.MISC, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORES.OUTBOX)) {
        db.createObjectStore(STORES.OUTBOX, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORES.ID_MAP)) {
        db.createObjectStore(STORES.ID_MAP, { keyPath: "tempId" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

async function runTx<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = fn(store);

    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    transaction.oncomplete = () => resolve(request.result as T);
  });
}

export async function idbGet<T = unknown>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return runTx<T | undefined>(store, "readonly", (s) => s.get(key));
}

export async function idbGetAll<T = unknown>(store: StoreName): Promise<T[]> {
  return runTx<T[]>(store, "readonly", (s) => s.getAll());
}

export async function idbPut<T = unknown>(store: StoreName, value: T): Promise<IDBValidKey> {
  return runTx<IDBValidKey>(store, "readwrite", (s) => s.put(value));
}

export async function idbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  await runTx<void>(store, "readwrite", (s) => s.delete(key));
}

export async function idbClear(store: StoreName): Promise<void> {
  await runTx<void>(store, "readwrite", (s) => s.clear());
}

export async function idbPutAll<T = unknown>(store: StoreName, values: T[]): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    for (const value of values) {
      objectStore.put(value);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
