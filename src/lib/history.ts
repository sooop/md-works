// 문서별 버전 이력: 브라우저 IndexedDB(`works-history`)에 문서당 최근 MAX_VERSIONS 개를 보관한다.
// 스탠드얼론은 문서 id, 서버 모드는 루트 기준 파일 경로를 docKey 로 쓴다. 이력은 이 브라우저에만 있다.
export const MAX_VERSIONS = 20;
export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

export interface Version {
  id: string;
  docKey: string;
  ts: number;
  content: string;
}

const DB = 'works-history';
let dbPromise: Promise<IDBDatabase> | undefined;
function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('versions', { keyPath: 'id' }).createIndex('docKey', 'docKey');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = undefined; reject(req.error); };
  });
  return dbPromise;
}

// 한 트랜잭션 안에서 실행하고 완료를 기다린다
async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => T): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('versions', mode);
    let out!: T;
    try { out = fn(tx.objectStore('versions')); } catch (e) { tx.abort(); reject(e); return; }
    tx.oncomplete = () => resolve(out);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// 최신순 목록
export async function listVersions(docKey: string): Promise<Version[]> {
  const db = await openDb();
  const list = await new Promise<Version[]>((resolve, reject) => {
    const req = db.transaction('versions').objectStore('versions').index('docKey').getAll(docKey);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return list.sort((a, b) => b.ts - a.ts);
}

// 현재 내용을 버전으로 남긴다. 내용이 직전 버전과 같으면 건너뛰고,
// force 가 아니면 직전 버전 이후 SNAPSHOT_INTERVAL_MS 가 지나야 남긴다. 20개를 넘으면 오래된 것부터 지운다.
export async function snapshot(docKey: string, content: string, force = false): Promise<void> {
  if (!docKey || !content.trim()) return;
  await run('readwrite', (s) => {
    s.index('docKey').getAll(docKey).onsuccess = (e) => {
      const list = (e.target as IDBRequest<Version[]>).result.sort((a, b) => a.ts - b.ts);
      const latest = list[list.length - 1];
      if (latest && (latest.content === content || (!force && Date.now() - latest.ts < SNAPSHOT_INTERVAL_MS))) return;
      s.add({ id: crypto.randomUUID(), docKey, ts: Date.now(), content } satisfies Version);
      for (const old of list.slice(0, Math.max(0, list.length + 1 - MAX_VERSIONS))) s.delete(old.id);
    };
  });
}

// key 자신과 그 아래 경로(`key/…`)의 이력을 대상으로 한다 (서버 모드의 폴더 이동/삭제)
const under = (docKey: string, key: string) => docKey === key || docKey.startsWith(key + '/');

function eachCursor(s: IDBObjectStore, fn: (c: IDBCursorWithValue) => void) {
  s.openCursor().onsuccess = (e) => {
    const c = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
    if (!c) return;
    fn(c);
    c.continue();
  };
}

export function removeHistory(key: string): Promise<void> {
  return run('readwrite', (s) => eachCursor(s, (c) => { if (under((c.value as Version).docKey, key)) c.delete(); }));
}

// 이름·경로가 바뀌면 이력의 키도 따라 옮긴다
export function moveHistory(from: string, to: string): Promise<void> {
  return run('readwrite', (s) => eachCursor(s, (c) => {
    const v = c.value as Version;
    if (under(v.docKey, from)) c.update({ ...v, docKey: to + v.docKey.slice(from.length) });
  }));
}

// 이미지 정리가 이력이 참조하는 이미지를 남기도록 모든 버전의 본문을 돌려준다
export async function allContents(): Promise<string[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('versions').objectStore('versions').getAll();
    req.onsuccess = () => resolve((req.result as Version[]).map((v) => v.content));
    req.onerror = () => reject(req.error);
  });
}
