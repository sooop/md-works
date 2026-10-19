// 스탠드얼론용 WorksStore: IndexedDB `works-data`. 레코드마다 `_part` 필드를 붙여 저장하고 읽을 때 뗀다.
import { PARTITIONED, GLOBAL_PART, type Coll, type WorksRecord } from './types';
import type { WorksStore } from './store';

const COLLS = Object.keys(PARTITIONED) as Coll[];
type Row = WorksRecord & { _part: string };

export function createIdbStore(dbName = 'works-data'): WorksStore {
  let dbPromise: Promise<IDBDatabase> | undefined;
  const open = () => (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, 2); // v2: tombstones 스토어 추가(없는 스토어만 만든다)
    req.onupgradeneeded = () => {
      for (const c of COLLS) {
        if (!req.result.objectStoreNames.contains(c)) req.result.createObjectStore(c, { keyPath: 'id' }).createIndex('part', '_part');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = undefined; reject(req.error); };
  }));

  const partOf = (coll: Coll, part?: string): string => {
    if (!PARTITIONED[coll]) return GLOBAL_PART;
    if (!part || part === GLOBAL_PART) throw new Error('잘못된 파티션');
    return part;
  };
  const wait = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  const ask = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const strip = <T extends WorksRecord>(row: Row): T => {
    const { _part, ...rest } = row;
    void _part;
    return rest as unknown as T;
  };

  return {
    async list<T extends WorksRecord>(coll: Coll, part?: string) {
      const p = partOf(coll, part);
      const rows = await ask<Row[]>((await open()).transaction(coll).objectStore(coll).index('part').getAll(p));
      return rows.map((r) => strip<T>(r));
    },
    async get<T extends WorksRecord>(coll: Coll, id: string, part?: string) {
      const p = partOf(coll, part);
      const row = await ask<Row | undefined>((await open()).transaction(coll).objectStore(coll).get(id));
      return row && row._part === p ? strip<T>(row) : undefined;
    },
    async put(coll, rec, part) {
      await this.putMany(coll, [rec], part);
    },
    async putMany(coll, recs, part) {
      const p = partOf(coll, part);
      const tx = (await open()).transaction(coll, 'readwrite');
      for (const r of recs) tx.objectStore(coll).put({ ...r, _part: p });
      await wait(tx);
    },
    async remove(coll, id, part) {
      const p = partOf(coll, part);
      const tx = (await open()).transaction(coll, 'readwrite');
      const s = tx.objectStore(coll);
      s.get(id).onsuccess = (e) => {
        const row = (e.target as IDBRequest<Row | undefined>).result;
        if (row && row._part === p) s.delete(id);
      };
      await wait(tx);
    },
    async parts(coll) {
      const rows = await ask<Row[]>((await open()).transaction(coll).objectStore(coll).getAll());
      return [...new Set(rows.map((r) => r._part))];
    },
    async removePart(coll, part) {
      const p = partOf(coll, part);
      const tx = (await open()).transaction(coll, 'readwrite');
      const s = tx.objectStore(coll);
      s.index('part').openKeyCursor(IDBKeyRange.only(p)).onsuccess = (e) => {
        const cur = (e.target as IDBRequest<IDBCursor | null>).result;
        if (!cur) return;
        s.delete(cur.primaryKey);
        cur.continue();
      };
      await wait(tx);
    },
    async movePart(coll, from, to) {
      const f = partOf(coll, from);
      const t = partOf(coll, to);
      if (f === t) return;
      const tx = (await open()).transaction(coll, 'readwrite');
      const s = tx.objectStore(coll);
      s.index('part').getAll(f).onsuccess = (e) => {
        for (const r of (e.target as IDBRequest<Row[]>).result) s.put({ ...r, _part: t });
      };
      await wait(tx);
    },
  };
}
