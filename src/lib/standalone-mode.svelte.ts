// 스탠드얼론 HTML 버전: IndexedDB 에 문서 여러 개와 이미지 Blob, docx 템플릿을 보관하는 라이브러리.
// 디스크 파일과는 연동하지 않는다(열기/드롭/붙여넣기는 가져오기, .md/.docx 는 내보내기).
import { doc, settings, applyTheme, defaultEdit, toast, askPrompt, askChoose, errMsg, withStatus, requestEditorFocus, editorBridge } from './store.svelte';
import { buildArchive, parseArchive } from './archive';
import { downloadBlob, downloadText, writeClipboard, stripEmptyBlocks, fileToDataUrl, replaceImages, sanitizeName, stripExt, uuid } from './utils';
import { updatedAfterEdit } from './docUpdated';
import { fullPath, splitPath, withParents, byName, type DocNode } from './docTree';
import { followRename, expandFolder } from './docTree.svelte';
import { searchComments } from './search/commentSearch';
import { exportDocx, isImportable, readImport } from './docx-flow';
import { IMPORT_ACCEPT, IMPORT_LABEL } from './pandoc/importFormats';
import { buildMatcher, searchText } from '../../server/searchCore.js';
import type { SearchResponse } from './search/types';
import { snapshot, allContents } from './history';
import { backoffMs, conflictAction, goneAction, versionLabel, TAB_CONFLICT_BUTTONS, GONE_BUTTONS } from './saveSafety';
import { saveNamedVersion } from './namedVersion';
import { createDocDb, type DocRec, type ImgRec, type SaveOutcome } from './works/docDb';
import { isTrashed, liveDocs, trashItems } from './works/trashLogic';
import { cleanupPurged } from './works/trashOps';
import { TRASH_MS, type TrashCtl, type TrashItem } from './trash';
import type { BulkResult } from './components/treeCtl';
import { exportSelection, type FolderExportKind } from './folderExportUi';
import { mergeRecs, planRemoteDoc } from './works/remoteDoc';
import { startTabSync, notifyTabs, onTabMessage, runExclusive } from './works/tabSync';
import { useBackend, flushComments } from './comments/store.svelte';
import { sanitize, type Comment } from './comments/anchor';
import { useWorksStore, worksStore } from './works/store';
import { markChanged, divertBundleDrop } from './bundle/backupState.svelte';
import { commentToThread, listThreads, threadToComment } from './comments/threads';
import { createIdbStore } from './works/idbStore';import { useBundleHost } from './bundle/host';
import { recordDocGone, clearDocGone } from './bundle/tombstones';
import { createStandaloneHost } from './bundle/hosts/standalone';
import { design as designState, importDesign } from './design/state.svelte';
import { serializeDesign } from './design';

// ---- IndexedDB ----
// kv: docx 템플릿·폴더 목록 / docs: 문서 / images: 문서에서 `idb:<id>` 로 참조하는 이미지 Blob / comments: 문서별 코멘트 목록(키 = 문서 id)
// 저장소 접근은 works/docDb.ts 가 맡는다. 같은 출처의 탭이 여럿이어도 덮어쓰지 않도록 글 저장은 DB 의 현재 내용과 비교하며 쓴다.
const db = createDocDb();
const idb = db.idb;

type Rec = DocRec;
type Img = ImgRec;
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
// 폴더 목록은 DB 의 최신 값에서 고쳐 쓴다(낡은 사본으로 다른 탭이 만든 폴더를 지우지 않는다). 저장에 실패해도 이 탭에서는 바뀐 대로 보인다
async function editFolders(fn: (s: Set<string>) => void) {
  try {
    const next = await db.updateFolders(fn);
    folderSet.clear();
    for (const f of next) folderSet.add(f);
    notifyTabs({ t: 'docs' });
  } catch {
    fn(folderSet);
  }
}

const LAST_KEY = 'notes.lastDoc';
const all = new Map<string, Rec>(); // 모든 문서(메모리 사본)
// 이 탭이 마지막으로 DB 에서 읽거나 DB 에 쓴 글 내용. 저장 때 DB 의 현재 내용이 이것과 다르면 다른 탭이 먼저 저장한 것(충돌)이다.
const base = new Map<string, string>();
export const lib = $state<{ docs: DocMeta[]; folders: string[]; filter: string; dir: string }>({ docs: [], folders: [], filter: '', dir: '' }); // filter: 사이드바 파일명 검색어, dir: 새 글이 만들어질 폴더

/** 휴지통에 든 항목 수(사이드바의 '휴지통 (N)' 단추) */
export const trash = $state({ count: 0 });
const trashListeners = new Set<() => void>();
const fireTrashChange = () => { for (const fn of [...trashListeners]) { try { fn(); } catch { /* 한 수신자의 오류가 다른 수신자를 막지 않게 */ } } };

/** 휴지통 항목 수를 DB 에서 다시 읽는다(휴지통을 연 화면도 목록을 다시 읽게 알린다) */
async function refreshTrash() {
  try { trash.count = (await db.listTrash()).length; } catch { /* 다음에 다시 읽는다 */ }
  fireTrashChange();
}

function refreshList() {
  lib.docs = [...all.values()]
    .map((r) => ({ id: r.id, name: r.name, folder: folderOf(r), updated: r.updated }))
    .sort((a, b) => byName(fullPath(a.folder, a.name), fullPath(b.folder, b.name)));
  lib.folders = allFolders().sort(byName);
  if (lib.dir && !lib.folders.includes(lib.dir)) lib.dir = '';
}

