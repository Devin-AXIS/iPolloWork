import { type EditHistoryState } from "./editHistory";

export interface EditHistoryStorageAdapter {
  get(projectId: string): Promise<EditHistoryState | null>;
  delete(projectId: string): Promise<void>;
}

const DB_NAME = "hyperframes-studio-edit-history";
const DB_VERSION = 1;
const STORE_NAME = "project-history";

function openEditHistoryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to open edit history db"));
    request.onsuccess = () => resolve(request.result);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openEditHistoryDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = callback(tx.objectStore(STORE_NAME));
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Legacy history transaction aborted")); };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB transaction failed"));
        };
      }),
  );
}

export function createIndexedDbEditHistoryStorage(): EditHistoryStorageAdapter {
  return {
    async get(projectId) {
      return (
        (await withStore<EditHistoryState | undefined>("readonly", (store) =>
          store.get(projectId),
        )) ?? null
      );
    },
    async delete(projectId) {
      await withStore<undefined>("readwrite", (store) => store.delete(projectId));
    },
  };
}
