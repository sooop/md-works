// 스탠드얼론 HTML 버전: IndexedDB 에 문서 여러 개와 이미지 Blob, docx 템플릿을 보관하는 라이브러리.
// 디스크 파일과는 연동하지 않는다(열기/드롭/붙여넣기는 가져오기, .md/.docx 는 내보내기).
import { doc, defaultEdit, toast, askPrompt, askConfirm, errMsg, withStatus, requestEditorFocus, editorBridge } from './store.svelte';
import { buildArchive, parseArchive } from './archive';
import { downloadBlob, downloadText, writeClipboard, stripEmptyBlocks, fileToDataUrl, replaceImages, sanitizeName, stripExt } from './utils';
import { updatedAfterEdit } from './docUpdated';
import { fullPath, splitPath, withParents, byName } from './docTree';
import { followRename, expandFolder } from './docTree.svelte';
import { searchComments } from './search/commentSearch';
import { exportDocx, isImportable, readImport } from './docx-flow';
import { IMPORT_ACCEPT, IMPORT_LABEL } from './pandoc/importFormats';
import { buildMatcher, searchText } from '../../server/searchCore.js';
import type { SearchResponse } from './search/types';
import { snapshot, removeHistory, allContents } from './history';
import { useBackend, flushComments } from './comments/store.svelte';
import { sanitize, type Comment } from './comments/anchor';
import { useWorksStore, worksStore } from './works/store';
import { markChanged, divertBundleDrop } from './bundle/backupState.svelte';
import { commentToThread, listThreads, threadToComment } from './comments/threads';
import { reattachDoc } from './works/snippets';
import { createIdbStore } from './works/idbStore';
import { useBundleHost } from './bundle/host';
import { recordDocGone, clearDocGone } from './bundle/tombstones';
import { createStandaloneHost } from './bundle/hosts/standalone';
import { design as designState, importDesign } from './design/state.svelte';
import { serializeDesign } from './design';

// ---- IndexedDB ----
// kv: docx 템플릿 / docs: 문서 / images: 문서에서 `idb:<id>` 로 참조하는 이미지 Blob / comments: 문서별 코멘트 목록(키 = 문서 id)
const DB = 'works-standalone';
type Store = 'kv' | 'docs' | 'images' | 'comments';

let dbPromise: Promise<IDBDatabase> | undefined;
function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('comments')) db.createObjectStore('comments', { keyPath: 'id' });
      req.transaction!.objectStore('kv').delete('draft'); // v1 의 임시 보관 문서는 이관하지 않고 버린다
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = undefined; reject(req.error); };
  });
  return dbPromise;
}
async function idb<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface Rec { id: string; name: string; folder?: string; content: string; updated: number }
interface Img { id: string; blob: Blob; created: number }
/** 사이드바 툴팁용 수정 시각(없으면 0) */
export const docUpdatedAt = (id: string): number => all.get(id)?.updated ?? 0;

export interface DocMeta { id: string; name: string; folder: string; updated: number }

const folderOf = (r: Rec) => r.folder ?? '';
const fullOf = (r: Rec) => fullPath(folderOf(r), r.name);
/** 글의 '폴더/이름.md' (사이드바 툴팁용, 없으면 빈 문자열) */
export const docFullPath = (id: string): string => { const r = all.get(id); return r ? fullOf(r) : ''; };

// 빈 폴더도 목록에 남도록 폴더 이름을 따로 보관한다(kv 'folders'). 글이 있는 폴더는 글의 folder 로도 알 수 있다.
const folderSet = new Set<string>();
function allFolders(): string[] {
  const out = new Set<string>();
  for (const f of folderSet) for (const p of withParents(f)) out.add(p);
  for (const r of all.values()) for (const p of withParents(folderOf(r))) out.add(p);
  return [...out];
}
const saveFolders = () => idb('kv', 'readwrite', (s) => s.put([...folderSet], 'folders')).then(() => {}, () => { /* 무시 */ });

const LAST_KEY = 'notes.lastDoc';
const all = new Map<string, Rec>(); // 모든 문서(메모리 사본)
export const lib = $state<{ docs: DocMeta[]; folders: string[]; filter: string; dir: string }>({ docs: [], folders: [], filter: '', dir: '' }); // filter: 사이드바 파일명 검색어, dir: 새 글이 만들어질 폴더