// 저장하지 못한 글: 상단바에 '저장하지 못함'을 계속 보이고(doc.saveFailed), 지수 백오프로 다시 시도하며, 닫기 전에 경고한다.
// 다른 글로 옮겨 가도 메모리 사본(all)에는 남아 있으므로 글 id 로 모아 두고 모두 다시 기록한다.
const unsaved = new Set<string>();
// 충돌·삭제 선택에서 '취소'한 글: 직접 저장(Ctrl+S·다시 시도)할 때까지 자동 저장·재시도를 멈춘다(저장하지 못한 글이기도 하다)
const held = new Set<string>();
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let failCount = 0;
// 지금 열린 글에 아직 DB 에 기록하지 못한 입력이 있나(입력~저장 완료 사이). 스탠드얼론은 doc.dirty 를 쓰지 않는다.
let pendingEdit = false;
let inflight = 0; // 줄 선 저장 작업 수(충돌 선택창이 떠 있는 동안도 포함)

function markSaveFailed(id: string, e: unknown, fromRetry = false) {
  unsaved.add(id);
  Object.assign(doc, { saveFailed: true, saveError: errMsg(e) });
  if (fromRetry || !failCount) failCount++; // 입력마다 실패해도 백오프가 순식간에 상한으로 치솟지 않게 한다
  retryTimer ??= setTimeout(() => { retryTimer = undefined; void retryUnsaved(); }, backoffMs(failCount));
}
function markSaved(id: string) {
  unsaved.delete(id);
  held.delete(id);
  if (unsaved.size) return;
  clearTimeout(retryTimer);
  retryTimer = undefined;
  failCount = 0;
  if (doc.saveFailed) Object.assign(doc, { saveFailed: false, saveError: '' });
}
/** 충돌·삭제 선택을 취소한 뒤: 변경은 그대로 두고 표시만 남긴다. 직접 저장할 때까지 자동 저장은 멈춘다 */
function holdFailure(id: string, msg: string) {
  unsaved.add(id);
  held.add(id);
  clearTimeout(timer);
  clearTimeout(retryTimer);
  retryTimer = undefined;
  Object.assign(doc, { saveFailed: true, saveError: msg });
}
// 저장하지 못한 글을 모두 다시 기록한다. 성공하면 표시가 사라진다
async function retryUnsaved() {
  for (const id of [...unsaved]) {
    if (held.has(id)) continue; // 사용자가 보류한 글은 직접 저장할 때까지 건드리지 않는다
    if (!all.has(id)) { markSaved(id); continue; } // 그 사이 지워진 글
    try {
      await enqueue(() => persist(id, true));
    } catch (e) {
      markSaveFailed(id, e, true);
      return;
    }
  }
}
/** 상단바 '다시 시도': 대기 중인 입력을 기록하고 저장하지 못한 글을 모두 다시 시도한다 */
export async function retrySave() {
  clearTimeout(retryTimer);
  retryTimer = undefined;
  held.clear(); // 직접 누른 시도는 보류를 풀고 다시 확인한다
  await flush();
  await retryUnsaved();
  if (!unsaved.size) toast('저장했습니다');
  else toast(`저장하지 못했습니다: ${doc.saveError}`, 'error'); // 직접 누른 시도의 결과는 알린다
}

// ---- 저장 (글 하나의 내용: DB 의 현재 내용과 비교하며 한 트랜잭션에서 쓴다) ----
// 저장은 한 번에 하나씩 줄 세운다: 앞의 저장이 끝나 base 를 갱신한 뒤에 다음 저장이 비교해야 스스로 충돌하지 않는다.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  inflight++;
  const run = async () => { try { return await fn(); } finally { inflight--; } };
  const p = queue.then(run);
  queue = p.catch(() => { /* 호출자가 오류를 받는다 */ });
  return p;
}

type PersistResult = 'ok' | 'held' | 'dropped';

// quiet: 이미 저장 실패 상태라 토스트를 반복하지 않는다(상단바 표시가 계속 알린다). 입출력 오류는 던진다.
async function persist(id: string, quiet: boolean): Promise<PersistResult> {
  let recreate = false;
  for (;;) {
    const rec = all.get(id);
    if (!rec) return 'dropped';
    if (id === doc.path) { // 편집기에 있는 내용을 사본에 반영(복원 등 doc.content 를 직접 바꾼 경우도 포함)
      if (rec.content !== doc.content) pendingEdit = true;
      rec.updated = updatedAfterEdit(rec, doc.content, Date.now()); // 내용이 같으면 열기·내보내기 전 저장만으로 시각이 오염되지 않는다
      rec.content = doc.content;
    }
    if (held.has(id)) return 'held';
    if (!recreate && !unsaved.has(id) && !(id === doc.path && pendingEdit)) return 'ok'; // 저장할 변경이 없으면 DB 를 건드리지 않는다(낡은 사본으로 충돌을 만들지 않게)
    const content = rec.content;
    let out: SaveOutcome;
    try {
      out = await db.saveContent({ rec: { ...rec }, base: base.get(id), recreate });
    } catch (e) {
      if (!quiet) toast(`저장하지 못했습니다: ${errMsg(e)}`, 'error');
      throw e;
    }
    if (out.kind === 'ok') {
      base.set(id, content);
      const live = all.get(id);
      if (live && (live.name !== out.rec.name || (live.folder ?? '') !== (out.rec.folder ?? ''))) { // 다른 탭에서 이름·위치를 바꿨다
        live.name = out.rec.name;
        if (out.rec.folder) live.folder = out.rec.folder; else delete live.folder;
        if (id === doc.path) doc.name = live.name;
        refreshList();
      }
      if (id === doc.path && doc.content === content) pendingEdit = false;
      if (out.wrote) { markChanged(); notifyTabs({ t: 'docs' }); } // 문서 생성·가져오기·저장 모두 변경으로 기록
      if (recreate) { await clearDocGone(fullOf(out.rec)).catch(() => { /* 무시 */ }); refreshList(); }
      markSaved(id);
      void snapshot(id, content).catch(() => { /* 이력은 부가 기능이라 실패해도 무시 */ });
      scheduleGc();
      return 'ok';
    }
    const next = out.kind === 'conflict' ? await resolveConflict(id, out.current) : await resolveGone(id);
    if (next === 'recreate') { recreate = true; continue; }
    if (next === 'retry') continue;
    return next === 'done' ? 'ok' : next === 'dropped' ? 'dropped' : 'held';
  }
}

