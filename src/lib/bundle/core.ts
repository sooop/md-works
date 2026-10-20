// 번들 코어: 호스트(BundleHost)를 통해 보관소를 번들로 만들고(build), 번들을 계산만 해 보고(preview), 병합해 쓴다(apply).
// 저장소·zip 세부는 host.ts / parse.ts 에, 병합 규칙은 merge.ts 에 있다. 여기는 그 조립이다.
import { zipSync, type Zippable } from 'fflate';
import type { BundleSummary, DocAction, MergePreview, MergeResult } from './api';
import { BUNDLE_SCHEMA, BUNDLE_VERSION, BundleError, MAX_ENTRIES, isDocName, parseBundle, type ParsedBundle } from './parse';
import type { BundleAsset, BundleHost, HostDocBody, HostDocInfo, ImportSession } from './host';
import { classifyDoc, mergeRecords, mergeTombstones, mergeVersions, preMergeVersion, type RecordMerge, type TombstoneMerge, type VersionMerge } from './merge';
import { listTombstones, nameKey, tombId } from './tombstones';
import { encPart } from './partName';
import { ID_RE } from './records';
import { compress, decompress } from '../history/compress';
import { parseDesign, saveDesign, serializeDesign } from '../design/io';
import type { Design } from '../design/schema';
import type { Snippet, Thread, Tombstone, Version } from '../works/types';
import { createSnippet } from '../works/snippets';
import { mapOrderKeys } from '../works/snippetOrder';
import type { WorksStore } from '../works/store';

const enc = new TextEncoder();
const stemOf = (name: string) => name.replace(/\.md$/i, '');

function designIO(host: BundleHost) {
  return host.design ?? { current: () => serializeDesign(), apply: (d: Design) => saveDesign(d) };
}