function refreshList() {
  lib.docs = [...all.values()]
    .map((r) => ({ id: r.id, name: r.name, folder: folderOf(r), updated: r.updated }))
    .sort((a, b) => byName(fullPath(a.folder, a.name), fullPath(b.folder, b.name)));
  lib.folders = allFolders().sort(byName);
  if (lib.dir && !lib.folders.includes(lib.dir)) lib.dir = '';
}

let failed = false;
async function putDoc(rec: Rec) {
  try {
    await idb('docs', 'readwrite', (s) => s.put(rec));
    markChanged(); // 문서 생성·가져오기·저장 모두 변경으로 기록
    failed = false;
  } catch (e) {
    if (!failed) toast(`저장하지 못했습니다: ${errMsg(e)}`, 'error');
    failed = true;
    throw e;
  }
}

// 코멘트: 문서 id 별로 한 레코드. 비면 레코드를 지운다.
async function loadComments(id: string): Promise<Comment[]> {
  const r = await idb<{ id: string; comments: unknown } | undefined>('comments', 'readonly', (s) => s.get(id));
  return sanitize(r?.comments);
}
// 코멘트는 이제 worksStore 의 스레드로 저장한다. 'comments' 스토어는 이관(문서를 열 때)과 되돌릴 여지를 위해 남겨 둔다.
const clearComments = (id: string) => idb('comments', 'readwrite', (s) => s.delete(id)).then(() => {});

export async function init() {
  useBackend({ load: loadComments, clear: clearComments });
  useWorksStore(createIdbStore());
  useBundleHost(createStandaloneHost({
    store: worksStore,
    // 번들을 만들거나 가져오기 전에 대기 중인 편집·코멘트를 저장하고, 가져온 뒤에는 메모리 사본을 다시 읽는다
    prepare: async () => { await flush(); await flushComments(); },
    afterApply: reloadAfterBundle,
    setImporting: (on) => { // 가져오는 동안 gc 는 메모리 사본(all)에 없는 새 이미지를 미참조로 보고 지울 수 있다(5분 유예를 넘기는 큰 번들)
      importing = Math.max(0, importing + (on ? 1 : -1));
      if (!importing) scheduleGc();
    },
    design: { current: () => serializeDesign(designState), apply: importDesign },
  }));
  void loadTemplateInfo();
  try {
    await navigator.storage?.persist?.(); // 브라우저가 임의로 비우지 않도록 요청(거절돼도 무시)
    const recs = await idb<Rec[]>('docs', 'readonly', (s) => s.getAll());
    for (const r of recs) all.set(r.id, r);
    const saved = await idb<unknown>('kv', 'readonly', (s) => s.get('folders')).catch(() => []);
    if (Array.isArray(saved)) for (const f of saved) if (typeof f === 'string' && f) folderSet.add(f);
    refreshList();
    const last = localStorage.getItem(LAST_KEY);
    if (last && all.has(last)) await openDoc(last);
  } catch (e) {
    toast(`보관소를 열지 못했습니다: ${errMsg(e)}`, 'error');
  }
}

// 번들을 가져온 뒤: IndexedDB 의 문서를 메모리 사본으로 다시 읽고, 열린 문서가 바뀌었으면 편집기를 갱신한다
async function reloadAfterBundle() {
  const recs = await idb<Rec[]>('docs', 'readonly', (s) => s.getAll());
  all.clear();
  for (const r of recs) all.set(r.id, r);
  refreshList();
  const cur = all.get(doc.path);
  if (cur && cur.content !== doc.content) {
    Object.assign(doc, { name: cur.name, content: cur.content, dirty: false });
    doc.key++;
  }
  if (doc.path && !cur) { // 열려 있던 글이 번들의 삭제 반영으로 사라졌다: 빈 화면으로 되돌려 되살아 저장되지 않게 한다
    clearTimeout(timer);
    Object.assign(doc, { path: '', name: '제목 없음', content: '', dirty: false });
    doc.key++;
    try { localStorage.removeItem(LAST_KEY); } catch { /* 무시 */ }
  }
}