type Resolution = 'retry' | 'recreate' | 'done' | 'held' | 'dropped';

// 다른 탭이 먼저 저장했다. 지금 열린 글이면 서버 모드와 같은 선택창을 띄우고, 그 밖의 글은 내 내용을 이력에 남기고 다른 탭의 내용을 따른다.
async function resolveConflict(id: string, current: Rec): Promise<Resolution> {
  const rec = all.get(id);
  if (!rec) return 'dropped';
  clearTimeout(timer);
  const mine = () => all.get(id)?.content ?? rec.content; // 선택하는 사이 더 입력했을 수 있다
  if (id !== doc.path) {
    try { await saveNamedVersion(id, mine(), versionLabel('mine')); } catch (e) {
      toast(`내 내용을 이력에 남기지 못해 다른 탭의 내용을 불러오지 않았습니다: ${errMsg(e)}`, 'error');
      holdFailure(id, '다른 탭에서 수정되어 저장하지 못했습니다');
      return 'held';
    }
    adoptRemote(current);
    markSaved(id);
    toast(`'${stripExt(current.name)}' 이(가) 다른 탭에서 수정되어 그 내용을 불러왔습니다. 내 내용은 이력에 남겼습니다`);
    return 'done';
  }
  const act = conflictAction(await askChoose(`'${rec.name}' 이(가) 다른 탭에서 수정되었습니다. 어떻게 할까요?`, TAB_CONFLICT_BUTTONS));
  if (!all.has(id)) return 'dropped';
  if (act === 'cancel') { holdFailure(id, '다른 탭에서 수정되어 저장하지 못했습니다'); return 'held'; }
  if (act === 'overwrite') {
    try { // 덮어쓰기 전에 다른 탭의 내용을 이력에 '다른 탭 수정본'으로 남긴다
      if (current.content !== mine()) await saveNamedVersion(id, current.content, versionLabel('tab'));
    } catch (e) {
      toast(`다른 탭의 내용을 이력에 남기지 못해 덮어쓰지 않았습니다: ${errMsg(e)}`, 'error');
      holdFailure(id, '다른 탭에서 수정되어 저장하지 못했습니다');
      return 'held';
    }
    base.set(id, current.content); // 이력에 남긴 그 내용을 기준으로 다시 저장한다 — 그 사이 또 바뀌었으면 다시 충돌로 알린다
    return 'retry';
  }
  try { // 다른 탭의 내용을 불러오기 전에 내 내용을 이력에 남긴다
    await saveNamedVersion(id, mine(), versionLabel('mine'));
  } catch (e) {
    toast(`내 내용을 이력에 남기지 못해 불러오지 않았습니다: ${errMsg(e)}`, 'error');
    holdFailure(id, '다른 탭에서 수정되어 저장하지 못했습니다');
    return 'held';
  }
  adoptRemote(current);
  markSaved(id);
  toast('다른 탭의 내용을 불러왔습니다. 내 내용은 이력에 남겼습니다');
  return 'done';
}

// 다른 탭에서 글이 지워졌다(저장하려는데 DB 에 없다)
async function resolveGone(id: string): Promise<Resolution> {
  const rec = all.get(id);
  if (!rec) return 'dropped';
  clearTimeout(timer);
  const label = stripExt(fullOf(rec));
  const inTrash = isTrashed((await db.get(id).catch(() => undefined)) ?? {}); // 휴지통으로 옮겨진 것이면 안내만 달리한다(고르는 동작은 같다)
  const act = id === doc.path
    ? goneAction(await askChoose(`'${rec.name}' 이(가) 다른 탭에서 ${inTrash ? '휴지통으로 옮겨졌' : '지워졌'}습니다. 어떻게 할까요?`, GONE_BUTTONS))
    : 'close'; // 열려 있지 않은 글은 묻지 않고 내용을 이력에 남기고 닫는다
  if (!all.has(id)) return 'dropped';
  if (act === 'cancel') { holdFailure(id, '다른 탭에서 지워져 저장하지 못했습니다'); return 'held'; }
  if (act === 'recreate') return 'recreate';
  try {
    await saveNamedVersion(id, all.get(id)?.content ?? rec.content, versionLabel('gone'));
  } catch (e) {
    toast(`내용을 이력에 남기지 못해 닫지 않았습니다: ${errMsg(e)}`, 'error');
    holdFailure(id, '다른 탭에서 지워져 저장하지 못했습니다');
    return 'held';
  }
  dropLocal(id);
  toast(`'${label}' 글을 닫았습니다. 내용은 이력에 남겼습니다`);
  return 'dropped';
}

/** 메모리 사본에서 글을 걷어 내고, 열려 있었으면 빈 화면으로 되돌린다(되살아 저장되지 않게) */
function dropLocal(id: string) {
  const wasOpen = id === doc.path;
  all.delete(id);
  base.delete(id);
  markSaved(id);
  if (wasOpen) resetDoc();
  refreshList();
}

function resetDoc() {
  clearTimeout(timer);
  pendingEdit = false;
  Object.assign(doc, { path: '', name: '제목 없음', content: '', dirty: false });
  doc.key++;
  try { localStorage.removeItem(LAST_KEY); } catch { /* 무시 */ }
}

/** DB 의 글을 이 탭의 사본으로 받아들인다. 열린 글이면 편집기를 새 내용으로 다시 만든다(스크롤 위치는 되도록 유지) */
function adoptRemote(rec: Rec) {
  all.set(rec.id, rec);
  base.set(rec.id, rec.content);
  refreshList();
  if (rec.id !== doc.path) return;
  const top = document.querySelector<HTMLElement>('.editor-wrap')?.scrollTop ?? 0;
  clearTimeout(timer);
  pendingEdit = false;
  Object.assign(doc, { name: rec.name, content: rec.content, dirty: false });
  doc.key++;
  if (top) for (const ms of [0, 150, 500, 1200]) setTimeout(() => { const w = document.querySelector<HTMLElement>('.editor-wrap'); if (w && Math.abs(w.scrollTop - top) > 2) w.scrollTop = top; }, ms); // 편집기가 다시 만들어지는 동안 몇 번 되돌린다
}