// ---- 만들기 ----
export async function buildBundleWith(host: BundleHost, now = Date.now()): Promise<{ bytes: Uint8Array; summary: BundleSummary }> {
  await host.prepare();
  const store = host.store;
  const files: Zippable = {};
  const assets = new Map<string, Uint8Array>();
  const addAssets = (list: BundleAsset[]) => { for (const a of list) assets.set(a.path, a.data); };
  const put = (path: string, text: string) => { files[path] = enc.encode(text); };

  // 가져올 수 없는 이름(255자 초과·제어 문자 등)의 글은 전체를 멈추지 않고 건너뛰어 summary.skipped 로 알린다
  const skipped: string[] = [];
  const infos = (await host.listDocs()).filter((d) => (isDocName(d.name) ? true : (skipped.push(d.name), false)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
  const keyToName = new Map(infos.map((d) => [d.key, d.name]));
  const docMeta: Record<string, { updatedAt: number }> = {};
  let nVersions = 0;
  let nThreads = 0;

  for (const info of infos) {
    const body = await host.readDoc(info);
    put(info.name, body.content);
    addAssets(body.assets);
    docMeta[info.name] = { updatedAt: info.updatedAt };

    for (const v of await store.list<Version>('versions', info.key)) {
      if (!ID_RE.test(v.id)) continue;
      let rec: Version = { ...v, docKey: info.name };
      if (host.convertsImages) {
        try {
          const text = decompress(v.content, v.enc);
          if (text.includes('idb:')) {
            const conv = await host.textToBundle(stemOf(info.name), text);
            addAssets(conv.assets);
            rec = { ...rec, ...compress(conv.text) };
          }
        } catch { continue; /* 깨진 이력은 내보내지 않는다 */ }
      }
      put(`.works/versions/${encPart(info.name)}/${v.id}.json`, JSON.stringify(rec));
      nVersions++;
    }
    for (const t of await store.list<Thread>('threads', info.key)) {
      if (!ID_RE.test(t.id)) continue;
      put(`.works/threads/${encPart(info.name)}/${t.id}.json`, JSON.stringify({ ...t, docKey: info.name }));
      nThreads++;
    }
  }

  const snippets = (await store.list<Snippet>('snippets')).filter((s) => ID_RE.test(s.id));
  const toNames = (keys: string[]) => [...new Set(keys.flatMap((k) => { const n = keyToName.get(k); return n ? [n] : []; }))];
  for (const s of snippets) {
    // 순서 키도 글 이름으로 바꾼다(알 수 없는 글의 키는 버림)
    const { orders: _o, ...base } = s;
    void _o;
    const orders = mapOrderKeys(s.orders, (k) => keyToName.get(k));
    const rec: Snippet = { ...base, attachedDocs: toNames(s.attachedDocs), ...(s.trashedFrom ? { trashedFrom: toNames(s.trashedFrom) } : {}), ...(orders ? { orders } : {}) };
    put(`.works/snippets/_/${s.id}.json`, JSON.stringify(rec));
  }

  put('.works/docs.json', JSON.stringify(docMeta, null, 2));
  put('.works/design.json', designIO(host).current());
  // 묘비: 지운 글의 이름 → deletedAt. 같은 이름의 글이 지금 있으면(다시 만들었다) 묘비는 낡은 것이라 싣지 않는다
  const live = new Set(infos.map((d) => nameKey(d.name)));
  const tombDocs: Record<string, number> = {};
  for (const t of await listTombstones(store)) {
    if (isDocName(t.name) && !live.has(nameKey(t.name))) tombDocs[t.name] = Math.max(tombDocs[t.name] ?? 0, t.deletedAt);
  }
  put('.works/tombstones.json', JSON.stringify({ docs: tombDocs }, null, 2));
  put('manifest.json', JSON.stringify({ schema: BUNDLE_SCHEMA, version: BUNDLE_VERSION, createdAt: now, mode: host.mode, app: 'md-works' }, null, 2));
  for (const [path, data] of assets) files[path] = [data, { level: 0 }]; // 이미지는 이미 압축돼 있다

  if (Object.keys(files).length > MAX_ENTRIES) {
    throw new BundleError(`번들 항목이 ${MAX_ENTRIES}개를 넘어 만들 수 없습니다 (글 ${infos.length}편의 이력·스레드·이미지가 너무 많습니다)`);
  }
  const bytes = zipSync(files, { level: 6 });
  return {
    bytes,
    summary: {
      docs: infos.length, images: assets.size, versions: nVersions, snippets: snippets.filter((s) => !s.purged).length,
      threads: nThreads, bytes: bytes.length, ...(skipped.length ? { skipped } : {}),
    },
  };
}

// ---- 계획(읽기 전용) ----
interface DocPlan {
  /** 번들 안의 원래 경로(이미지 링크의 기준 폴더) */
  src: string;
  /** 이 보관소에서의 이름 */
  name: string;
  action: DocAction;
  winner: 'local' | 'remote' | 'none';
  remote: { content: string; updatedAt?: number };
  local?: { info: HostDocInfo; body: HostDocBody };
}
interface SidecarPlan<M> { src: string; name: string; merge: M }
interface Plan {
  docs: DocPlan[];
  versions: SidecarPlan<VersionMerge>[];
  threads: SidecarPlan<RecordMerge<Thread>>[];
  snippets: RecordMerge<Snippet>;
  /** 글 삭제 묘비 병합 결과 */
  tombs: TombstoneMerge;
  /** 번들 안의 원래 경로 → 이 보관소의 이름 */
  nameOf: Map<string, string>;
  preview: MergePreview;
}

function nameMap(host: BundleHost, parsed: ParsedBundle): { nameOf: Map<string, string>; collisions: string[] } {
  const nameOf = new Map<string, string>();
  const owner = new Map<string, { src: string; name: string }>();
  const collisions: string[] = [];
  for (const src of parsed.docs.keys()) {
    const name = host.normalizeName(src);
    const fold = host.foldsCase ? name.toLowerCase() : name;
    const prev = owner.get(fold);
    if (prev !== undefined && prev.src !== src) {
      if (prev.name === name) throw new BundleError(`번들의 글 '${prev.src}' 와 '${src}' 가 이 보관소에서 같은 이름이 됩니다`);
      collisions.push(`${prev.name} / ${name}`); // 대소문자만 다른 이름: 미리보기가 알리고 적용은 멈춘다
    } else {
      owner.set(fold, { src, name });
    }
    nameOf.set(src, name);
  }
  return { nameOf, collisions };
}

/** 이력·스레드의 id 가 저장소 전체에서 유일한 키일 때, 파티션(key)이 아닌 다른 파티션에 이미 있는 id 를 돌려주는 함수를 만든다 */
async function foreignIds(host: BundleHost, coll: 'versions' | 'threads'): Promise<(key?: string) => ReadonlySet<string> | undefined> {
  if (!host.globalIds) return () => undefined;
  const byPart = new Map<string, string[]>();
  for (const part of await host.store.parts(coll)) {
    try { byPart.set(part, (await host.store.list(coll, part)).map((r) => r.id)); } catch { /* 읽을 수 없는 파티션은 건너뛴다 */ }
  }
  return (key) => new Set([...byPart].flatMap(([part, ids]) => (part === key ? [] : ids)));
}

async function makePlan(host: BundleHost, parsed: ParsedBundle, now: number, currentDesign: string): Promise<Plan> {
  const store = host.store;
  const { nameOf, collisions } = nameMap(host, parsed);
  const foreignV = await foreignIds(host, 'versions');
  const foreignT = await foreignIds(host, 'threads');
  const locals = new Map((await host.listDocs()).map((d) => [d.name, d]));

  // 묘비: 이 기기에서 이미 지운 글은 되살리지 않고, 다른 기기에서 지운 글은 지울 후보로만 올린다
  const tombs = mergeTombstones({
    bundle: Object.entries(parsed.tombstones.docs).map(([n, deletedAt]) => ({ name: host.normalizeName(n), deletedAt })),
    local: (await listTombstones(store)).map((t) => ({ name: t.name, deletedAt: t.deletedAt })),
    localDocs: [...locals.values()].map((d) => ({ name: d.name, updatedAt: d.updatedAt })),
    bundleDocs: [...parsed.docs].map(([src, d]) => ({ name: nameOf.get(src)!, ...(d.updatedAt !== undefined ? { updatedAt: d.updatedAt } : {}) })),
  });
  const skipped = new Set(tombs.skippedDeleted.map(nameKey));

  const docs: DocPlan[] = [];
  for (const [src, remote] of [...parsed.docs].sort(([a], [b]) => a.localeCompare(b, 'ko', { numeric: true }))) {
    const name = nameOf.get(src)!;
    if (skipped.has(nameKey(name))) continue;
    const info = locals.get(name);
    const body = info ? await host.readDoc(info) : undefined;
    const d = classifyDoc(body && info ? { content: body.content, updatedAt: info.updatedAt } : undefined, remote);
    docs.push({ src, name, remote, ...d, ...(info && body ? { local: { info, body } } : {}) });
  }

  // 이력·스레드: 번들에 글이 있거나 이 보관소에 글이 있는 파티션만 다룬다(글 없는 사이드카는 이름 붙일 곳이 없다)
  const known = (name: string) => locals.has(name) || [...parsed.docs.keys()].some((s) => nameOf.get(s) === name && !skipped.has(nameKey(name)));
  const partitions = <T>(m: Map<string, T[]>) => [...m].flatMap(([src, list]) => {
    const name = nameOf.get(src) ?? host.normalizeName(src);
    return known(name) ? [{ src, name, list }] : [];
  });
  const versions: Plan['versions'] = [];
  for (const p of partitions(parsed.versions)) {
    const info = locals.get(p.name);
    versions.push({ src: p.src, name: p.name, merge: mergeVersions(info ? await store.list<Version>('versions', info.key) : [], p.list, now, foreignV(info?.key)) });
  }
  const threads: Plan['threads'] = [];
  for (const p of partitions(parsed.threads)) {
    const info = locals.get(p.name);
    threads.push({ src: p.src, name: p.name, merge: mergeRecords(info ? await store.list<Thread>('threads', info.key) : [], p.list, foreignT(info?.key)) });
  }
  const snippets = mergeRecords(await store.list<Snippet>('snippets'), parsed.snippets);

  let designDiffers = false;
  if (parsed.design) {
    const theirs = parseDesign(parsed.design);
    const mine = parseDesign(currentDesign);
    designDiffers = theirs.ok && (!mine.ok || serializeDesign(theirs.value) !== serializeDesign(mine.value));
  }
  const recSum = (a: SidecarPlan<RecordMerge<Thread>>[], f: (m: RecordMerge<Thread>) => number) => a.reduce((n, x) => n + f(x.merge), 0);
  const preview: MergePreview = {
    createdAt: parsed.manifest.createdAt,
    mode: parsed.manifest.mode,
    docs: docs.map((d) => ({ name: d.name, action: d.action })),
    snippets: { add: snippets.add.length, update: snippets.update.length, same: snippets.same, keepLocal: snippets.keepLocal },
    threads: {
      add: recSum(threads, (m) => m.add.length), update: recSum(threads, (m) => m.update.length),
      same: recSum(threads, (m) => m.same), keepLocal: recSum(threads, (m) => m.keepLocal),
    },
    versions: { add: versions.reduce((n, x) => n + x.merge.add, 0), same: versions.reduce((n, x) => n + x.merge.same, 0) },
    designDiffers,
    ...(collisions.length ? { nameCollisions: collisions } : {}),
    deletions: tombs.deletions.map((d) => ({ name: d.name, action: d.action })),
    skippedDeleted: tombs.skippedDeleted,
  };
  return { docs, versions, threads, snippets, tombs, nameOf, preview };
}

async function loadParsed(host: BundleHost, bytes: Uint8Array, now: number) {
  await host.prepare();
  const parsed = parseBundle(bytes); // 여기서 경로·크기·형식 검증이 모두 끝난다
  const plan = await makePlan(host, parsed, now, designIO(host).current());
  // 보관소(서버)가 받을 수 없는 이름·크기는 쓰기 전에 여기서 막는다
  host.validateImport?.({
    docs: plan.docs.filter((d) => d.action === 'add' || d.action === 'update').map((d) => ({ name: d.name, content: d.remote.content, updatedAt: d.remote.updatedAt })),
    partitions: [...new Set([...plan.versions.filter((v) => v.merge.add || v.merge.put.length).map((v) => v.name), ...plan.threads.filter((t) => t.merge.add.length || t.merge.update.length).map((t) => t.name)])],
    assets: [...parsed.assets.keys()],
  });
  return { parsed, plan };
}

/** 번들을 읽어 병합했을 때 무엇이 바뀌는지 계산만 한다. 아무것도 쓰지 않는다. */
export async function previewBundleWith(host: BundleHost, bytes: Uint8Array, now = Date.now()): Promise<MergePreview> {
  return (await loadParsed(host, bytes, now)).plan.preview;
}

// ---- 병합해 쓰기 ----
/**
 * 병합에서 진 쪽 내용을 '병합 전(<날짜>)' 이름의 영구 버전으로 남긴다. 쓴 것이 있으면 true.
 * 같은 내용의 버전이 이미 이력에 있으면 새로 만들지 않고 그 버전에 이름만 붙인다(이미 이름이 있으면 그대로 둔다).
 * 같은 번들을 되풀이해 가져와도 버전이 늘지 않도록 id 는 내용에서 정한다. 빈 본문은 남길 것이 없다.
 */
async function keepLoser(store: WorksStore, docName: string, key: string, content: string, ts: number | undefined, now: number): Promise<boolean> {
  if (!content.trim()) return false;
  const rec = preMergeVersion(docName, key, content, ts, now);
  for (const v of await store.list<Version>('versions', key)) {
    if (v.deletedAt) continue;
    let text: string;
    try { text = decompress(v.content, v.enc); } catch { continue; }
    if (text !== content) continue;
    if (v.name) return false;
    await store.put('versions', { ...v, name: rec.name, updatedAt: now }, key);
    return true;
  }
  await store.put('versions', rec, key);
  return true;
}

/** 글감으로 보존할 본문 상한(글자 수). 넘으면 앞부분만 남기고 잘렸다고 적는다 */
export const MAX_KEPT_DELETED_CHARS = 200_000;
export const deletedKeepName = (now: number) => {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `삭제 전(${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())})`;
};

/** 지우기 직전의 글 내용을 '삭제 전(<날짜>)' 글감(회색, 붙임 없음)으로 남긴다 */
async function keepDeleted(store: WorksStore, name: string, content: string, now: number): Promise<void> {
  const cut = content.length > MAX_KEPT_DELETED_CHARS;
  const head = `**${deletedKeepName(now)}** · ${name}`;
  const text = cut ? content.slice(0, MAX_KEPT_DELETED_CHARS) : content;
  const note = cut ? `…(글이 너무 길어 앞 ${MAX_KEPT_DELETED_CHARS / 1000}KB 만 보관했습니다)` : '';
  const body = [head, text, note].filter(Boolean).join('\n\n');
  await createSnippet({ body, color: 'gray' }, store);
}

export async function applyBundleWith(
  host: BundleHost, bytes: Uint8Array, options: { applyDesign?: boolean; applyDeletions?: boolean } = {}, now = Date.now(),
): Promise<MergeResult> {
  // 읽기 단계: 파싱·검증·계획을 모두 끝낸 뒤에야 쓰기 시작한다
  const { parsed, plan } = await loadParsed(host, bytes, now);
  if (plan.preview.nameCollisions?.length) {
    throw new BundleError(`번들에 대소문자만 다른 이름의 글이 있어 이 보관소에 가져올 수 없습니다: ${plan.preview.nameCollisions.join(', ')}`);
  }
  let design: Design | undefined;
  if (options.applyDesign && parsed.design) {
    const r = parseDesign(parsed.design);
    if (!r.ok) throw new BundleError(`번들의 디자인 설정을 읽지 못했습니다: ${r.error}`);
    design = r.value;
  }

  const store = host.store;
  const result: MergeResult = { docsAdded: 0, docsUpdated: 0, conflicts: [], snippets: 0, threads: 0, versions: 0, designApplied: false, docsDeleted: 0 };
  host.setImporting?.(true); // 가져오는 동안 이미지 정리(gc)가 방금 저장한 이미지를 지우지 못하게 한다
  const session: ImportSession = host.beginImport(parsed.assets);
  let wrote = false;
  try {
    // 1) 글. 진 쪽 내용은 덮어쓰기 전에 '병합 전' 이력으로 먼저 남긴다
    const keyOf = new Map<string, string>();
    for (const d of plan.docs) {
      if (d.local) keyOf.set(d.name, d.local.info.key);
      if (d.action === 'add' || d.action === 'update') {
        if (d.local) {
          wrote = (await keepLoser(store, d.name, d.local.info.key, d.local.body.raw, d.local.info.updatedAt, now)) || wrote;
        }
        const content = await session.text(d.src, d.remote.content);
        keyOf.set(d.name, await session.putDoc(d.src, d.name, content, d.remote.updatedAt ?? now));
        wrote = true;
        if (d.action === 'add') result.docsAdded++; else result.docsUpdated++;
      } else if ((d.action === 'conflict' || d.action === 'keep-local') && d.local) {
        // 로컬을 지키고, 번들 쪽 내용을 잃지 않게 이력에 남긴다
        const content = await session.text(d.src, d.remote.content);
        wrote = (await keepLoser(store, d.name, d.local.info.key, content, d.remote.updatedAt, now)) || wrote;
        if (d.action === 'conflict') result.conflicts.push(d.name);
      }
    }
    // 글이 새로 생겼을 수 있으니 이름 → docKey 를 다시 읽는다 (스레드·글감 연결에 쓴다)
    for (const info of await host.listDocs()) keyOf.set(info.name, info.key);

    // 2) 이력 버전
    // 글 처리에서 '병합 전' 버전이 새로 생기거나 이름이 붙었을 수 있으니, 솎아내기 계획은 지금 저장소 상태로 다시 세운다
    // (처음 계획을 그대로 쓰면 방금 이름 붙은 버전을 지워 진 쪽 내용이 사라진다)
    const foreignV = await foreignIds(host, 'versions');
    for (const p of plan.versions) {
      const key = keyOf.get(p.name);
      if (!key) continue;
      const remote = parsed.versions.get(p.src) ?? [];
      const merge = mergeVersions(await store.list<Version>('versions', key), remote, now, foreignV(key));
      const puts = new Set(merge.put.map((v) => v.id));
      const out: Version[] = [];
      for (const v of remote) {
        if (!puts.has(v.id)) continue;
        let rec: Version = { ...v, docKey: key };
        if (host.convertsImages) {
          try {
            const text = decompress(v.content, v.enc);
            if (/assets\//.test(text)) rec = { ...rec, ...compress(await session.text(p.src, text)) };
          } catch { continue; }
        }
        out.push(rec);
        puts.delete(v.id); // 번들 안의 중복 id 는 첫 것만
      }
      if (out.length) { await store.putMany('versions', out, key); wrote = true; }
      for (const id of merge.remove) await store.remove('versions', id, key);
      result.versions += out.length;
    }

    // 3) 스레드
    for (const p of plan.threads) {
      const key = keyOf.get(p.name);
      if (!key) continue;
      const recs = [...p.merge.add, ...p.merge.update].map((t) => ({ ...t, docKey: key }));
      if (recs.length) { await store.putMany('threads', recs, key); wrote = true; }
      result.threads += recs.length;
    }

    // 4) 글감: 연결된 글 이름을 이 보관소의 docKey 로 바꾼다 (이 보관소에 없는 글은 연결을 뗀다)
    const toKeys = (names: string[]) => [...new Set(names.flatMap((n) => {
      const k = keyOf.get(plan.nameOf.get(n) ?? host.normalizeName(n));
      return k ? [k] : [];
    }))];
    const keyOfName = (n: string) => keyOf.get(plan.nameOf.get(n) ?? host.normalizeName(n));
    const snips = [...plan.snippets.add, ...plan.snippets.update].map((s): Snippet => {
      const { orders: _o, ...base } = s;
      void _o;
      const orders = mapOrderKeys(s.orders, keyOfName); // 이 보관소에 없는 글의 순서 값은 버린다
      return { ...base, attachedDocs: toKeys(s.attachedDocs), ...(s.trashedFrom ? { trashedFrom: toKeys(s.trashedFrom) } : {}), ...(orders ? { orders } : {}) };
    });
    if (snips.length) { await store.putMany('snippets', snips); wrote = true; }
    result.snippets = snips.length;

    // 5) 글 삭제 묘비: 번들에만 있는 묘비는 합집합으로 저장하고, 번들 글이 더 최신이라 되살린 글의 로컬 묘비는 지운다
    for (const t of plan.tombs.put) {
      await store.put<Tombstone>('tombstones', { id: tombId(t.name), name: t.name, deletedAt: t.deletedAt, updatedAt: t.deletedAt });
      wrote = true;
    }
    for (const name of plan.tombs.clear) { await store.remove('tombstones', tombId(name)); wrote = true; }

    // 6) 다른 기기에서 지운 글: 허락했을 때만 지운다. 지우기 전에 최종 내용을 글감으로 보존한다
    if (options.applyDeletions) {
      const cands = plan.tombs.deletions.filter((d) => d.action === 'delete');
      const byName = cands.length ? new Map((await host.listDocs()).map((d) => [d.name, d])) : new Map<string, HostDocInfo>();
      for (const d of cands) {
        const info = byName.get(d.name);
        if (!info || info.updatedAt > d.deletedAt) continue; // 계획 뒤에 바뀌었으면 지우지 않는다
        const body = await host.readDoc(info);
        await keepDeleted(store, d.name, body.content, now); // 보존에 실패하면 여기서 멈춘다(지우지 않는다)
        await host.deleteDoc(d.name);
        await store.put<Tombstone>('tombstones', { id: tombId(d.name), name: d.name, deletedAt: d.deletedAt, updatedAt: d.deletedAt });
        result.docsDeleted++;
        wrote = true;
      }
    }

    // 7) 디자인
    if (design) { designIO(host).apply(design); result.designApplied = true; }
    await session.close();
  } finally {
    try { if (wrote) await host.afterApply?.(); } finally { host.setImporting?.(false); }
  }
  return result;
}
