// 스탠드얼론 호스트: IndexedDB 의 문서·이미지를 번들 코어에 연결한다.
// - 글 이름 = 문서 이름(.md 포함), docKey = 문서 id. 이력·스레드 파티션은 코어가 이름 ↔ id 로 바꿔 준다.
// - 이미지는 archive.ts 방식: 내보낼 때 `idb:` → assets/<문서명>/<n>.<ext>, 가져올 때 상대 경로 → `idb:` (Blob 으로 저장).
// 문서 DB(works-standalone)는 standalone-mode.svelte.ts 가 만든다. 여기서는 같은 DB 를 따로 열어 docs/images 스토어만 쓴다.
import type { WorksStore } from '../../works/store';
import type { Design } from '../../design';
import { relinkImages } from '../../archive';
import { basename, dirname, isExternalSrc, joinPath, replaceImages, safeDecode, sanitizeName } from '../../utils';
import type { BundleAsset, BundleHost, HostDocBody, HostDocInfo, ImportSession } from '../host';

export interface StandaloneHostOptions {
  store: () => WorksStore;
  /** 기본 'works-standalone' */
  dbName?: string;
  /** 대기 중인 편집을 저장한다(앱이 넘긴다) */
  prepare?: () => Promise<void>;
  /** 가져오기 뒤 메모리 사본과 화면을 다시 읽는다(앱이 넘긴다) */
  afterApply?: () => Promise<void>;
  design?: { current(): string; apply(d: Design): void };
  /** 가져오기 시작(true)·끝(false) 알림. 앱은 그동안 이미지 정리(gc)를 멈춘다 */
  setImporting?: (on: boolean) => void;
}

interface Rec { id: string; name: string; content: string; updated: number }
interface Img { id: string; blob: Blob; created: number }

const IMG_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
};
const imgMime = (path: string) => IMG_MIME[/\.([a-z0-9]+)$/i.exec(path)?.[1].toLowerCase() ?? ''];
const IDB_SRC = /^idb:([0-9a-f-]{36})$/;

/** standalone-mode 와 같은 스키마(docs·images 스토어)를 보장해서 연다. DB 가 더 새 버전이어도 버전을 지정하지 않으므로 그대로 쓴다 */
function openDb(name: string): Promise<IDBDatabase> {
  const need = ['kv', 'docs', 'images', 'comments'];
  const open = (version?: number) => new Promise<IDBDatabase>((resolve, reject) => {
    const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
    req.onupgradeneeded = () => {
      for (const s of need) {
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, s === 'kv' ? undefined : { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return open().then((db) => {
    if (need.every((s) => db.objectStoreNames.contains(s))) return db;
    const v = db.version + 1;
    db.close();
    return open(v);
  });
}

/** 번들의 글 경로를 스탠드얼론의 평평한 이름으로: 'dir/글.md' → 'dir - 글.md' (archive.ts 의 parseArchive 와 같은 규칙) */
export function flattenName(path: string): string {
  const segs = path.split('/').filter(Boolean);
  const stem = (segs.pop() ?? '').replace(/\.(md|markdown|txt)$/i, '');
  return `${sanitizeName([...segs, stem].join(' - ')) || '새 문서'}.md`;
}

export function createStandaloneHost(opts: StandaloneHostOptions): BundleHost {
  const dbName = opts.dbName ?? 'works-standalone';
  let dbp: Promise<IDBDatabase> | undefined;
  const db = () => (dbp ??= openDb(dbName));
  async function req<T>(store: 'docs' | 'images', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const d = await db();
    return new Promise((resolve, reject) => {
      const r = fn(d.transaction(store, mode).objectStore(store));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  const allDocs = () => req<Rec[]>('docs', 'readonly', (s) => s.getAll());
  const loadImage = async (id: string) => (await req<Img | undefined>('images', 'readonly', (s) => s.get(id)))?.blob ?? null;

  let lower = new Map<string, string>(); // 소문자 이름 → 실제 이름 (대소문자만 다른 이름이 두 글이 되지 않도록)

  return {
    mode: 'html',
    get store() { return opts.store(); },
    convertsImages: true,
    globalIds: true, // idbStore 는 id 가 전역 키다
    ...(opts.setImporting ? { setImporting: opts.setImporting } : {}),
    ...(opts.design ? { design: opts.design } : {}),

    async prepare() {
      await opts.prepare?.();
      lower = new Map((await allDocs()).map((r) => [r.name.toLowerCase(), r.name]));
    },
    normalizeName(name) {
      const flat = flattenName(name);
      return lower.get(flat.toLowerCase()) ?? flat;
    },
    async listDocs(): Promise<HostDocInfo[]> {
      return (await allDocs()).map((r) => ({ name: r.name, key: r.id, updatedAt: r.updated }));
    },
    async readDoc(info): Promise<HostDocBody> {
      const rec = await req<Rec | undefined>('docs', 'readonly', (s) => s.get(info.key));
      const raw = rec?.content ?? '';
      if (!raw.includes('idb:')) return { content: raw, assets: [], raw };
      const { text, assets } = await relinkImages(info.name.replace(/\.md$/i, ''), raw, loadImage);
      return { content: text, assets, raw };
    },
    async textToBundle(stem, text) {
      const { text: out, assets } = await relinkImages(stem, text, loadImage, true);
      return { text: out, assets: assets as BundleAsset[] };
    },
    beginImport(assets): ImportSession {
      const stored = new Map<string, Promise<string | null>>(); // 번들 이미지 경로 → idb: 참조 (같은 이미지는 한 번만 저장)
      const storeImage = async (data: Uint8Array, mime: string): Promise<string> => {
        const id = crypto.randomUUID();
        // created = 지금: 이미지 정리(gc)의 5분 유예 안에 들어, 글이 저장되기 전에 지워지지 않는다
        await req('images', 'readwrite', (s) => s.put({ id, blob: new Blob([data as BlobPart], { type: mime }), created: Date.now() } satisfies Img));
        return `idb:${id}`;
      };
      let byName: Map<string, Rec> | undefined;
      return {
        async text(srcPath, text) {
          if (!text.includes('![')) return text;
          const dir = dirname(srcPath);
          const r = await replaceImages(text, (src) => {
            if (isExternalSrc(src) || IDB_SRC.test(src)) return Promise.resolve(null);
            const key = joinPath(dir, safeDecode(src.replace(/[?#].*$/, '')));
            const data = assets.get(key);
            const mime = imgMime(key);
            if (!data || !mime) return Promise.resolve(null);
            let ref = stored.get(key);
            if (!ref) { ref = storeImage(data, mime); stored.set(key, ref); }
            return ref;
          });
          return r.text;
        },
        async putDoc(_src, name, content, updatedAt) {
          byName ??= new Map((await allDocs()).map((r) => [r.name, r]));
          const cur = byName.get(name);
          const rec: Rec = cur ? { ...cur, content, updated: updatedAt } : { id: crypto.randomUUID(), name: basename(name), content, updated: updatedAt };
          await req('docs', 'readwrite', (s) => s.put(rec));
          byName.set(name, rec);
          return rec.id;
        },
        async close() { /* 이미지는 쓰는 즉시 저장했다 */ },
      };
    },
    afterApply: opts.afterApply,
  };
}
