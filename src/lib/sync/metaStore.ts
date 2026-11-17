// 동기화 메타 저장소: IndexedDB 'works-sync' (meta: id → SyncMeta / state: 단일 키)
import type { SyncMeta, SyncMetaStore, SyncState } from './protocol';

const DEFAULT_STATE: SyncState = { cursor: 0, lastSyncAt: 0 };

export function createMemoryMetaStore(): SyncMetaStore {
  const metas = new Map<string, SyncMeta>();
  let state: SyncState = { ...DEFAULT_STATE };
  return {
    async getAll() { return [...metas.values()].map((m) => ({ ...m })); },
    async put(m) { metas.set(m.id, { ...m }); },
    async putMany(ms) { for (const m of ms) metas.set(m.id, { ...m }); },
    async remove(id) { metas.delete(id); },
    async getState() { return { ...state }; },
    async setState(s) { state = { ...state, ...s }; },
    async clear() { metas.clear(); state = { ...DEFAULT_STATE }; },
  };
}

export function createIdbMetaStore(dbName = 'works-sync'): SyncMetaStore {
  let dbp: Promise<IDBDatabase> | null = null;
  const open = () => (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
  }));
  const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  const result = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  async function readState(): Promise<SyncState> {
    const db = await open();
    const rec = await result(db.transaction('state').objectStore('state').get('state')) as ({ id: string } & Partial<SyncState>) | undefined;
    return { cursor: rec?.cursor ?? 0, lastSyncAt: rec?.lastSyncAt ?? 0 };
  }
  return {
    async getAll() {
      const db = await open();
      return (await result(db.transaction('meta').objectStore('meta').getAll())) as SyncMeta[];
    },
    async put(m) {
      const db = await open();
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(m);
      await done(tx);
    },
    async putMany(ms) {
      const db = await open();
      const tx = db.transaction('meta', 'readwrite');
      for (const m of ms) tx.objectStore('meta').put(m);
      await done(tx);
    },
    async remove(id) {
      const db = await open();
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').delete(id);
      await done(tx);
    },
    getState: readState,
    async setState(s) {
      const next = { ...(await readState()), ...s };
      const db = await open();
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put({ id: 'state', ...next });
      await done(tx);
    },
    async clear() {
      const db = await open();
      const tx = db.transaction(['meta', 'state'], 'readwrite');
      tx.objectStore('meta').clear();
      tx.objectStore('state').clear();
      await done(tx);
    },
  };
}
