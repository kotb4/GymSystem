/**
 * One-time reader for the OLD architecture's IndexedDB database snapshot.
 * Used exclusively by the first-run migration screen to hand the previous
 * browser-stored SQLite file to the local backend (spec sections 2/18/20).
 * Nothing else in the app touches IndexedDB anymore.
 */

const IDB_NAME = "gympro";
const IDB_STORE = "kv";
const DB_RECORD_KEY = "app-database";

export function loadLegacyBrowserDbBytes(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(IDB_NAME, 1);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => {
      const idb = request.result;
      try {
        const tx = idb.transaction(IDB_STORE, "readonly");
        const get = tx.objectStore(IDB_STORE).get(DB_RECORD_KEY);
        get.onsuccess = () => resolve((get.result as Uint8Array | undefined) ?? null);
        get.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    };
    request.onerror = () => resolve(null);
  });
}

export function describeBytes(bytes: Uint8Array): string {
  const kb = Math.round(bytes.length / 1024);
  return `${kb} KB`;
}
