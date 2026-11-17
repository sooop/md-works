// 로컬 저장소(스탠드얼론 IndexedDB 글 + WorksStore 의 글감·스레드·이력) ↔ 동기화 항목 어댑터.
//
// 설계 결정
// - 읽기(listLocal): 글 본문은 docDb 로 보관소 원문(raw, `idb:` 참조 그대로)을 직접 읽는다. BundleHost.readDoc 은 `idb:` 이미지를
//   모두 읽어 번들 형식(assets/…)으로 바꾸므로(이미지 Blob 로딩 비용 + 형식이 달라진다) 동기화 범위(이미지는 보내지 않음)에 맞지 않는다.
// - 쓰기·삭제(apply/removeLocal): BundleHost 를 재사용한다 — beginImport().putDoc(폴더 경로 분해, 휴지통의 같은 이름 글 되살리기, id 유지),
//   normalizeName(이름 정규화·대소문자 맞춤), deleteDoc(이력·스레드·글감 연결 정리), afterApply(메모리 사본·화면 갱신), setImporting(gc 정지).
//   putDoc 에 넘기는 본문은 session.text() 를 거치지 않는다(`idb:` 참조를 그대로 둔다).
// - 글을 지울 때 묘비(tombstones)는 기록하지 않는다(서버의 삭제 표시가 그 역할).
import { fullPath } from '../docTree';
import { contentHash } from '../bundle/merge';
import type { BundleHost } from '../bundle/host';
import { createDocDb, type DocDb, type DocRec } from '../works/docDb';
import type { WorksStore } from '../works/store';
import { compress } from '../history/compress';
import type { Snippet, SnippetColor, Thread, Version } from '../works/types';
import type { DocData, ItemKind, LocalItem, SnippetData, SyncAdapter, ThreadData } from './protocol';

// ───────── 항목 id ─────────
const MAX_ID = 62;
function prefixed(prefix: string, id: string): string {
  const s = prefix + id;
  return s.length <= MAX_ID ? s : prefix + contentHash(id);
}
/** 글: 'd' + contentHash(이름 소문자). 이름은 폴더 포함 전체 경로 */
export const docItemId = (name: string): string => `d${contentHash(name.toLowerCase())}`;
/** 글감: 's-' + id (총 길이 62 초과 시 접두 + contentHash(id)) */
export const snippetItemId = (id: string): string => prefixed('s-', id);
/** 스레드: 't-' + id (총 길이 62 초과 시 접두 + contentHash(id)) */
export const threadItemId = (id: string): string => prefixed('t-', id);