// ---- 다른 탭의 변경 반영 ----
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncing: Promise<void> | undefined;
let syncAgain = false;
const scheduleSync = () => { clearTimeout(syncTimer); syncTimer = setTimeout(() => void syncFromDb(), 120); }; // 연이은 알림은 한 번만 읽는다

/** DB 에서 글·폴더 목록을 다시 읽어 메모리 사본과 화면을 맞춘다 */
function syncFromDb(): Promise<void> {
  if (syncing) { syncAgain = true; return syncing; }
  syncing = (async () => {
    do {
      syncAgain = false;
      try { await applyDbState(); } catch { /* 다음 알림·표시 때 다시 읽는다 */ }
    } while (syncAgain);
  })().finally(() => { syncing = undefined; });
  return syncing;
}

async function applyDbState() {
  const [everything, folders, dirs] = await Promise.all([db.getAll(), db.readFolders(), db.readTrashDirs()]);
  const recs = liveDocs(everything); // 휴지통의 글은 이 탭의 목록·검색에서 빠진다(없는 것으로 맞춘다)
  trash.count = trashItems(everything, dirs).length;
  fireTrashChange();
  const id = doc.path;
  const keep = new Set([...unsaved, ...(id && (pendingEdit || inflight > 0) ? [id] : [])]); // 저장하지 않은 입력이 있는 글은 메모리 내용을 지킨다
  mergeRecs(all, base, recs, keep);
  folderSet.clear();
  for (const f of folders) folderSet.add(f);
  refreshList();
  if (!id) return;
  const dbRec = recs.find((r) => r.id === id);
  const plan = planRemoteDoc({
    editing: keep.has(id), docName: doc.name, docContent: doc.content, db: dbRec && { name: dbRec.name, content: dbRec.content },
    trashed: !dbRec && isTrashed(everything.find((r) => r.id === id) ?? {}),
  });
  if (plan.kind === 'reload' && dbRec) adoptRemote(dbRec);
  else if (plan.kind === 'rename') doc.name = plan.name;
  else if (plan.kind === 'closed') {
    const label = stripExt(doc.name);
    dropLocal(id);
    toast(plan.trashed ? `'${label}' 이(가) 다른 탭에서 휴지통으로 옮겨져 닫았습니다` : `'${label}' 이(가) 다른 탭에서 지워져 닫았습니다`);
  } else if (plan.kind === 'gone-editing' && !held.has(id)) {
    void enqueue(() => persist(id, true)).catch(() => { /* 입출력 오류는 다음 저장에서 알린다 */ }); // DB 에 없으니 '다시 만들기 / 닫기 / 취소'를 묻는다
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
      const was = importing;
      importing = Math.max(0, importing + (on ? 1 : -1));
      if (!importing) scheduleGc();
      if (!was !== !importing) notifyTabs({ t: 'importing', on: importing > 0 }); // 다른 탭의 gc 도 멈춘다
    },
    design: { current: () => serializeDesign(designState), apply: importDesign },
  }));
  listenOtherTabs();
  void loadTemplateInfo();
  try {
    await navigator.storage?.persist?.(); // 브라우저가 임의로 비우지 않도록 요청(거절돼도 무시)
    const [everything, folders, dirs] = await Promise.all([db.getAll(), db.readFolders().catch(() => [] as string[]), db.readTrashDirs().catch(() => ({}))]);
    for (const r of liveDocs(everything)) { all.set(r.id, r); base.set(r.id, r.content); } // 휴지통의 글은 메모리 사본에 올리지 않는다
    for (const f of folders) folderSet.add(f);
    trash.count = trashItems(everything, dirs).length;
    refreshList();
    const last = localStorage.getItem(LAST_KEY);
    if (last && all.has(last)) await openDoc(last);
    void expireTrash(); // 30일 지난 휴지통 항목을 비운다
  } catch (e) {
    toast(`보관소를 열지 못했습니다: ${errMsg(e)}`, 'error');
  }
}

// 번들을 가져온 뒤: IndexedDB 의 문서를 메모리 사본으로 다시 읽고, 열린 문서가 바뀌었으면 편집기를 갱신한다
// 이 변경이 다른 탭에도 반영되도록 알린다(번들 병합 포함). 편집 중인 글은 메모리 내용을 지킨다
async function reloadAfterBundle() {
  await syncFromDb();
  notifyTabs({ t: 'docs' });
}

