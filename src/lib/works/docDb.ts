// 스탠드얼론 문서 DB(IndexedDB `works-standalone`)의 저장 계층. 같은 출처의 탭이 여럿 열려 있어도 서로 덮어쓰지 않도록
// "읽고 비교하고 쓰기"를 한 IndexedDB 트랜잭션 안에서 한다(트랜잭션은 탭 사이에서도 직렬화된다).
// 화면·메모리 상태와 무관해서 fake-indexeddb 로 두 탭을 흉내 내 검증한다(tests/works/docDb.test.ts).

import { expiredIds, foldersOf, inFolder, isTrashed, folderOf, liveDocs, remap, restoreFolderPath, restoreName, sanitizeDirs, trashItems, untrashed, type TrashDirs } from './trashLogic';
import type { TrashItem } from '../trash';

/**
 * deletedAt: 휴지통에 있는 글(없으면 보통 글). 휴지통의 글은 목록·검색·저장·이름 변경에서 보이지 않지만 이력·스레드·이미지·글감 핀은 그대로 둔다.
 * trashId: 폴더를 지울 때 안의 글이 함께 갖는 삭제 묶음 id(kv 'trashDirs' 의 키)
 */
export interface DocRec { id: string; name: string; folder?: string; content: string; updated: number; deletedAt?: number; trashId?: string }
export interface ImgRec { id: string; blob: Blob; created: number }
export type Store = 'kv' | 'docs' | 'images' | 'comments';

/** 내용 저장의 결과. conflict = DB 의 내용이 이 탭이 마지막으로 읽거나 쓴 내용(base)과 다르다(다른 탭이 먼저 저장), gone = DB 에 그 글이 없다 */
export type SaveOutcome =
  | { kind: 'ok'; rec: DocRec; wrote: boolean }
  | { kind: 'conflict'; current: DocRec }
  | { kind: 'gone' };

const IMG_REF = /idb:([0-9a-f-]{36})/g;
/** 본문이 참조하는 `idb:<id>` 이미지 id */
export function imageRefs(content: string): string[] {
  return [...content.matchAll(IMG_REF)].map((m) => m[1]);
}

/** 어디에서도 참조하지 않고 유예(grace)가 지난 이미지 id. 순수 함수 */
export function unusedImages(contents: Iterable<string>, imgs: { id: string; created: number }[], now: number, graceMs: number): string[] {
  const used = new Set<string>();
  for (const c of contents) for (const id of imageRefs(c)) used.add(id);
  return imgs.filter((i) => !used.has(i.id) && now - i.created >= graceMs).map((i) => i.id);
}

const cleanFolders = (v: unknown): string[] => (Array.isArray(v) ? v.filter((f): f is string => typeof f === 'string' && !!f) : []);
const fullOfRec = (r: DocRec): string => (folderOf(r) ? `${folderOf(r)}/${r.name}` : r.name);

/** 휴지통 폴더 묶음을 쓴다(비었으면 키를 지운다) */
async function writeDirs(kv: IDBObjectStore, dirs: TrashDirs): Promise<void> {
  if (Object.keys(dirs).length) await ask(kv.put(dirs, 'trashDirs'));
  else await ask(kv.delete('trashDirs'));
}