export interface SyncAdapterDeps {
  /** bundleHost() 와 같은 모양(스탠드얼론 호스트) */
  host: BundleHost;
  /** 기본: host.store */
  store?: WorksStore;
  /** 글 원문을 읽는 문서 DB. 없으면 createDocDb(dbName) */
  docDb?: Pick<DocDb, 'getAll'>;
  /** docDb 를 만들 때 쓰는 DB 이름(기본 'works-standalone') */
  dbName?: string;
  now?: () => number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isTrashed = (r: DocRec) => typeof r.deletedAt === 'number';
const fullOf = (r: DocRec) => fullPath(r.folder ?? '', r.name);

export function createSyncAdapter(deps: SyncAdapterDeps): SyncAdapter {
  const { host } = deps;
  const store = () => deps.store ?? host.store;
  const docDb = deps.docDb ?? createDocDb(deps.dbName);
  const now = () => (deps.now ?? Date.now)();

  const liveDocs = async () => (await docDb.getAll()).filter((r) => !isTrashed(r));
  /** 살아 있는 글의 docKey ↔ 이름 */
  async function nameMaps() {
    const recs = await liveDocs();
    const keyToName = new Map<string, string>();
    const lowerToKey = new Map<string, string>();
    for (const r of recs) {
      const n = fullOf(r);
      keyToName.set(r.id, n);
      lowerToKey.set(n.toLowerCase(), r.id);
    }
    return { recs, keyToName, lowerToKey };
  }

  // ───────── 적용 알림 ─────────
  let depth = 0;
  let touched = false;
  function setApplying(on: boolean): void {
    if (on) { depth++; host.setImporting?.(true); return; }
    depth = Math.max(0, depth - 1);
    host.setImporting?.(false);
    if (depth === 0 && touched) {
      touched = false;
      void host.afterApply?.().catch((e) => console.warn('동기화 적용 뒤 화면 갱신 실패', e));
    }
  }
  async function applying<T>(fn: () => Promise<T>): Promise<T> {
    if (depth > 0) { touched = true; return fn(); } // 엔진이 setApplying 으로 묶은 안: 끝에 한 번만 갱신
    host.setImporting?.(true);
    try { return await fn(); } finally {
      host.setImporting?.(false);
      await host.afterApply?.().catch((e) => console.warn('동기화 적용 뒤 화면 갱신 실패', e));
    }
  }

  // ───────── 읽기 ─────────
  async function listLocal(): Promise<LocalItem[]> {
    await host.prepare(); // 대기 중인 편집을 저장한 뒤 읽는다
    const { recs, keyToName } = await nameMaps();
    const items: LocalItem[] = [];

    for (const r of recs) {
      const name = fullOf(r);
      const data: DocData = { name, content: r.content };
      items.push({ id: docItemId(name), kind: 'doc', updatedAt: r.updated, deleted: false, data });
    }

    const names = (keys: string[] | undefined): string[] => (keys ?? []).flatMap((k) => { const n = keyToName.get(k); return n ? [n] : []; });
    for (const s of await store().list<Snippet>('snippets')) {
      const data: SnippetData = {
        body: s.body, color: s.color, createdAt: s.createdAt,
        ...(s.source ? { source: s.source } : {}),
        attachedDocNames: names(s.attachedDocs),
      };
      if (s.trashedFrom) data.trashedFromNames = names(s.trashedFrom);
      const orders = Object.entries(s.orders ?? {}).flatMap(([k, v]) => { const n = keyToName.get(k); return n ? [[n, v] as const] : []; });
      if (orders.length) data.ordersByName = Object.fromEntries(orders);
      if (typeof s.deletedAt === 'number') data.deletedAt = s.deletedAt;
      if (s.purged) data.purged = true;
      items.push({ id: snippetItemId(s.id), kind: 'snippet', updatedAt: s.updatedAt, deleted: false, data });
    }

    for (const part of await store().parts('threads')) {
      const docName = keyToName.get(part);
      if (!docName) continue; // 휴지통에 있거나 없는 글의 스레드는 이름이 없어 동기화하지 않는다
      for (const t of await store().list<Thread>('threads', part)) {
        const data: ThreadData = {
          docName, anchor: t.anchor, messages: t.messages, resolved: t.resolved, createdAt: t.createdAt,
          ...(typeof t.deletedAt === 'number' ? { deletedAt: t.deletedAt } : {}),
        };
        items.push({ id: threadItemId(t.id), kind: 'thread', updatedAt: t.updatedAt, deleted: false, data });
      }
    }
    return items;
  }

  // ───────── 쓰기 ─────────
  async function applyDoc(item: LocalItem): Promise<'applied' | 'deferred'> {
    if (item.deleted || !item.data) { await removeDocById(item.id); return 'applied'; }
    const d = item.data as DocData;
    await host.prepare(); // 이름 대소문자 맞춤 표(lower)를 최신으로
    const name = host.normalizeName(d.name);
    const session = host.beginImport(new Map());
    await session.putDoc(name, name, d.content, item.updatedAt); // 본문은 text() 를 거치지 않는다(`idb:` 참조 유지)
    await session.close();
    return 'applied';
  }

  async function removeDocById(id: string): Promise<void> {
    const rec = (await liveDocs()).find((r) => docItemId(fullOf(r)) === id);
    if (rec) await host.deleteDoc(fullOf(rec));
  }

  async function applySnippet(item: LocalItem): Promise<'applied' | 'deferred'> {
    if (item.deleted || !item.data) { await removeById('snippets', item.id); return 'applied'; }
    const d = item.data as SnippetData;
    const local = (await store().list<Snippet>('snippets')).find((s) => snippetItemId(s.id) === item.id);
    const id = local?.id ?? item.id.slice(2);
    if (d.purged) {
      await store().put<Snippet>('snippets', {
        id, body: '', color: d.color as SnippetColor, createdAt: d.createdAt, attachedDocs: [],
        updatedAt: item.updatedAt, deletedAt: d.deletedAt ?? item.updatedAt, purged: true,
      });
      return 'applied';
    }
    const { lowerToKey } = await nameMaps();
    const keyOf = (n: string) => lowerToKey.get(n.toLowerCase());
    const attached = d.attachedDocNames.map((n) => [n, keyOf(n)] as const);
    if (attached.some(([, k]) => !k)) return 'deferred'; // 글이 아직 안 왔을 수 있다
    const keys = (ns: string[] | undefined) => (ns ?? []).flatMap((n) => { const k = keyOf(n); return k ? [k] : []; });
    const orders = Object.entries(d.ordersByName ?? {}).flatMap(([n, v]) => { const k = keyOf(n); return k ? [[k, v] as const] : []; });
    const rec: Snippet = {
      id, body: d.body, color: d.color as SnippetColor, createdAt: d.createdAt, updatedAt: item.updatedAt,
      attachedDocs: [...new Set(attached.map(([, k]) => k!))],
      ...(d.source ? { source: d.source } : {}),
      ...(d.trashedFromNames ? { trashedFrom: keys(d.trashedFromNames) } : {}),
      ...(orders.length ? { orders: Object.fromEntries(orders) } : {}),
      ...(typeof d.deletedAt === 'number' ? { deletedAt: d.deletedAt } : {}),
    };
    await store().put('snippets', rec);
    return 'applied';
  }

  async function applyThread(item: LocalItem): Promise<'applied' | 'deferred'> {
    if (item.deleted || !item.data) { await removeById('threads', item.id); return 'applied'; }
    const d = item.data as ThreadData;
    const { lowerToKey } = await nameMaps();
    const docKey = lowerToKey.get(d.docName.toLowerCase());
    if (!docKey) return 'deferred';
    const local = await findThread(item.id);
    const rec: Thread = {
      id: local?.t.id ?? item.id.slice(2), docKey, anchor: d.anchor, messages: d.messages, resolved: d.resolved,
      createdAt: d.createdAt, updatedAt: item.updatedAt, ...(typeof d.deletedAt === 'number' ? { deletedAt: d.deletedAt } : {}),
    };
    // 글 이름이 바뀌어 파티션이 달라졌으면 옛 파티션에서 지운다(IndexedDB 는 id 가 전역 키라 덮어써지지만 다른 저장소를 위해)
    if (local && local.part !== docKey) await store().remove('threads', local.t.id, local.part).catch(() => { /* 무시 */ });
    await store().put('threads', rec, docKey);
    return 'applied';
  }

  async function findThread(itemId: string): Promise<{ t: Thread; part: string } | undefined> {
    for (const part of await store().parts('threads')) {
      const t = (await store().list<Thread>('threads', part)).find((x) => threadItemId(x.id) === itemId);
      if (t) return { t, part };
    }
    return undefined;
  }

  async function removeById(coll: 'snippets' | 'threads', itemId: string): Promise<void> {
    if (coll === 'snippets') {
      const s = (await store().list<Snippet>('snippets')).find((x) => snippetItemId(x.id) === itemId);
      if (s) await store().remove('snippets', s.id);
    } else {
      const f = await findThread(itemId);
      if (f) await store().remove('threads', f.t.id, f.part);
    }
  }

  const KIND_APPLY: Record<ItemKind, (item: LocalItem) => Promise<'applied' | 'deferred'>> = {
    doc: applyDoc, snippet: applySnippet, thread: applyThread,
  };

  return {
    listLocal,
    apply: (item) => applying(() => KIND_APPLY[item.kind](item)),
    async preserveLoser(item) {
      if (item.kind !== 'doc' || !item.data) return;
      const d = item.data as DocData;
      const rec = (await liveDocs()).find((r) => docItemId(fullOf(r)) === item.id);
      if (!rec) return;
      const t = now();
      const dt = new Date(t);
      const v: Version = {
        id: `y${contentHash(`${d.name}\0${d.content}`)}`, docKey: rec.id, ts: item.updatedAt || t, updatedAt: t,
        name: `동기화 전(${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())})`, ...compress(d.content),
      };
      await store().put('versions', v, rec.id);
    },
    async removeLocal(item) {
      await applying(async () => {
        if (item.kind === 'doc') await removeDocById(item.id);
        else await removeById(item.kind === 'snippet' ? 'snippets' : 'threads', item.id);
      });
    },
    setApplying,
  };
}