// ---- 현재 문서 저장 (항상 자동 저장) ----
let timer: ReturnType<typeof setTimeout> | undefined;

export function onEditorChange(md: string) {
  doc.content = md;
  markChanged(); // 백업 '마지막 변경' 추적
  const rec = all.get(doc.path);
  if (!rec) return;
  rec.updated = updatedAfterEdit(rec, md, Date.now()); // 실제로 바뀐 경우에만 수정 시각을 갱신(flush 시점엔 이미 같아 보이므로 여기서 판단)
  rec.content = md; // 이미지 정리가 최신 참조를 보도록 즉시 반영
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), 400);
}

// 대기 중인 변경을 즉시 기록한다
export async function flush() {
  clearTimeout(timer);
  const rec = all.get(doc.path);
  if (!rec) return;
  rec.updated = updatedAfterEdit(rec, doc.content, Date.now()); // 내용이 같으면 열기·내보내기 전 저장만으로 시각이 오염되지 않는다
  rec.content = doc.content;
  try {
    await putDoc(rec);
    void snapshot(rec.id, rec.content).catch(() => { /* 이력은 부가 기능이라 실패해도 무시 */ });
    scheduleGc();
  } catch { /* 토스트로 알렸다 */ }
}

export async function save(): Promise<boolean> {
  await flush();
  if (!failed) toast('저장했습니다');
  return !failed;
}

// ---- 문서 목록 ----
export async function openDoc(id: string) {
  await flush();
  const rec = all.get(id);
  if (!rec) return;
  Object.assign(doc, { path: id, name: rec.name, content: rec.content, dirty: false, edit: defaultEdit() }); // 문서는 편집 모드로 연다(모바일은 읽기)
  lib.dir = folderOf(rec); // 새 글은 지금 보는 글의 폴더에 만든다
  doc.key++;
  void snapshot(id, rec.content).catch(() => { /* 무시 */ });
  try { localStorage.setItem(LAST_KEY, id); } catch { /* 무시 */ }
}

/** 그 폴더 바로 아래의 하위 폴더 이름(소문자). 글 전체 이름('x.md')과 같은 폴더 이름이 겹치지 않게 검사할 때 쓴다 */
const subFolderNames = (folder: string) => new Set(allFolders().filter((f) => splitPath(f).folder === folder).map((f) => splitPath(f).name.toLowerCase()));
/** 그 폴더 바로 아래의 글 이름(소문자) */
const docNamesIn = (folder: string, skipId = '') => new Set([...all.values()].filter((r) => r.id !== skipId && folderOf(r) === folder).map((r) => r.name.toLowerCase()));