const ask = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export function createDocDb(dbName = 'works-standalone') {
  // kv: docx 템플릿·폴더 목록 / docs: 문서 / images: 문서에서 `idb:<id>` 로 참조하는 이미지 Blob / comments: 이전 방식 코멘트(키 = 문서 id)
  let dbPromise: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> => (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('comments')) db.createObjectStore('comments', { keyPath: 'id' });
      req.transaction!.objectStore('kv').delete('draft'); // v1 의 임시 보관 문서는 이관하지 않고 버린다
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = undefined; }; // 다른 탭이 스키마를 올리면 연결을 놓아 준다
      resolve(db);
    };
    req.onerror = () => { dbPromise = undefined; reject(req.error); };
  }));

  /** 요청 하나짜리 트랜잭션 */
  async function idb<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return ask(fn(db.transaction(store, mode).objectStore(store)));
  }

  /** 한 트랜잭션 안에서 여러 요청을 이어 한다. fn 은 IndexedDB 요청만 기다려야 한다(그 밖의 비동기를 기다리면 트랜잭션이 끝난다) */
  async function inTx<T>(stores: Store | Store[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await open();
    const tx = db.transaction(stores, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('저장소 작업이 취소되었습니다'));
    });
    done.catch(() => { /* fn 이 던지면 그 오류를 쓴다 */ });
    let out: T;
    try {
      out = await fn(tx);
    } catch (e) {
      try { tx.abort(); } catch { /* 이미 끝남 */ }
      throw e;
    }
    await done;
    return out;
  }

  return {
    idb,
    inTx,
    getAll: () => idb<DocRec[]>('docs', 'readonly', (s) => s.getAll()),
    get: (id: string) => idb<DocRec | undefined>('docs', 'readonly', (s) => s.get(id)),

    /**
     * 글 내용을 저장한다. 한 트랜잭션에서 DB 의 현재 레코드를 읽어 내용이 base(이 탭이 마지막으로 읽거나 쓴 내용)와 같을 때만 쓴다.
     * - 이름·폴더는 DB 의 값을 그대로 둔다(다른 탭에서 바꾼 이름·위치를 낡은 사본으로 되돌리지 않는다)
     * - DB 의 내용이 이미 저장하려는 내용과 같으면 쓰지 않는다(충돌 아님)
     * - recreate: 글이 없으면 rec 를 그대로 새로 만든다(지워진 글 '다시 만들기')
     */
    saveContent(a: { rec: DocRec; base: string | undefined; recreate?: boolean }): Promise<SaveOutcome> {
      return inTx('docs', 'readwrite', async (tx) => {
        const s = tx.objectStore('docs');
        const cur = await ask<DocRec | undefined>(s.get(a.rec.id));
        if (!cur || isTrashed(cur)) { // 휴지통에 간 글도 '지워졌다'로 본다(저장이 되살리지 않는다). 다시 만들기를 고르면 그 자리에 새로 쓴다
          if (!a.recreate) return { kind: 'gone' };
          const fresh = untrashed(a.rec);
          await ask(s.put(fresh));
          return { kind: 'ok', rec: fresh, wrote: true };
        }
        if (cur.content === a.rec.content) return { kind: 'ok', rec: cur, wrote: false };
        if (a.base === undefined || cur.content !== a.base) return { kind: 'conflict', current: cur };
        const next: DocRec = { ...cur, content: a.rec.content, updated: a.rec.updated };
        await ask(s.put(next));
        return { kind: 'ok', rec: next, wrote: true };
      });
    },

    /** 새 글: make 가 DB 의 모든 글을 보고 레코드를 만든다(같은 이름이 다른 탭에서 생겼어도 겹치지 않게) */
    create(make: (existing: DocRec[]) => DocRec): Promise<DocRec> {
      return inTx('docs', 'readwrite', async (tx) => {
        const s = tx.objectStore('docs');
        const rec = make(liveDocs(await ask<DocRec[]>(s.getAll()))); // 휴지통의 글 이름은 비어 있는 것으로 본다
        await ask(s.put(rec));
        return rec;
      });
    },

    /** 이름·폴더 같은 메타 변경: 최신 레코드에 fn 을 적용해 쓴다(내용은 DB 의 것을 그대로 둔다). fn 이 던지면 쓰지 않는다. 글이 없으면 undefined */
    patch(id: string, fn: (cur: DocRec, all: DocRec[]) => DocRec): Promise<DocRec | undefined> {
      return inTx('docs', 'readwrite', async (tx) => {
        const s = tx.objectStore('docs');
        const cur = await ask<DocRec | undefined>(s.get(id));
        if (!cur || isTrashed(cur)) return undefined; // 휴지통의 글은 없는 글과 같다
        const next = fn(cur, liveDocs(await ask<DocRec[]>(s.getAll())));
        await ask(s.put(next));
        return next;
      });
    },

    /** 여러 글의 메타를 한 번에 바꾼다(폴더 이동·이름 변경). 없는 글은 건너뛴다. 바꾼 레코드를 돌려준다 */
    patchMany(ids: string[], fn: (cur: DocRec) => DocRec): Promise<DocRec[]> {
      return inTx('docs', 'readwrite', async (tx) => {
        const s = tx.objectStore('docs');
        const out: DocRec[] = [];
        for (const id of ids) {
          const cur = await ask<DocRec | undefined>(s.get(id));
          if (!cur || isTrashed(cur)) continue;
          const next = fn(cur);
          await ask(s.put(next));
          out.push(next);
        }
        return out;
      });
    },

    remove: (id: string) => idb('docs', 'readwrite', (s) => s.delete(id)).then(() => {}),

    // ---- 휴지통 ----
    /** 휴지통에 든 폴더 묶음(kv 'trashDirs') */
    async readTrashDirs(): Promise<TrashDirs> {
      return sanitizeDirs(await idb<unknown>('kv', 'readonly', (s) => s.get('trashDirs')));
    },

    /** 글을 휴지통으로 보낸다(deletedAt 표시만. 이력·스레드·이미지·핀은 그대로). 휴지통으로 간 글 레코드를 돌려준다 */
    trashDocs(ids: string[], now: number): Promise<DocRec[]> {
      return inTx('docs', 'readwrite', async (tx) => {
        const s = tx.objectStore('docs');
        const out: DocRec[] = [];
        for (const id of ids) {
          const cur = await ask<DocRec | undefined>(s.get(id));
          if (!cur || isTrashed(cur)) continue;
          const next: DocRec = { ...cur, deletedAt: now };
          await ask(s.put(next));
          out.push(next);
        }
        return out;
      });
    },

    /**
     * 폴더를 휴지통으로 보낸다: 안의 모든 글을 같은 묶음 id 로 표시하고, 폴더 목록(빈 폴더 포함)을 묶음에 기억한 채 보이는 폴더 목록에서 뺀다. 한 트랜잭션.
     * 지울 글도 폴더도 없으면 undefined
     */
    trashFolder(path: string, now: number, id: string): Promise<{ id: string; docs: DocRec[]; folders: string[] } | undefined> {
      return inTx(['docs', 'kv'], 'readwrite', async (tx) => {
        const ds = tx.objectStore('docs');
        const kv = tx.objectStore('kv');
        const members = liveDocs(await ask<DocRec[]>(ds.getAll())).filter((r) => inFolder(r, path));
        const folders = cleanFolders(await ask<unknown>(kv.get('folders')));
        const sub = folders.filter((f) => f === path || f.startsWith(`${path}/`));
        if (!members.length && !sub.length) return undefined;
        const docs: DocRec[] = [];
        for (const r of members) {
          const next: DocRec = { ...r, deletedAt: now, trashId: id };
          await ask(ds.put(next));
          docs.push(next);
        }
        await ask(kv.put(folders.filter((f) => !sub.includes(f)), 'folders'));
        const dirs = sanitizeDirs(await ask<unknown>(kv.get('trashDirs')));
        const keep = [...new Set([path, ...sub])];
        dirs[id] = { path, folders: keep, deletedAt: now };
        await ask(kv.put(dirs, 'trashDirs'));
        return { id, docs, folders: keep };
      });
    },

    /** 휴지통 목록(최근 삭제 먼저) */
    listTrash(): Promise<TrashItem[]> {
      return inTx(['docs', 'kv'], 'readonly', async (tx) => {
        const recs = await ask<DocRec[]>(tx.objectStore('docs').getAll());
        return trashItems(recs, sanitizeDirs(await ask<unknown>(tx.objectStore('kv').get('trashDirs'))));
      });
    },

    /** 보관 기간(maxAge)이 지난 항목의 id */
    expiredTrash(now: number, maxAge: number): Promise<string[]> {
      return inTx(['docs', 'kv'], 'readonly', async (tx) => {
        const recs = await ask<DocRec[]>(tx.objectStore('docs').getAll());
        return expiredIds(recs, sanitizeDirs(await ask<unknown>(tx.objectStore('kv').get('trashDirs'))), now, maxAge);
      });
    },

    /**
     * 휴지통에서 복구한다(한 트랜잭션). 글은 원래 폴더·이름으로, 같은 이름이 있으면 '이름 (2).md'. 폴더는 묶음째, 같은 이름이면 '폴더 (2)'.
     * 사라진 폴더는 다시 만든다. docPaths: 복구된 글의 새 경로(삭제 묘비를 걷어 내는 데 쓴다)
     */
    restoreTrash(ids: string[]): Promise<{ ok: number; failed: number; error?: string; paths: string[]; docPaths: string[] }> {
      return inTx(['docs', 'kv'], 'readwrite', async (tx) => {
        const ds = tx.objectStore('docs');
        const kv = tx.objectStore('kv');
        const recs = await ask<DocRec[]>(ds.getAll());
        const live = liveDocs(recs);
        const dirs = sanitizeDirs(await ask<unknown>(kv.get('trashDirs')));
        const folders = new Set(cleanFolders(await ask<unknown>(kv.get('folders'))));
        let ok = 0;
        let failed = 0;
        let error: string | undefined;
        const paths: string[] = [];
        const docPaths: string[] = [];
        let dirsChanged = false;
        let foldersChanged = false;
        const put = async (r: DocRec) => { await ask(ds.put(r)); live.push(r); docPaths.push(fullOfRec(r)); };
        for (const id of ids) {
          const dir = dirs[id];
          if (dir) {
            const to = restoreFolderPath(dir.path, live, foldersOf(folders, live));
            for (const m of recs.filter((r) => r.trashId === id && isTrashed(r))) {
              const { folder: _f, ...rest } = untrashed(m);
              void _f;
              const f = remap(folderOf(m), dir.path, to);
              await put(f ? { ...rest, folder: f } : rest);
            }
            for (const f of [...dir.folders, dir.path]) folders.add(remap(f, dir.path, to));
            foldersChanged = true;
            delete dirs[id];
            dirsChanged = true;
            paths.push(to);
            ok++;
            continue;
          }
          const rec = recs.find((r) => r.id === id);
          if (!rec || !isTrashed(rec)) { failed++; error ||= '휴지통에서 찾을 수 없습니다'; continue; }
          const name = restoreName(rec.name, folderOf(rec), live, foldersOf(folders, live));
          const next: DocRec = { ...untrashed(rec), name };
          await put(next);
          paths.push(fullOfRec(next));
          ok++;
        }
        if (foldersChanged) await ask(kv.put([...folders], 'folders'));
        if (dirsChanged) await writeDirs(kv, dirs);
        return { ok, failed, ...(error ? { error } : {}), paths, docPaths };
      });
    },

    /** 휴지통에서 완전히 지운다(글 레코드만. 이력·스레드·핀·이미지는 부른 쪽이 정리한다). 실제로 지운 글 레코드를 돌려준다 */
    purgeTrash(ids: string[]): Promise<DocRec[]> {
      return inTx(['docs', 'kv'], 'readwrite', async (tx) => {
        const ds = tx.objectStore('docs');
        const kv = tx.objectStore('kv');
        const recs = await ask<DocRec[]>(ds.getAll());
        const dirs = sanitizeDirs(await ask<unknown>(kv.get('trashDirs')));
        const removed: DocRec[] = [];
        let dirsChanged = false;
        for (const id of ids) {
          if (dirs[id]) {
            for (const m of recs.filter((r) => r.trashId === id && isTrashed(r))) { await ask(ds.delete(m.id)); removed.push(m); }
            delete dirs[id];
            dirsChanged = true;
            continue;
          }
          const rec = recs.find((r) => r.id === id);
          if (rec && isTrashed(rec)) { await ask(ds.delete(rec.id)); removed.push(rec); }
        }
        if (dirsChanged) await writeDirs(kv, dirs);
        return removed;
      });
    },

    /** 빈 폴더 목록(kv 'folders') */
    async readFolders(): Promise<string[]> {
      const v = await idb<unknown>('kv', 'readonly', (s) => s.get('folders'));
      return Array.isArray(v) ? v.filter((f): f is string => typeof f === 'string' && !!f) : [];
    },
    /** 폴더 목록을 최신 값에서 읽어 fn 으로 고친 뒤 쓴다(낡은 사본으로 다른 탭의 폴더를 지우지 않는다). 새 목록을 돌려준다 */
    updateFolders(fn: (set: Set<string>) => void): Promise<string[]> {
      return inTx('kv', 'readwrite', async (tx) => {
        const s = tx.objectStore('kv');
        const v = await ask<unknown>(s.get('folders'));
        const set = new Set(Array.isArray(v) ? v.filter((f): f is string => typeof f === 'string' && !!f) : []);
        fn(set);
        const next = [...set];
        await ask(s.put(next, 'folders'));
        return next;
      });
    },

    /**
     * 참조 없는 이미지를 지운다. 문서 목록 읽기와 삭제를 한 트랜잭션에서 해서, 다른 탭이 그 사이 저장한 글의 참조를 놓치지 않는다.
     * extraContents: 이 트랜잭션 밖에서 모은 참조(이력 본문·저장 전 메모리 본문). 지운 id 를 돌려준다.
     * 휴지통의 글도 docs 스토어에 그대로 있으므로 그 본문의 이미지는 참조 중으로 남는다(복구하면 이미지가 살아 있어야 한다).
     */
    gc(a: { extraContents: Iterable<string>; now: number; graceMs: number }): Promise<string[]> {
      return inTx(['docs', 'images'], 'readwrite', async (tx) => {
        const docs = await ask<DocRec[]>(tx.objectStore('docs').getAll());
        const s = tx.objectStore('images');
        const imgs = await ask<ImgRec[]>(s.getAll());
        const dead = unusedImages([...docs.map((d) => d.content), ...a.extraContents], imgs, a.now, a.graceMs);
        for (const id of dead) await ask(s.delete(id));
        return dead;
      });
    },
  };
}

export type DocDb = ReturnType<typeof createDocDb>;