// 다른 탭의 알림을 듣는다: 목록·열린 글을 DB 에서 다시 읽는다. 알림 채널이 없는 환경을 위해 탭이 다시 보일 때도 읽는다.
let listening = false;
let remoteImportUntil = 0;
function listenOtherTabs() {
  if (listening) return;
  listening = true;
  startTabSync();
  onTabMessage((m) => {
    if (m.t === 'docs') scheduleSync();
    else if (m.t === 'template') void loadTemplateInfo();
    else if (m.t === 'importing') {
      remoteImportUntil = m.on ? Date.now() + 10 * 60_000 : 0; // 가져오는 탭이 닫혀 끝 알림이 없어도 10분 뒤에는 다시 정리한다
      if (!m.on) scheduleGc();
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(); });
  window.addEventListener('storage', (e) => { // 설정(localStorage)은 통째로 쓰므로 낡은 탭이 다른 탭의 변경을 되돌리지 않게 바뀐 값을 받아들인다
    if (e.key !== 'notes.settings' || !e.newValue) return;
    try {
      const next = JSON.parse(e.newValue) as Record<string, unknown>;
      for (const k of Object.keys(settings)) if (k !== 'version' && k in next) (settings as Record<string, unknown>)[k] = next[k];
      applyTheme();
    } catch { /* 깨진 값은 무시 */ }
  });
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
  pendingEdit = true;
  clearTimeout(timer);
  if (held.has(doc.path)) return; // 충돌·삭제 선택을 취소한 글은 직접 저장할 때까지 자동 저장하지 않는다
  timer = setTimeout(() => void flush(), 400);
}

// 대기 중인 변경을 즉시 기록한다
export async function flush() {
  clearTimeout(timer);
  const id = doc.path;
  if (!id || !all.has(id)) return;
  try {
    await enqueue(() => persist(id, doc.saveFailed));
  } catch (e) {
    markSaveFailed(id, e); // 첫 실패는 persist 가 토스트로 알렸고, 이후는 상단바 표시와 재시도가 맡는다
  }
}

export async function save(): Promise<boolean> {
  held.delete(doc.path); // 직접 저장은 보류를 풀고 다시 확인한다
  await flush();
  if (!doc.saveFailed) toast('저장했습니다');
  return !doc.saveFailed;
}

// ---- 문서 목록 ----
export async function openDoc(id: string) {
  await flush();
  // 다른 탭이 바꿨을 수 있으니 DB 의 최신 레코드로 연다(시작 때 읽은 사본을 그대로 쓰면 그 위에 입력해 다른 탭의 편집을 덮는다)
  if (!unsaved.has(id)) {
    try {
      const fresh = await db.get(id);
      if (fresh && !isTrashed(fresh)) { all.set(id, fresh); base.set(id, fresh.content); }
      else if (all.has(id)) { dropLocal(id); toast(fresh ? '다른 탭에서 휴지통으로 옮겨진 글입니다' : '다른 탭에서 지워진 글입니다', 'error'); return; }
    } catch { /* 읽지 못하면 메모리 사본으로 연다 */ }
  }
  const rec = all.get(id);
  if (!rec) return;
  pendingEdit = false;
  refreshList();
  Object.assign(doc, { path: id, name: rec.name, content: rec.content, dirty: false, edit: defaultEdit() }); // 문서는 편집 모드로 연다(모바일은 읽기)
  lib.dir = folderOf(rec); // 새 글은 지금 보는 글의 폴더에 만든다
  doc.key++;
  void snapshot(id, rec.content).catch(() => { /* 무시 */ });
  try { localStorage.setItem(LAST_KEY, id); } catch { /* 무시 */ }
}

/** 그 폴더 바로 아래의 하위 폴더 이름(소문자). 글 전체 이름('x.md')과 같은 폴더 이름이 겹치지 않게 검사할 때 쓴다 */
const subFolderNames = (folder: string) => new Set(allFolders().filter((f) => splitPath(f).folder === folder).map((f) => splitPath(f).name.toLowerCase()));
/** 그 폴더 바로 아래의 글 이름(소문자) */
const docNamesIn = (folder: string, skipId = '', recs: Iterable<Rec> = all.values()) => new Set([...recs].filter((r) => r.id !== skipId && folderOf(r) === folder).map((r) => r.name.toLowerCase()));

// 같은 이름이 있으면 '이름 (2).md' 처럼 번호를 붙인다(같은 계층의 폴더 이름과도 겹치지 않게). recs: 글 목록의 기준(기본은 메모리 사본, 새 글은 DB 의 최신 목록)
function uniqueName(stem: string, folder = '', recs: Iterable<Rec> = all.values()): string {
  const names = new Set([...docNamesIn(folder, '', recs), ...subFolderNames(folder)]);
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${stem}.md` : `${stem} (${i}).md`;
    if (!names.has(name.toLowerCase())) return name;
  }
}

// edit: 열었을 때 편집 모드로 시작할지. 이제 모든 문서가 편집 모드로 열려 사실상 의미가 없다(호출부 호환용).
async function createRec(stem: string, content: string, open = true, edit = false, folder = ''): Promise<Rec> {
  let rec: Rec;
  try {
    // 이름은 DB 의 최신 목록으로 정한다(다른 탭이 같은 이름의 글을 막 만들었어도 겹치지 않게)
    rec = await db.create((existing) => ({ id: uuid(), name: uniqueName(stem, folder, existing), ...(folder ? { folder } : {}), content, updated: Date.now() }));
  } catch (e) {
    toast(`저장하지 못했습니다: ${errMsg(e)}`, 'error');
    throw e;
  }
  markChanged(); // 문서 생성·가져오기도 변경으로 기록
  await clearDocGone(fullOf(rec)).catch(() => { /* 무시 */ }); // 같은 이름으로 다시 만들면 삭제 묘비는 지운다
  all.set(rec.id, rec);
  base.set(rec.id, rec.content);
  refreshList();
  notifyTabs({ t: 'docs' });
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
  await editFolders((s) => s.add(path));
  refreshList();
  expandFolder(parent);
  lib.dir = path;
}

// 이름·폴더 변경은 DB 의 최신 레코드에 그 필드만 고쳐 쓴다(내용은 DB 의 것을 그대로 둬서, 낡은 사본으로 다른 탭의 편집을 되돌리지 않는다)
class ClashError extends Error {}
const withFolder = (r: Rec, f: string): Rec => { const { folder: _old, ...rest } = r; void _old; return f ? { ...rest, folder: f } : rest; };
const metaMessage = (e: unknown) => (e instanceof ClashError ? e.message : `저장하지 못했습니다: ${errMsg(e)}`);
const metaFail = (e: unknown) => toast(metaMessage(e), 'error');
/** DB 에 기록된 이름·폴더를 메모리 사본에 옮긴다 */
function applyMeta(next: Rec) {
  const m = all.get(next.id);
  if (!m) return;
  m.name = next.name;
  if (next.folder) m.folder = next.folder; else delete m.folder;
}

/** 폴더 경로를 from → to 로 바꾼다(이름 변경·이동). 하지 못하면 이유를 돌려준다(알림은 부른 쪽이 한다) */
async function relocateFolder(from: string, to: string): Promise<string | undefined> {
  await syncFromDb(); // 다른 탭이 방금 만든 글·폴더까지 보고 검사한다
  if (allFolders().some((f) => f !== from && !f.startsWith(from + '/') && f.toLowerCase() === to.toLowerCase())) return '같은 이름의 폴더가 있습니다';
  const dest = splitPath(to);
  if (docNamesIn(dest.folder).has(dest.name.toLowerCase())) return '같은 위치에 같은 이름의 문서가 있습니다';
  const affected = [...all.values()].filter((r) => inFolder(r, from));
  const clash =affected.find((r) => [...all.values()].some((o) => !inFolder(o, from) && fullOf(o).toLowerCase() === fullPath(remap(folderOf(r), from, to), r.name).toLowerCase()));
  if (clash) return '옮길 곳에 같은 이름의 문서가 있습니다';
  if (doc.path) await flush();
  let failure: string | undefined;
  const olds = new Map(affected.map((r) => [r.id, fullOf(r)]));
  try {
    const saved = await db.patchMany(affected.map((r) => r.id), (cur) => withFolder(cur, remap(folderOf(cur), from, to)));
    for (const r of saved) {
      applyMeta(r);
      await recordDocGone(olds.get(r.id) ?? '').catch(() => { /* 무시 */ }); // 번들은 글 이름이 경로라 옛 경로는 지운 글로 기록한다
      await clearDocGone(fullOf(r)).catch(() => { /* 무시 */ });
    }
    if (saved.length) { markChanged(); notifyTabs({ t: 'docs' }); }
  } catch (e) { failure = metaMessage(e); }
  await editFolders((s) => { const next = [...s].map((f) => remap(f, from, to)); s.clear(); for (const f of next) s.add(f); });
  lib.dir = remap(lib.dir, from, to);
  followRename(from, to);
  refreshList();
  return failure;
}

export async function renameFolder(path: string, input: string) {
  const name = sanitizeName(input);
  if (!name) return;
  const to = fullPath(splitPath(path).folder, name);
  if (to !== path) { const err = await relocateFolder(path, to); if (err) toast(err, 'error'); }
}

/** 폴더를 다른 폴더(destParent) 안으로 옮긴다. 자기 자신·자기 하위로는 옮길 수 없다. 하지 못하면 이유를 돌려준다 */
async function moveFolderCore(path: string, destParent: string): Promise<string | undefined> {
  const to = fullPath(destParent, splitPath(path).name);
  if (to === path || destParent === path || destParent.startsWith(path + '/')) return undefined;
  const err = await relocateFolder(path, to);
  if (!err) expandFolder(destParent);
  return err;
}
export async function moveFolder(path: string, destParent: string) {
  const err = await moveFolderCore(path, destParent);
  if (err) toast(err, 'error');
}

/** 글을 다른 폴더로 옮긴다('' = 최상위). 하지 못하면 이유를 돌려준다 */
async function moveDocCore(id: string, dest: string): Promise<string | undefined> {
  const rec = all.get(id);
  if (!rec || folderOf(rec) === dest) return undefined;
  if ([...all.values()].some((r) => r.id !== id && folderOf(r) === dest && r.name.toLowerCase() === rec.name.toLowerCase())) return '그 폴더에 같은 이름의 문서가 있습니다';
  if (subFolderNames(dest).has(rec.name.toLowerCase())) return '그 폴더에 같은 이름의 폴더가 있습니다';
  if (rec.id === doc.path) await flush();
  let old = fullOf(rec);
  let next: Rec | undefined;
  try {
    next = await db.patch(id, (cur, list) => {
      old = fullOf(cur);
      if (list.some((r) => r.id !== id && folderOf(r) === dest && r.name.toLowerCase() === cur.name.toLowerCase())) throw new ClashError('그 폴더에 같은 이름의 문서가 있습니다');
      return withFolder(cur, dest);
    });
  } catch (e) {
    return metaMessage(e);
  }
  if (!next) { void syncFromDb(); return '다른 탭에서 지워진 글입니다'; }
  applyMeta(next);
  markChanged();
  await recordDocGone(old).catch(() => { /* 무시 */ });
  await clearDocGone(fullOf(next)).catch(() => { /* 무시 */ });
  notifyTabs({ t: 'docs' });
  followRename(old, fullOf(next));
  expandFolder(dest);
  refreshList();
  return undefined;
}
export async function moveDoc(id: string, dest: string) {
  const err = await moveDocCore(id, dest);
  if (err) toast(err, 'error');
}

/** 트리의 여러 항목 이동(TreeCtl.moveMany): 하나씩 옮기고 결과를 센다 */
export async function moveNodes(nodes: { type: 'file' | 'dir'; path: string }[], destDir: string): Promise<BulkResult> {
  let ok = 0;
  let failed = 0;
  let error: string | undefined;
  for (const n of nodes) {
    const err = n.type === 'dir' ? await moveFolderCore(n.path, destDir) : await moveDocCore(n.path, destDir);
    if (err) { failed++; error ||= err; } else ok++;
  }
  return { ok, failed, ...(error ? { error } : {}) };
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
  let prevFull = fullOf(rec);
  let next: Rec | undefined;
  try {
    next = await db.patch(id, (cur, list) => {
      prevFull = fullOf(cur);
      if (list.some((r) => r.id !== id && folderOf(r) === folderOf(cur) && r.name.toLowerCase() === name.toLowerCase())) throw new ClashError('같은 이름의 문서가 있습니다');
      return { ...cur, name };
    });
  } catch (e) {
    metaFail(e);
    return;
  }
  if (!next) { toast('다른 탭에서 지워진 글입니다', 'error'); void syncFromDb(); return; }
  applyMeta(next);
  markChanged();
  await recordDocGone(prevFull).catch(() => { /* 무시 */ }); // 옛 이름은 '지운 글'로 기록한다
  await clearDocGone(fullOf(next)).catch(() => { /* 무시 */ });
  notifyTabs({ t: 'docs' });
  followRename(prevFull, fullOf(next));
  if (rec.id === doc.path) { doc.name = name; editorBridge.focus?.(); } // 이름 변경 직후 본문으로 포커스 복귀
  refreshList();
}

// ---- 휴지통 ----
// 삭제 = 휴지통으로 보내기: 글 레코드에 deletedAt 만 표시하고 이력·코멘트 스레드·이미지·글감 핀은 그대로 둔다(복구하면 그대로 돌아온다).
// 폴더는 안의 글을 같은 삭제 묶음으로 표시하고 폴더 목록(빈 폴더 포함)을 묶음에 기억한다. 완전 삭제·30일 경과 때에만 예전의 삭제 정리(핀·스레드·이력)를 한다.

/** 이 탭에서 휴지통으로 간 글을 걷어 내고(열려 있었으면 닫는다) 삭제 묘비를 남기고 다른 탭에 알린다 */
async function finishTrashed(recs: DocRec[]) {
  for (const r of recs) {
    await recordDocGone(fullOf(r), r.deletedAt).catch(() => { /* 무시 */ }); // 다른 기기의 번들에서 되살아나지 않도록 묘비를 남긴다(번들이 더 늦게 수정됐으면 되살린다)
    markSaved(r.id); // 저장하지 못한 채 남아 있던 글이면 재시도 대상에서 뺀다
    dropLocal(r.id);
  }
  if (!recs.length) return;
  markChanged();
  notifyTabs({ t: 'docs' });
  await refreshTrash();
}

/** 글들을 휴지통으로 보낸다. 휴지통으로 간 레코드를 돌려준다 */
async function trashDocsCore(ids: string[]): Promise<DocRec[]> {
  if (doc.path && ids.includes(doc.path)) await flush(); // 열려 있던 글의 입력 중인 내용까지 기록해 두고 보낸다
  await queue; // 이미 줄 선 저장이 끝난 뒤 보낸다
  await flushComments(); // 대기 중인 코멘트 저장이 끝난 뒤(스레드는 그대로 남긴다)
  const recs = await db.trashDocs(ids, Date.now());
  await finishTrashed(recs);
  return recs;
}

/** 폴더를 휴지통으로 보낸다(글은 한 묶음). 이미 없으면 undefined */
async function trashFolderCore(path: string): Promise<{ id: string; docs: number } | undefined> {
  if (doc.path && all.get(doc.path) && inFolder(all.get(doc.path)!, path)) await flush();
  await queue;
  await flushComments();
  const res = await db.trashFolder(path, Date.now(), uuid());
  if (!res) return undefined;
  for (const f of [...folderSet]) if (f === path || f.startsWith(path + '/')) folderSet.delete(f);
  if (lib.dir === path || lib.dir.startsWith(path + '/')) lib.dir = splitPath(path).folder;
  await finishTrashed(res.docs);
  if (!res.docs.length) { notifyTabs({ t: 'docs' }); await refreshTrash(); } // 빈 폴더만 옮겼다
  refreshList();
  return { id: res.id, docs: res.docs.length };
}

const undoAction = (ids: string[], label: string, from?: string) => ({ label: '되돌리기', run: () => void undoTrash(ids, label, from) });

/** 휴지통으로 보낸 것을 되돌린다(토스트의 '되돌리기') */
async function undoTrash(ids: string[], label: string, from?: string) {
  const r = await restoreTrashIds(ids);
  if (!r.ok) { toast(`되돌리지 못했습니다: ${r.error ?? '알 수 없는 오류'}`, 'error'); return; }
  const renamed = from && r.paths[0] && r.paths[0] !== from ? ` (같은 이름이 있어 '${splitPath(r.paths[0]).name.replace(/\.md$/i, '')}' 이름으로 복구했습니다)` : '';
  toast(r.failed ? `${label} 중 ${r.failed}개를 되돌리지 못했습니다: ${r.error ?? ''}` : `되돌렸습니다: ${label}${renamed}`, r.failed ? 'error' : 'info');
}

export async function removeDoc(meta: DocMeta) {
  try {
    const rec = all.get(meta.id);
    const from = rec ? fullOf(rec) : '';
    const recs = await trashDocsCore([meta.id]); // 복구할 수 있으므로 확인은 묻지 않는다
    if (!recs.length) { toast('이미 다른 탭에서 지워졌거나 휴지통에 있는 글입니다', 'error'); void syncFromDb(); return; }
    const label = stripExt(meta.name);
    toast(`휴지통으로 옮겼습니다: ${label}`, 'info', { action: undoAction([meta.id], label, from) });
  } catch (e) {
    toast(`휴지통으로 옮기지 못했습니다: ${errMsg(e)}`, 'error');
  }
}

export async function removeFolder(path: string) {
  await syncFromDb();
  const label = splitPath(path).name;
  try {
    const res = await trashFolderCore(path);
    if (!res) { toast('이미 다른 탭에서 지워졌거나 휴지통에 있는 폴더입니다', 'error'); return; }
    toast(res.docs ? `휴지통으로 옮겼습니다: 폴더 ${label} (글 ${res.docs}개)` : `휴지통으로 옮겼습니다: 빈 폴더 ${label}`, 'info', { action: undoAction([res.id], `폴더 ${label}`, path) });
  } catch (e) {
    toast(`휴지통으로 옮기지 못했습니다: ${errMsg(e)}`, 'error');
  }
}

/** 트리의 여러 항목 삭제(TreeCtl.removeMany): 휴지통으로 보낸다. 확인창은 트리가 이미 띄웠다. 성공은 토스트(되돌리기)로, 실패 개수는 결과로 돌려준다 */
export async function removeNodes(nodes: { type: 'file' | 'dir'; path: string }[]): Promise<BulkResult> {
  const ids: string[] = [];
  let failed = 0;
  let error: string | undefined;
  const fail = (n: number, e: unknown) => { failed += n; error ||= e instanceof Error ? e.message : String(e); };
  const docIds = nodes.filter((n) => n.type === 'file').map((n) => n.path);
  if (docIds.length) {
    try {
      const recs = await trashDocsCore(docIds);
      ids.push(...recs.map((r) => r.id));
      if (recs.length < docIds.length) fail(docIds.length - recs.length, '이미 지워졌거나 휴지통에 있는 글입니다');
    } catch (e) { fail(docIds.length, e); }
  }
  for (const n of nodes.filter((x) => x.type === 'dir')) {
    try {
      const res = await trashFolderCore(n.path);
      if (res) ids.push(res.id); else fail(1, '이미 지워졌거나 휴지통에 있는 폴더입니다');
    } catch (e) { fail(1, e); }
  }
  if (ids.length) toast(`${ids.length}개를 휴지통으로 옮겼습니다`, 'info', { action: undoAction(ids, `${ids.length}개`) });
  return { ok: ids.length, failed, ...(error ? { error } : {}) };
}

/** 복구: 글은 원래 폴더·이름으로(같은 이름이면 '이름 (2)'), 폴더는 묶음째. 복구된 글의 삭제 묘비를 걷고 목록을 다시 읽는다 */
async function restoreTrashIds(ids: string[]): Promise<{ ok: number; failed: number; error?: string; paths: string[] }> {
  try {
    const r = await db.restoreTrash(ids);
    for (const p of r.docPaths) await clearDocGone(p).catch(() => { /* 무시 */ });
    if (r.ok) { markChanged(); notifyTabs({ t: 'docs' }); }
    await syncFromDb(); // 메모리 사본·폴더 목록·휴지통 수를 DB 에 맞춘다
    return { ok: r.ok, failed: r.failed, ...(r.error ? { error: r.error } : {}), paths: r.paths };
  } catch (e) {
    return { ok: 0, failed: ids.length, error: errMsg(e), paths: [] };
  }
}

/** 휴지통에서 완전히 지운다: 글의 이력·스레드·핀을 정리하고 이미지를 치운다 */
async function purgeTrashIds(ids: string[]) {
  const removed = await db.purgeTrash(ids);
  await cleanupPurged(removed, db);
  if (removed.length) { markChanged(); notifyTabs({ t: 'docs' }); }
  await refreshTrash();
  void gcImages(); // 휴지통 글만 참조하던 이미지(와 그 이력)를 치운다
}

/** 30일이 지난 휴지통 항목을 완전히 지운다(앱 시작 때·휴지통을 열 때). now: 시험용 */
export async function expireTrash(now = Date.now()) {
  try {
    const ids = await db.expiredTrash(now, TRASH_MS);
    if (ids.length) await purgeTrashIds(ids);
  } catch { /* 다음 기회에 다시 비운다 */ }
}

/** 사이드바 휴지통 보기에 연결하는 구현 */
export const trashCtl: TrashCtl = {
  async list(): Promise<TrashItem[]> {
    await expireTrash();
    return db.listTrash();
  },
  restore: restoreTrashIds,
  purge: purgeTrashIds,
  async empty() { await purgeTrashIds((await db.listTrash()).map((i) => i.id)); },
  subscribe(fn) { trashListeners.add(fn); return () => trashListeners.delete(fn); },
};

/** 트리의 여러 항목 내려받기(TreeCtl.downloadMany): 글의 키(id)를 글 이름으로 바꿔 한 파일로 만든다 */
export const downloadNodes = (nodes: DocNode[], format = 'zip') =>
  exportSelection((['json', 'zip', 'md'].includes(format) ? format : 'zip') as FolderExportKind, nodes, { hostName: (n) => (n.type === 'file' ? docFullPath(n.path) : n.path) });

// 이력의 버전으로 되돌린다. 되돌리기 직전의 현재 내용도 이력에 남긴다.
export async function restoreVersion(content: string) {
  if (!doc.path) return;
  held.delete(doc.path);
  await snapshot(doc.path, doc.content, true);
  clearTimeout(timer);
  pendingEdit = true; // 복원한 내용은 저장 대상이다
  doc.content = content;
  doc.key++;
  await flush();
  if (doc.saveFailed) throw new Error('저장에 실패했습니다');
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
const GC_GRACE_MS = 5 * 60 * 1000; // 방금 넣은 이미지나 실행 취소로 되살릴 수 있는 이미지는 지우지 않는다

const urls = new Map<string, Promise<string>>();

async function storeImage(blob: Blob): Promise<string> {
  const id = uuid();
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

// 어떤 문서와 이력도 참조하지 않는 이미지를 지운다.
// 참조는 이 탭의 메모리 사본이 아니라 그 시점의 DB 에서 읽고(다른 탭이 방금 넣은 이미지를 지우지 않게), 여러 탭이 동시에 돌지 않게 잠근다.
// 메모리 사본의 본문도 함께 보는 것은 저장하지 못한 입력이 참조하는 이미지를 지키기 위해서다.
async function gcImages() {
  if (importing || Date.now() < remoteImportUntil) return; // 번들 가져오는 중에는(다른 탭 포함) 하지 않는다(끝나면 setImporting 이 다시 예약한다)
  lastGc = Date.now();
  try {
    await runExclusive('works-gc', async () => {
      const history = await allContents();
      const dead = await db.gc({ extraContents: [...history, ...[...all.values()].map((r) => r.content)], now: Date.now(), graceMs: GC_GRACE_MS });
      for (const id of dead) {
        const u = urls.get(id);
        urls.delete(id);
        void u?.then((url) => URL.revokeObjectURL(url), () => {});
      }
    });
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
      let firstErr = '';
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
        } catch (e) { fail++; firstErr ||= errMsg(e); }
      }
      if (ok && !doc.path) { const first = lib.docs[0]; if (first) await openDoc(first.id); }
      toast(`'${file.name}' 에서 문서 ${ok}개를 가져왔습니다${fail ? ` (${fail}개 실패: ${firstErr})` : ''}`, fail ? 'error' : 'info');
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
      notifyTabs({ t: 'template' });
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
  notifyTabs({ t: 'template' });
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