// 같은 이름이 있으면 '이름 (2).md' 처럼 번호를 붙인다(같은 계층의 폴더 이름과도 겹치지 않게)
function uniqueName(stem: string, folder = ''): string {
  const names = new Set([...docNamesIn(folder), ...subFolderNames(folder)]);
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${stem}.md` : `${stem} (${i}).md`;
    if (!names.has(name.toLowerCase())) return name;
  }
}

// edit: 열었을 때 편집 모드로 시작할지. 이제 모든 문서가 편집 모드로 열려 사실상 의미가 없다(호출부 호환용).
async function createRec(stem: string, content: string, open = true, edit = false, folder = ''): Promise<Rec> {
  const rec: Rec = { id: crypto.randomUUID(), name: uniqueName(stem, folder), ...(folder ? { folder } : {}), content, updated: Date.now() };
  await putDoc(rec);
  await clearDocGone(fullOf(rec)).catch(() => { /* 무시 */ }); // 같은 이름으로 다시 만들면 삭제 묘비는 지운다
  all.set(rec.id, rec);
  refreshList();
  if (open) { if (edit) requestEditorFocus(); await openDoc(rec.id); if (doc.path === rec.id && edit) doc.edit = true; }
  return rec;
}

const toStem = (name: string) => sanitizeName(name.replace(/\.(md|markdown|txt)$/i, '')) || '새 문서';

export async function createDoc(dir = lib.dir) {
  const name = await askPrompt('새 문서 이름', '새 문서');
  if (name === null) return;
  try { await createRec(toStem(name), '', true, true, dir); expandFolder(dir); } catch { /* 토스트로 알렸다 */ }
}

// ---- 폴더 ----
const inFolder = (r: Rec, path: string) => folderOf(r) === path || folderOf(r).startsWith(path + '/');
const remap = (p: string, from: string, to: string) => (p === from || p.startsWith(from + '/') ? to + p.slice(from.length) : p);

export async function createFolder(parent = lib.dir) {
  const input = await askPrompt('새 폴더 이름', '새 폴더');
  const name = input === null ? '' : sanitizeName(input);
  if (!name) return;
  const path = fullPath(parent, name);
  if (allFolders().some((f) => f.toLowerCase() === path.toLowerCase())) { toast('같은 이름의 폴더가 있습니다', 'error'); return; }
  if (docNamesIn(parent).has(name.toLowerCase())) { toast('같은 이름의 문서가 있습니다', 'error'); return; }
  folderSet.add(path);
  await saveFolders();
  refreshList();
  expandFolder(parent);
  lib.dir = path;
}

async function relocateFolder(from: string, to: string) {
  if (allFolders().some((f) => f !== from && !f.startsWith(from + '/') && f.toLowerCase() === to.toLowerCase())) { toast('같은 이름의 폴더가 있습니다', 'error'); return; }
  const dest = splitPath(to);
  if (docNamesIn(dest.folder).has(dest.name.toLowerCase())) { toast('같은 위치에 같은 이름의 문서가 있습니다', 'error'); return; }
  const affected = [...all.values()].filter((r) => inFolder(r, from));
  const clash =affected.find((r) => [...all.values()].some((o) => !inFolder(o, from) && fullOf(o).toLowerCase() === fullPath(remap(folderOf(r), from, to), r.name).toLowerCase()));
  if (clash) { toast('옮길 곳에 같은 이름의 문서가 있습니다', 'error'); return; }
  if (doc.path) await flush();
  try {
    for (const r of affected) {
      const old = fullOf(r);
      r.folder = remap(folderOf(r), from, to) || undefined;
      await putDoc(r);
      await recordDocGone(old).catch(() => { /* 무시 */ }); // 번들은 글 이름이 경로라 옛 경로는 지운 글로 기록한다
      await clearDocGone(fullOf(r)).catch(() => { /* 무시 */ });
    }
  } catch { /* putDoc 이 토스트로 알렸다 */ }
  const next = [...folderSet].map((f) => remap(f, from, to));
  folderSet.clear();
  for (const f of next) folderSet.add(f);
  await saveFolders();
  lib.dir = remap(lib.dir, from, to);
  followRename(from, to);
  refreshList();
}

export async function renameFolder(path: string, input: string) {
  const name = sanitizeName(input);
  if (!name) return;
  const to = fullPath(splitPath(path).folder, name);
  if (to !== path) await relocateFolder(path, to);
}

/** 폴더를 다른 폴더(destParent) 안으로 옮긴다. 자기 자신·자기 하위로는 옮길 수 없다 */
export async function moveFolder(path: string, destParent: string) {
  const to = fullPath(destParent, splitPath(path).name);
  if (to === path || destParent === path || destParent.startsWith(path + '/')) return;
  await relocateFolder(path, to);
  expandFolder(destParent);
}

export async function removeFolder(path: string) {
  const docs = [...all.values()].filter((r) => inFolder(r, path));
  const label = splitPath(path).name;
  const what = docs.length ? `폴더 '${label}' 와 그 안의 문서 ${docs.length}개` : `빈 폴더 '${label}'`;
  if (!(await askConfirm(`${what}를 삭제할까요? 되돌릴 수 없습니다.`, '삭제'))) return;
  for (const r of docs) await removeDocCore(r.id);
  for (const f of [...folderSet]) if (f === path || f.startsWith(path + '/')) folderSet.delete(f);
  await saveFolders();
  if (lib.dir === path || lib.dir.startsWith(path + '/')) lib.dir = splitPath(path).folder;
  refreshList();
}

/** 글을 다른 폴더로 옮긴다('' = 최상위) */
export async function moveDoc(id: string, dest: string) {
  const rec = all.get(id);
  if (!rec || folderOf(rec) === dest) return;
  if ([...all.values()].some((r) => r.id !== id && folderOf(r) === dest && r.name.toLowerCase() === rec.name.toLowerCase())) {
    toast('그 폴더에 같은 이름의 문서가 있습니다', 'error');
    return;
  }
  if (subFolderNames(dest).has(rec.name.toLowerCase())) { toast('그 폴더에 같은 이름의 폴더가 있습니다', 'error'); return; }
  if (rec.id === doc.path) await flush();
  const old = fullOf(rec);
  const prev = rec.folder;
  rec.folder = dest || undefined;
  try {
    await putDoc(rec);
  } catch {
    rec.folder = prev;
    return;
  }
  await recordDocGone(old).catch(() => { /* 무시 */ });
  await clearDocGone(fullOf(rec)).catch(() => { /* 무시 */ });
  followRename(old, fullOf(rec));
  expandFolder(dest);
  refreshList();
}

export async function renameDoc(meta: DocMeta) {
  const rec = all.get(meta.id);
  if (!rec) return;
  const input = await askPrompt('새 이름', stripExt(rec.name));
  if (input === null) return;
  await renameDocTo(rec.id, input);
}

export async function renameCurrent(input: string) {
  if (doc.path) await renameDocTo(doc.path, input);
}

/** 목록에서 그 자리 이름 변경(더블 클릭) */
export const renameDocBy = (id: string, input: string) => renameDocTo(id, input);

async function renameDocTo(id: string, input: string) {
  const rec = all.get(id);
  if (!rec) return;
  const name = `${toStem(input)}.md`;
  if (name === rec.name) return;
  if ([...all.values()].some((r) => r.id !== rec.id && folderOf(r) === folderOf(rec) && r.name.toLowerCase() === name.toLowerCase())) {
    toast('같은 이름의 문서가 있습니다', 'error');
    return;
  }
  if (subFolderNames(folderOf(rec)).has(name.toLowerCase())) { toast('같은 이름의 폴더가 있습니다', 'error'); return; }
  if (rec.id === doc.path) await flush();
  const prev = rec.name;
  const prevFull = fullOf(rec);
  rec.name = name;
  try {
    await putDoc(rec);
  } catch {
    rec.name = prev;
    return;
  }
  await recordDocGone(prevFull).catch(() => { /* 무시 */ }); // 옛 이름은 '지운 글'로 기록한다
  await clearDocGone(fullOf(rec)).catch(() => { /* 무시 */ });
  followRename(prevFull, fullOf(rec));
  if (rec.id === doc.path) { doc.name = name; editorBridge.focus?.(); } // 이름 변경 직후 본문으로 포커스 복귀
  refreshList();
}

export async function removeDoc(meta: DocMeta) {
  if (!(await askConfirm(`'${stripExt(meta.name)}' 문서를 삭제할까요? 되돌릴 수 없습니다.`, '삭제'))) return;
  await removeDocCore(meta.id);
}

async function removeDocCore(id: string) {
  const rec = all.get(id);
  const meta = { id, name: rec ? fullOf(rec) : '' };
  try {
    await flushComments(); // 대기 중인 코멘트 저장이 삭제 뒤에 레코드를 되살리지 않도록
    await idb('docs', 'readwrite', (s) => s.delete(meta.id));
    await recordDocGone(meta.name).catch(() => { /* 무시 */ }); // 다른 기기의 번들에서 되살아나지 않도록 묘비를 남긴다
    await idb('comments', 'readwrite', (s) => s.delete(meta.id)).catch(() => { /* 무시 */ });
    await worksStore().removePart('threads', meta.id).catch(() => { /* 무시 */ });
    await removeHistory(meta.id).catch(() => { /* 무시 */ });
    await reattachDoc(meta.id).catch(() => { /* 무시 */ }); // 글감 연결 끊기 (id 는 이름이 바뀌어도 그대로라 삭제 때만)
  } catch (e) {
    toast(`삭제하지 못했습니다: ${errMsg(e)}`, 'error');
    return;
  }
  if (meta.id === doc.path) {
    clearTimeout(timer);
    Object.assign(doc, { path: '', name: '제목 없음', content: '', dirty: false });
    doc.key++;
    try { localStorage.removeItem(LAST_KEY); } catch { /* 무시 */ }
  }
  all.delete(meta.id);
  refreshList();
  void gcImages();
}

// 이력의 버전으로 되돌린다. 되돌리기 직전의 현재 내용도 이력에 남긴다.
export async function restoreVersion(content: string) {
  if (!doc.path) return;
  await snapshot(doc.path, doc.content, true);
  clearTimeout(timer);
  doc.content = content;
  doc.key++;
  await flush();
  if (failed) throw new Error('저장에 실패했습니다');
}

// ---- 본문 검색 (메모리에 올려 둔 문서 본문을 직접 검색) ----
const SEARCH_PER_FILE = 50;
const SEARCH_TOTAL = 500;

export async function searchLibrary(query: string, opts: { caseSensitive: boolean; regex: boolean }): Promise<SearchResponse> {
  const m = buildMatcher(query, opts);
  if (m.error !== undefined) throw new Error(m.error);
  const results: SearchResponse['results'] = [];
  let count = 0;
  let truncated = false;
  const recs = [...all.values()].sort((a, b) => byName(fullOf(a), fullOf(b)));
  for (const r of recs) {
    if (count >= SEARCH_TOTAL) { truncated = true; break; }
    const hit = searchText(r.content, m.re, { maxMatches: Math.min(SEARCH_PER_FILE, SEARCH_TOTAL - count) });
    if (!hit.matches.length) continue;
    count += hit.matches.length;
    if (hit.truncated) truncated = true;
    results.push({ id: r.id, label: stripExt(fullOf(r)), matches: hit.matches, more: hit.truncated });
  }
  // 코멘트 본문도 같은 검색어로 찾는다(문서 본문 검색이 상한에 걸려도 코멘트는 따로 센다)
  const comments = await searchComments(worksStore(), recs.map((r) => ({ id: r.id, label: stripExt(fullOf(r)) })), query, opts).catch(() => []);
  return { results, count, truncated, comments };
}

// ---- 이미지 ----
// 문서에는 `idb:<id>` 로 적고, 화면에는 Blob 에서 만든 object URL 로 보여 준다.
const IDB_SRC = /^idb:([0-9a-f-]{36})$/;
const IDB_REF = /idb:([0-9a-f-]{36})/g;
const GC_GRACE_MS = 5 * 60 * 1000; // 방금 넣은 이미지나 실행 취소로 되살릴 수 있는 이미지는 지우지 않는다

const urls = new Map<string, Promise<string>>();

async function storeImage(blob: Blob): Promise<string> {
  const id = crypto.randomUUID();
  await idb('images', 'readwrite', (s) => s.put({ id, blob, created: Date.now() } satisfies Img));
  urls.set(id, Promise.resolve(URL.createObjectURL(blob)));
  return `idb:${id}`;
}

async function loadImage(id: string): Promise<Blob | null> {
  const img = await idb<Img | undefined>('images', 'readonly', (s) => s.get(id));
  return img?.blob ?? null;
}

export function upload(file: File): Promise<string> {
  return storeImage(file);
}

export function resolveUrl(src: string): string | Promise<string> {
  const id = IDB_SRC.exec(src)?.[1];
  if (!id) return src;
  let url = urls.get(id);
  if (!url) {
    url = loadImage(id).then((b) => {
      if (!b) throw new Error('이미지를 찾을 수 없습니다');
      return URL.createObjectURL(b);
    });
    urls.set(id, url);
  }
  return url;
}

// 저장마다 전체 이력을 훑지 않도록 정리는 GC_MIN_INTERVAL_MS 에 한 번만 한다 (삭제 때는 바로 실행)
const GC_MIN_INTERVAL_MS = 30_000;
let lastGc = 0;
let importing = 0;
let gcTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleGc() {
  if (gcTimer) return;
  const wait = Math.max(0, lastGc + GC_MIN_INTERVAL_MS - Date.now());
  gcTimer = setTimeout(() => { gcTimer = undefined; void gcImages(); }, wait);
}

// 어떤 문서와 이력도 참조하지 않는 이미지를 지운다
async function gcImages() {
  if (importing) return; // 번들 가져오는 중에는 하지 않는다(끝나면 setImporting 이 다시 예약한다)
  lastGc = Date.now();
  try {
    const used = new Set<string>();
    for (const r of all.values()) for (const m of r.content.matchAll(IDB_REF)) used.add(m[1]);
    for (const c of await allContents()) for (const m of c.matchAll(IDB_REF)) used.add(m[1]);
    const imgs = await idb<Img[]>('images', 'readonly', (s) => s.getAll());
    const now = Date.now();
    for (const img of imgs) {
      if (used.has(img.id) || now - img.created < GC_GRACE_MS) continue;
      await idb('images', 'readwrite', (s) => s.delete(img.id));
      const u = urls.get(img.id);
      urls.delete(img.id);
      void u?.then((url) => URL.revokeObjectURL(url), () => {});
    }
  } catch { /* 정리는 다음 저장 때 다시 시도한다 */ }
}

// 가져온 문서의 Base64 이미지를 Blob 으로 분리한다
async function splitImages(md: string): Promise<string> {
  const r = await replaceImages(md, async (src) =>
    src.startsWith('data:image/') ? storeImage(await (await fetch(src)).blob()) : null,
  );
  return r.text;
}

// 내보내기용: `idb:` 이미지를 data URI 로 되돌린다
async function inlineImages(md: string) {
  return replaceImages(md, async (src) => {
    const id = IDB_SRC.exec(src)?.[1];
    if (!id) return null;
    const blob = await loadImage(id);
    return blob ? fileToDataUrl(blob) : null;
  });
}

// ---- 가져오기: 열기 / 드롭 / 붙여넣기는 항상 새 문서로 추가한다 ----
export async function createFromText(name: string, text: string) {
  try {
    await createRec(toStem(name), await splitImages(text), true, true); // 붙여넣어 만든 문서는 편집 모드로 시작
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

async function importFile(file: File) {
  try {
    const imp = await readImport(file);
    await createRec(toStem(imp.name), await splitImages(imp.content));
  } catch (e) {
    toast(`'${file.name}': ${errMsg(e)}`, 'error');
  }
}

// 전체 백업 zip 가져오기: 문서마다 새 문서로 추가하고(같은 이름은 번호), 상대 경로 이미지는 Blob 으로 분리한다
const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === 'application/zip';

async function importZip(file: File) {
  try {
    await withStatus('압축 파일을 읽는 중…', async (set) => {
      const docs = parseArchive(new Uint8Array(await file.arrayBuffer()));
      if (!docs.length) throw new Error('가져올 문서(.md / .markdown / .txt)가 없습니다');
      const stored = new Map<string, Promise<string>>(); // zip 내부 이미지 경로 → idb: 참조 (같은 이미지는 한 번만 보관)
      let ok = 0;
      let fail = 0;
      for (const d of docs) {
        set(`가져오는 중… ${ok + fail + 1} / ${docs.length}`);
        try {
          const linked = await replaceImages(d.content, async (src) => {
            const img = d.image(src);
            if (!img) return null;
            let ref = stored.get(img.key);
            if (!ref) { ref = storeImage(new Blob([img.data as BlobPart], { type: img.mime })); stored.set(img.key, ref); }
            return ref;
          });
          const rec = await createRec(toStem(d.stem), await splitImages(linked.text), false);
          if (d.comments.length) await worksStore().putMany('threads', d.comments.map((c) => commentToThread(c, rec.id)), rec.id);
          ok++;
        } catch { fail++; }
      }
      if (ok && !doc.path) { const first = lib.docs[0]; if (first) await openDoc(first.id); }
      toast(`'${file.name}' 에서 문서 ${ok}개를 가져왔습니다${fail ? ` (${fail}개 실패)` : ''}`, fail ? 'error' : 'info');
    });
  } catch (e) {
    toast(`'${file.name}': ${errMsg(e)}`, 'error');
  }
}

export async function importFiles(files: File[]) {
  const zips = files.filter(isZip);
  const list = files.filter((f) => !isZip(f) && isImportable(f));
  if (!zips.length && !list.length) {
    toast(`${IMPORT_LABEL} · .zip 파일만 열 수 있습니다`, 'error');
    return;
  }
  for (const f of zips) await importZip(f);
  for (const f of list) await importFile(f);
}

export function openPicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  // 백업 번들(.mwb·조각·폴더 백업 .json)도 고를 수 있어야 한다 — 번들은 백업 대화상자의 가져오기로 보낸다
  input.accept = `${IMPORT_ACCEPT},.zip,.mwb,.json,.001,.002,.003,.004,.005,text/markdown,text/plain,application/zip,application/json,application/octet-stream`;
  input.onchange = () => {
    void (async () => {
      const rest = await divertBundleDrop([...(input.files ?? [])]);
      if (rest.length) await importFiles(rest);
    })();
  };
  input.click();
}

// ---- 내보내기 ----
export async function exportMd() {
  if (!doc.path) return;
  try {
    const { text } = await inlineImages(doc.content);
    downloadText(/\.(md|markdown|txt)$/i.test(doc.name) ? doc.name : `${doc.name}.md`, text);
  } catch (e) {
    toast(`.md 내보내기 실패: ${errMsg(e)}`, 'error');
  }
}

export async function copyMd() {
  if (!doc.path) return;
  try {
    await writeClipboard(stripEmptyBlocks(doc.content));
    toast('마크다운 텍스트를 클립보드에 복사했습니다');
  } catch (e) {
    toast(`복사 실패: ${errMsg(e)}`, 'error');
  }
}

// 모든 문서와 이미지를 zip 하나로 내려받는다 (백업 / 다른 브라우저로 이전 / 서버 모드 폴더로 이전)
export async function exportAll() {
  await flush();
  await flushComments();
  if (!all.size) { toast('내보낼 문서가 없습니다'); return; }
  try {
    await withStatus('백업 파일을 만드는 중…', async () => {
      // 스레드를 레거시 코멘트로 바꿔 담는다(번들 백업은 다음 단계). 아직 이관 전인 문서는 옛 코멘트를 그대로 쓴다.
      const byDoc = new Map((await idb<{ id: string; comments: unknown }[]>('comments', 'readonly', (s) => s.getAll())).map((r) => [r.id, sanitize(r.comments)]));
      for (const id of all.keys()) {
        const ts = await listThreads(id);
        if (ts.length) byDoc.set(id, ts.map(threadToComment));
      }
      const docs = [...all.values()]
        .sort((a, b) => byName(fullOf(a), fullOf(b)))
        .map((r) => ({ name: fullOf(r), content: r.content, comments: byDoc.get(r.id) }));
      const blob = await buildArchive(docs, loadImage);
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      downloadBlob(`works-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`, blob);
      toast(`문서 ${docs.length}개를 zip 으로 내려받았습니다`);
    });
  } catch (e) {
    toast(`백업 내보내기 실패: ${errMsg(e)}`, 'error');
  }
}

// ---- docx 내보내기와 템플릿 ----
// 템플릿 .docx 는 IndexedDB 에 보관한다. 없으면 기본 템플릿(workbench 와 동일)을 쓴다.
export const tpl = $state({ name: '' });

export async function loadTemplateInfo() {
  try {
    const t = await idb<{ name: string; blob: Blob } | undefined>('kv', 'readonly', (s) => s.get('template'));
    tpl.name = t?.name ?? '';
  } catch { /* 기본 템플릿 */ }
}

export function pickTemplate() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      await idb('kv', 'readwrite', (s) => s.put({ name: f.name, blob: f }, 'template'));
      tpl.name = f.name;
      toast(`DOCX 템플릿을 '${f.name}' 으로 지정했습니다`);
    } catch (e) {
      toast(`템플릿을 보관하지 못했습니다: ${errMsg(e)}`, 'error');
    }
  };
  input.click();
}

export async function clearTemplate() {
  try { await idb('kv', 'readwrite', (s) => s.delete('template')); } catch { /* 무시 */ }
  tpl.name = '';
  toast('기본 템플릿을 사용합니다');
}

export async function exportDocxCurrent() {
  if (!doc.path) return;
  try {
    let template: Blob | null = null;
    if (tpl.name) {
      const t = await idb<{ name: string; blob: Blob } | undefined>('kv', 'readonly', (s) => s.get('template'));
      template = t?.blob ?? null;
    }
    const { text } = await inlineImages(doc.content);
    await exportDocx(text, doc.name, template);
  } catch (e) {
    toast(`DOCX 내보내기 실패: ${errMsg(e)}`, 'error');
  }
}
