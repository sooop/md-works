// 웹서버 버전: 파일 API 호출과 폴더 노트 앱 로직
import {
  doc, defaultEdit, requestEditorFocus, settings, persistSettings, toast, askPrompt, askChoose, errMsg, editorBridge,
} from './store.svelte';
import {
  backoffMs, fitsKeepalive, classifySaveError, conflictAction, goneAction, leaveAction, versionLabel, saveBody,
  CONFLICT_BUTTONS, GONE_BUTTONS, LEAVE_BUTTONS, type ErrInfo,
} from './saveSafety';
import { saveNamedVersion } from './namedVersion';
import {
  basename, dirname, joinPath, safeDecode, stripExt, fileToDataUrl, imageExt,
  isExternalSrc, replaceImages, downloadText, writeClipboard, stripEmptyBlocks,
} from './utils';
import { exportDocx, isImportable, readImport } from './docx-flow';
import { IMPORT_LABEL } from './pandoc/importFormats';
import { snapshot, moveHistory } from './history';
import type { SearchResponse, FileHit } from './search/types';
import { useBackend, flushComments } from './comments/store.svelte';
import { markChanged } from './bundle/backupState.svelte';
import { useWorksStore, worksStore } from './works/store';
import { reattachDoc, reattachPrefix } from './works/snippets';
import { recordDocsGone, clearDocGone } from './bundle/tombstones';
import { createSidecarStore } from './works/sidecarStore';
import { sanitize } from './comments/anchor';
import { useBundleHost } from './bundle/host';
import { createServerHost } from './bundle/hosts/server';
import { design as designState, importDesign } from './design/state.svelte';
import { serializeDesign } from './design';
import { trackNet } from './netBusy.svelte';
import { followRename, expandFolder } from './docTree.svelte';
import { searchComments } from './search/commentSearch';
import { exportSelection, type FolderExportKind } from './folderExportUi';
import type { BulkResult } from './components/treeCtl';
import type { TrashCtl, TrashItem } from './trash';

// 새 문서를 만들 폴더(사이드바에서 선택한 폴더, 열린 문서의 폴더). 빈 문자열이면 루트.
export const nav = $state({ dir: '', filter: '' }); // filter: 사이드바 파일명 검색어

// docx 내보내기 템플릿 폴더의 .docx 목록
export const templates = $state<{ dir: string; files: string[] }>({ dir: '', files: [] });

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  mtime?: number;
  children?: TreeNode[];
}

// error: 서버에 연결하지 못했을 때의 이유(빈 문서 안내와 구분해 보여 주고 '다시 시도'를 준다)
export const tree = $state<{ nodes: TreeNode[]; root: string; error: string }>({ nodes: [], root: '', error: '' });

const LAST_KEY = 'notes.lastDoc';

// body: 오류 응답의 JSON 본문(409 충돌의 mtime 등을 읽는 데 쓴다)
class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: ErrInfo['body'] = null) { super(message); }
}

function call<T>(url: string, init?: RequestInit): Promise<T> {
  return trackNet((async () => {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.message ?? data.error ?? `요청 실패 (${res.status})`, res.status, data && typeof data === 'object' ? data : null);
    return data as T;
  })());
}
const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const q = (p: string) => encodeURIComponent(p);

export async function refreshTree() {
  const t = await call<{ children: TreeNode[] }>('/api/tree');
  tree.nodes = t.children;
}

let setupDone = false;
export async function init() {
  if (!setupDone) {
    setupDone = true;
    useWorksStore(createSidecarStore());
    useBundleHost(createServerHost({
      store: worksStore,
      // 번들을 만들거나 가져오기 전에 저장하지 않은 편집을 서버에 쓰고, 가져온 뒤에는 트리와 열린 글을 다시 읽는다
      prepare: async () => { await flushComments(); if (doc.dirty && doc.path) await save(); },
      afterApply: reloadAfterBundle,
      design: { current: () => serializeDesign(designState), apply: importDesign },
    }));
    // 스레드는 .works/threads 에 저장된다. 이전 방식 코멘트(.comments/<경로>.json)는 문서를 열 때 이관만 한다.
    useBackend({
      load: async (key) => sanitize((await call<{ comments: unknown }>(`/api/comments?path=${q(key)}`)).comments),
      clear: async (key) => { await call(`/api/comments?path=${q(key)}`, jsonInit('PUT', { comments: [] })); },
    });
  }
  await connect();
}

// 서버에 연결해 트리와 마지막 글을 읽는다. 실패하면 tree.error 에 이유를 남겨 빈 문서 안내와 구분해 보여 준다('다시 시도'는 retryConnect)
async function connect() {
  tree.error = '';
  try {
    const info = await call<{ root: string }>('/api/info');
    tree.root = info.root;
    await refreshTree();
    void refreshTemplates();
    void refreshTrashCount();
    const last = localStorage.getItem(LAST_KEY);
    if (last && !doc.path) {
      await loadDoc(last).catch((e) => {
        if (e instanceof ApiError) { try { localStorage.removeItem(LAST_KEY); } catch { /* 무시 */ } } // 서버가 답한 오류(없는 글 등)만 잊는다. 연결 문제면 다음에 다시 연다
      });
    }
  } catch (e) {
    tree.error = errMsg(e);
    toast(`서버에 연결하지 못했습니다: ${errMsg(e)}`, 'error');
  }
}

export const retryConnect = connect;

// 번들을 가져온 뒤: 파일 트리를 다시 읽고, 열려 있는 글이 바뀌었으면 다시 연다
async function reloadAfterBundle() {
  await refreshTree();
  if (!doc.path || doc.dirty) return;
  try {
    const f = await call<{ content: string; mtime?: number }>(`/api/file?path=${q(doc.path)}`);
    if (f.content !== doc.content) await loadDoc(doc.path);
    else baseMtime = f.mtime; // 내용이 같아도 번들이 파일을 다시 썼을 수 있으니 mtime 은 새로 기억한다
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) resetDoc(); // 번들의 삭제 반영으로 글이 사라졌다: 빈 화면으로 되돌린다
  }
}

// ---- 문서 열기/저장 ----
// 자동 저장: 입력이 AUTOSAVE_IDLE_MS 멈추면 저장하고, 계속 입력해도 첫 변경 후 AUTOSAVE_MAX_MS 가 지나면 저장한다
const AUTOSAVE_IDLE_MS = 700;
const AUTOSAVE_MAX_MS = 10_000;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
let autosaveMaxTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let snapTimer: ReturnType<typeof setTimeout> | undefined;

// 문서 세대: 글을 열거나 닫거나 이름을 바꿀 때마다 오른다. 요청을 보낸 뒤 세대가 바뀌었으면 그 응답은 버린다.
let docGen = 0;
// 글을 열(읽을) 때 받은 디스크 mtime. 저장마다 baseMtime 으로 보내 외부 수정을 알아챈다.
let baseMtime: number | undefined;
let failures = 0; // 연속 저장 실패 횟수(백오프 계산)
let holdAutosave = false; // 충돌에서 '취소'한 뒤: 사용자가 직접 저장하기 전까지 자동 저장을 멈춘다
let busy = 0; // 이름 변경·삭제 진행 중: 자동 저장을 걸지 않는다
let typedKey = -1; // 이 에디터(doc.key)에서 변경 통지를 받은 적이 있는지(숨김 때 에디터에서 직접 읽어도 되는지 판단)

// 이력 스냅샷 요청: 이름 변경·삭제 전에 끝나길 기다리려고 추적한다
const snaps = new Set<Promise<unknown>>();
function trackSnap(p: Promise<unknown>) {
  const t: Promise<unknown> = p.catch(() => { /* 이력은 부가 기능이라 실패해도 무시 */ }).finally(() => snaps.delete(t));
  snaps.add(t);
}

function clearAutosave() {
  clearTimeout(autosaveTimer);
  clearTimeout(autosaveMaxTimer);
  autosaveMaxTimer = undefined;
}
function clearRetry() {
  clearTimeout(retryTimer);
  retryTimer = undefined;
}
function clearFailure() {
  failures = 0;
  holdAutosave = false;
  clearRetry();
  if (doc.saveFailed) Object.assign(doc, { saveFailed: false, saveError: '' });
}

// 열린 글을 닫고 빈 화면으로 되돌린다(삭제·사라짐·번들 반영)
function resetDoc() {
  clearAutosave();
  clearFailure();
  clearTimeout(snapTimer);
  docGen++;
  baseMtime = undefined;
  Object.assign(doc, { path: '', name: '제목 없음', content: '', dirty: false });
  doc.key++;
  try { localStorage.removeItem(LAST_KEY); } catch { /* 무시 */ }
}

async function loadDoc(path: string) {
  const f = await call<{ content: string; mtime?: number }>(`/api/file?path=${q(path)}`);
  clearAutosave();
  clearFailure();
  docGen++;
  baseMtime = f.mtime;
  doc.path = path;
  nav.dir = dirname(path);
  doc.name = basename(path);
  doc.content = f.content;
  doc.dirty = false;
  doc.edit = defaultEdit(); // 문서는 편집 모드로 연다(모바일은 읽기)
  doc.key++;
  const text = f.content;
  const gen = docGen;
  clearTimeout(snapTimer);
  // 급하지 않다: 바로 다음 클릭의 요청과 디스크를 다투지 않게 미룬다. 그 사이 글이 바뀌었거나 이름이 바뀌었으면 하지 않는다
  snapTimer = setTimeout(() => { if (gen === docGen) trackSnap(snapshot(path, text)); }, 2500);
  try { localStorage.setItem(LAST_KEY, path); } catch { /* 무시 */ }
}

// 에디터에서 지금의 마크다운을 바로 읽어 온다. 에디터의 변경 통지는 200ms 디바운스(maxWait 없음)라 연속 입력 중에는 doc.content 가 뒤처진다.
// 이 에디터에서 한 번이라도 통지를 받은 뒤에만 믿는다(새 글을 막 열어 에디터가 아직 만들어지는 중이면 이전 글의 브리지가 남아 있을 수 있다).
function syncFromEditor() {
  if (typedKey !== doc.key || !doc.edit || !doc.path) return;
  try {
    const md = editorBridge.getMarkdown();
    if (typeof md === 'string' && md !== doc.content) {
      doc.content = md;
      doc.dirty = true;
      markChanged();
    }
  } catch { /* 에디터가 내려가는 중: doc.content 를 쓴다 */ }
}

// 저장을 못 하는 글에서 다른 글로 갈 때: 사라질 내용을 알리고, 복사해 둘 수 있게 한다. true 면 저장하지 않고 이동한다.
async function offerLeave(): Promise<boolean> {
  for (;;) {
    const act = leaveAction(await askChoose(
      `'${doc.name}' 을(를) 저장하지 못했습니다. 저장하지 않고 이동하면 저장하지 못한 변경이 사라집니다.`, LEAVE_BUTTONS));
    if (act === 'leave') return true;
    if (act === 'cancel') return false;
    try {
      syncFromEditor();
      await writeClipboard(doc.content);
      toast('내용을 클립보드에 복사했습니다');
    } catch (e) {
      toast(`내용을 복사하지 못했습니다: ${errMsg(e)}`, 'error');
    }
  }
}

// 변경이 있으면 저장/버리기/취소를 묻는다. true 면 진행해도 된다.
// 저장이 실패하면 저장하지 않고 이동할지 묻는다(자동 저장이 켜져 있어도 저장이 계속 실패하는 글에 갇히지 않게).
export async function guardDirty(): Promise<boolean> {
  syncFromEditor();
  if (!doc.dirty || !doc.path) return true;
  if (!settings.autosave) {
    const pick = await askChoose(`'${doc.name}' 에 저장하지 않은 변경이 있습니다.`, ['저장', '버리기', '취소']);
    if (pick === 1) return true;
    if (pick !== 0) return false;
  }
  const r = await runSave();
  if (r === 'ok') return true;
  if (r === 'cancel') return false;
  return offerLeave();
}

export async function openDoc(path: string) {
  if (path === doc.path) return;
  if (!(await guardDirty())) return;
  try { await loadDoc(path); } catch (e) { toast(errMsg(e), 'error'); }
}

type SaveResult = 'ok' | 'cancel' | 'fail';

// 저장은 한 번에 하나씩 줄 세운다(앞의 응답이 mtime 을 갱신한 뒤에 다음 요청이 baseMtime 으로 나가야 스스로 충돌하지 않는다).
// 아직 시작하지 않은 대기 요청이 있으면 그것에 합친다(시작할 때 최신 내용을 읽는다).
let saveQueue: Promise<unknown> = Promise.resolve();
let queued: Promise<SaveResult> | null = null;
function runSave(opts: { keepalive?: boolean } = {}): Promise<SaveResult> {
  if (!doc.path) return Promise.resolve('fail');
  clearAutosave();
  clearRetry();
  if (queued) return queued;
  const p: Promise<SaveResult> = saveQueue.then(() => { queued = null; return doSave(opts); });
  queued = p;
  saveQueue = p.catch(() => { /* doSave 는 던지지 않는다 */ });
  return p;
}

export async function save(): Promise<boolean> {
  return (await runSave()) === 'ok';
}

function putFile(path: string, body: ReturnType<typeof saveBody>, keepalive: boolean) {
  const init = jsonInit('PUT', body);
  if (keepalive && fitsKeepalive(init.body as string)) init.keepalive = true; // 닫히는 페이지에서도 요청이 끝까지 가게(본문 64KB 제한을 넘으면 일반 요청)
  return call<{ mtime?: number }>(`/api/file?path=${q(path)}`, init);
}

async function doSave(opts: { keepalive?: boolean }): Promise<SaveResult> {
  if (!doc.path) return 'fail';
  syncFromEditor();
  const gen = docGen;
  const path = doc.path;
  let force = false;
  for (;;) {
    const content = doc.content;
    doc.saving = true;
    try {
      const r = await putFile(path, saveBody(content, baseMtime, force), !!opts.keepalive && !force);
      if (gen !== docGen) return 'ok'; // 응답을 받는 사이 글이 바뀌었다: 파일은 저장됐지만 지금 문서의 상태는 건드리지 않는다
      baseMtime = r?.mtime;
      if (doc.content === content) doc.dirty = false; // 저장하는 동안 더 입력했으면 그대로 변경 상태로 둔다
      clearFailure();
      trackSnap(snapshot(path, content));
      return 'ok';
    } catch (e) {
      if (gen !== docGen) return 'cancel';
      const failure = classifySaveError(e as ErrInfo);
      if (failure.kind === 'other') {
        noteFailure(e);
        return 'fail';
      }
      const next = await resolveExternal(failure, path, content, gen);
      if (next === 'force') { force = true; continue; }
      return next === 'done' ? 'ok' : 'cancel';
    } finally {
      doc.saving = false;
    }
  }
}

// 저장 실패: 첫 실패만 토스트로 알리고, 이후에는 상단바 표시로 계속 알린다. 자동 저장이 켜져 있으면 지수 백오프로 다시 시도한다.
function noteFailure(e: unknown) {
  const first = !doc.saveFailed;
  failures++;
  Object.assign(doc, { saveFailed: true, saveError: errMsg(e) });
  if (first) toast(`저장하지 못했습니다: ${errMsg(e)}`, 'error');
  if (settings.autosave) {
    clearRetry();
    retryTimer = setTimeout(() => { retryTimer = undefined; void save(); }, backoffMs(failures));
  }
}

// 사용자가 충돌·사라짐 선택에서 '취소'하거나 처리에 실패한 뒤: 변경은 그대로 두고 표시만 남긴다. 직접 저장할 때까지 자동 저장은 멈춘다.
function holdFailure(msg: string) {
  holdAutosave = true;
  clearAutosave();
  clearRetry();
  Object.assign(doc, { saveFailed: true, saveError: msg });
}

// 409: 디스크의 글이 우리가 읽은 뒤 바뀌었거나(conflict) 사라졌을 때(gone)의 선택. 'force' 면 같은 내용을 덮어써 다시 저장한다.
async function resolveExternal(
  failure: Extract<ReturnType<typeof classifySaveError>, { kind: 'conflict' | 'gone' }>,
  path: string,
  content: string,
  gen: number,
): Promise<'force' | 'done' | 'cancel'> {
  clearAutosave();
  const name = doc.name;
  if (failure.kind === 'conflict') {
    const act = conflictAction(await askChoose(`'${name}' 이(가) 다른 곳에서 수정되었습니다. 어떻게 할까요?`, CONFLICT_BUTTONS));
    if (gen !== docGen) return 'cancel';
    if (act === 'cancel') { holdFailure('다른 곳에서 수정되어 저장하지 못했습니다'); return 'cancel'; }
    if (act === 'overwrite') {
      try { // 덮어쓰기 전에 디스크 내용을 이력에 '외부 수정본'으로 남긴다
        const disk = await call<{ content: string }>(`/api/file?path=${q(path)}`);
        if (disk.content !== content) await saveNamedVersion(path, disk.content, versionLabel('external'));
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) { // 그 사이 지워졌으면 남길 것도 없다
          toast(`디스크 내용을 이력에 남기지 못해 덮어쓰지 않았습니다: ${errMsg(e)}`, 'error');
          holdFailure('다른 곳에서 수정되어 저장하지 못했습니다');
          return 'cancel';
        }
      }
      return gen === docGen ? 'force' : 'cancel';
    }
    try { // 디스크 내용을 불러오기 전에 내 내용을 이력에 남긴다
      await saveNamedVersion(path, content, versionLabel('mine'));
      await loadDoc(path);
    } catch (e) {
      toast(`디스크 내용을 불러오지 못했습니다: ${errMsg(e)}`, 'error');
      holdFailure('다른 곳에서 수정되어 저장하지 못했습니다');
      return 'cancel';
    }
    toast('디스크의 내용을 불러왔습니다. 내 내용은 이력에 남겼습니다');
    return 'done';
  }
  const act = goneAction(await askChoose(`'${name}' 이(가) 다른 곳에서 지워지거나 옮겨졌습니다. 어떻게 할까요?`, GONE_BUTTONS));
  if (gen !== docGen) return 'cancel';
  if (act === 'cancel') { holdFailure('다른 곳에서 지워져 저장하지 못했습니다'); return 'cancel'; }
  if (act === 'recreate') return 'force';
  try {
    await saveNamedVersion(path, content, versionLabel('gone'));
  } catch (e) {
    toast(`내용을 이력에 남기지 못해 닫지 않았습니다: ${errMsg(e)}`, 'error');
    holdFailure('다른 곳에서 지워져 저장하지 못했습니다');
    return 'cancel';
  }
  resetDoc();
  void refreshTree().catch(() => { /* 무시 */ });
  toast('글을 닫았습니다. 내용은 이력에 남겼습니다');
  return 'done';
}

function scheduleAutosave() {
  if (!settings.autosave || !doc.path || holdAutosave || busy || failures > 0) return; // 실패 중에는 백오프 재시도가 맡는다
  autosaveTimer = setTimeout(() => void save(), AUTOSAVE_IDLE_MS);
  autosaveMaxTimer ??= setTimeout(() => void save(), AUTOSAVE_MAX_MS);
}

export function onEditorChange(md: string) {
  doc.content = md;
  typedKey = doc.key;
  markChanged(); // 백업 '마지막 변경' 추적
  doc.dirty = true;
  clearTimeout(autosaveTimer);
  scheduleAutosave();
}

// 탭을 숨기거나 페이지를 닫을 때: 디바운스 대기 중인 입력까지 에디터에서 바로 읽어 keepalive 요청으로 저장한다.
// 자동 저장을 끈 사용자의 의사를 존중해 켜져 있을 때만 한다.
export function flushOnHide() {
  if (!settings.autosave || !doc.path || holdAutosave || busy) return;
  syncFromEditor();
  if (doc.dirty) void runSave({ keepalive: true });
}

// 이력의 버전으로 되돌린다. 되돌리기 직전의 현재 내용도 이력에 남긴다.
export async function restoreVersion(content: string) {
  if (!doc.path) return;
  await snapshot(doc.path, doc.content, true);
  clearAutosave();
  doc.content = content;
  doc.dirty = true;
  doc.key++;
  if (!(await save())) throw new Error('저장에 실패했습니다');
}

// ---- 본문 검색 ----
const allDocPaths = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => (n.type === 'file' ? [n.path] : allDocPaths(n.children ?? [])));

export async function searchFiles(
  query: string,
  opts: { caseSensitive: boolean; regex: boolean },
  signal: AbortSignal,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, cs: opts.caseSensitive ? '1' : '0', re: opts.regex ? '1' : '0' });
  const r = await call<{ results: { path: string; matches: FileHit['matches']; more: boolean }[]; count: number; truncated: boolean }>(
    `/api/search?${params}`,
    { signal },
  );
  // 코멘트는 노트 폴더의 사이드카에 있어서 클라이언트에서 문서마다 읽어 같은 검색어로 찾는다
  const docs = allDocPaths(tree.nodes).map((p) => ({ id: p, label: stripExt(p) }));
  const comments = await searchComments(worksStore(), docs, query, opts).catch(() => []);
  return {
    results: r.results.map((f) => ({ id: f.path, label: stripExt(f.path), matches: f.matches, more: f.more })),
    count: r.count,
    truncated: r.truncated,
    comments,
  };
}

// ---- 파일 트리 조작 ----
const BAD_NAME = /[\\/:*?"<>|]/;

async function askName(title: string, value: string): Promise<string | null> {
  return validName(await askPrompt(title, value));
}

function validName(name: string | null): string | null {
  if (!name) return null;
  if (BAD_NAME.test(name) || name === '.' || name === '..') {
    toast('이름에 \\ / : * ? " < > | 문자는 쓸 수 없습니다', 'error');
    return null;
  }
  return name;
}

export async function createDoc(dir: string) {
  const name = await askName('새 문서 이름', '새 문서');
  if (!name) return;
  const file = /\.md$/i.test(name) ? name : `${name}.md`;
  const path = joinPath(dir, file);
  try {
    await call('/api/create', jsonInit('POST', { path, type: 'file' }));
    await clearDocGone(path).catch(() => { /* 무시 */ }); // 같은 이름으로 다시 만들면 삭제 묘비는 지운다
    await refreshTree();
    requestEditorFocus(); // 새 글은 본문에 바로 포커스
    await openDoc(path);
    if (doc.path === path) doc.edit = true; // 새로 만든 문서도 편집 모드 (loadDoc 이 이미 설정)
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

export async function createFolder(dir: string) {
  const name = await askName('새 폴더 이름', '새 폴더');
  if (!name) return;
  try {
    await call('/api/create', jsonInit('POST', { path: joinPath(dir, name), type: 'dir' }));
    await refreshTree();
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

// 노드(글 또는 폴더) 아래의 글 경로들. 삭제·이름 변경 묘비를 기록할 때 쓴다
function docPaths(node: TreeNode): string[] {
  if (node.type === 'file') return [node.path];
  return (node.children ?? []).flatMap(docPaths);
}

const affects = (target: string) => doc.path === target || doc.path.startsWith(target + '/');

export async function renameNode(node: TreeNode) {
  const isFile = node.type === 'file';
  const name = await askName('새 이름', isFile ? stripExt(node.name) : node.name);
  if (name) await renameNodeTo(node, name);
}

// 상단 제목 더블 클릭: 열려 있는 문서의 이름을 바꾼다
export async function renameCurrent(input: string) {
  if (!doc.path) return;
  const name = validName(input.trim());
  if (name) await renameNodeTo({ name: basename(doc.path), path: doc.path, type: 'file' }, name);
}

/** 목록에서 그 자리 이름 변경(더블 클릭) */
export async function renameNodeBy(node: TreeNode, input: string) {
  const name = validName(input.trim());
  if (name) await renameNodeTo(node, name);
}

async function renameNodeTo(node: TreeNode, name: string) {
  const isFile = node.type === 'file';
  const next = isFile ? (/\.md$/i.test(name) ? name : `${name}.md`) : name;
  if (next === node.name) return;
  await relocate(node, joinPath(dirname(node.path), next));
}

/** 글·폴더를 다른 폴더(destDir, '' = 최상위) 안으로 옮긴다. 자기 자신·자기 하위로는 옮길 수 없다 */
export async function moveNode(node: TreeNode, destDir: string) {
  const to = joinPath(destDir, node.name);
  if (to === node.path || destDir === node.path || destDir.startsWith(node.path + '/')) return;
  await relocate(node, to);
  expandFolder(destDir);
}

/** 화면 트리(필터·정렬을 거친 사본)가 아니라 실제 트리의 노드. 폴더 아래의 묘비·이력 정리에 children 이 온전해야 한다 */
function realNode(node: TreeNode): TreeNode {
  const find = (list: TreeNode[]): TreeNode | undefined => {
    for (const n of list) {
      if (n.path === node.path) return n;
      const hit = n.type === 'dir' && n.children ? find(n.children) : undefined;
      if (hit) return hit;
    }
  };
  return find(tree.nodes) ?? node;
}

// 한 항목 옮기기(던진다): 파일을 옮기고, 이력·글감 연결·묘비·정렬·접힘을 새 경로로 따라가게 한다. 열린 글이 영향받았으면 다시 열 새 경로를, 아니면 ''.
// 구조 변경 구간(beginStructural/endStructural)·저장하지 않은 변경 확인·트리 갱신은 호출부가 맡는다(여럿을 옮길 때 한 번만 하려고)
async function relocateOne(node: TreeNode, to: string): Promise<string> {
  const isFile = node.type === 'file';
  const moved = docPaths(realNode(node)).filter((p) => /\.md$/i.test(p));
  await flushComments(); // 대기 중인 코멘트 저장이 옮기기 전 경로에 파일을 다시 만들지 않도록
  await call('/api/rename', jsonInit('POST', { from: node.path, to }));
  // 옛 이름은 '지운 글'로 기록하고(다른 기기에서 되살아나지 않게), 새 이름의 묘비가 있으면 지운다
  await recordDocsGone(moved).catch(() => { /* 무시 */ });
  for (const p of moved) await clearDocGone(to + p.slice(node.path.length)).catch(() => { /* 무시 */ });
  await moveHistory(node.path, to).catch(() => { /* 무시 */ });
  await (isFile ? reattachDoc(node.path, to) : reattachPrefix(node.path, to)).catch(() => { /* 무시 */ }); // 글감의 붙은 글 경로 갱신
  followRename(node.path, to); // 직접 정렬 순서·접힘 상태도 새 경로를 따라간다
  const reopen = affects(node.path) ? to + doc.path.slice(node.path.length) : '';
  if (nav.dir === node.path || nav.dir.startsWith(node.path + '/')) nav.dir = to + nav.dir.slice(node.path.length);
  return reopen;
}

// 이름 바꾸기·옮기기(하나)의 공통 처리
async function relocate(node: TreeNode, to: string) {
  const mine = affects(node.path);
  if (mine && !(await guardDirty())) return;
  if (mine) await beginStructural();
  try {
    const reopen = await relocateOne(node, to);
    await refreshTree();
    if (reopen) { requestEditorFocus(); await loadDoc(reopen); } // 링크가 갱신된 파일을 다시 읽는다(이름 변경 직후 포커스)
  } catch (e) {
    toast(errMsg(e), 'error');
  } finally {
    if (mine) endStructural();
  }
}

/**
 * 여러 항목을 destDir 로 옮긴다(트리 ctl.moveMany). 이미 그 폴더에 있거나 자기 하위로 가는 항목은 건너뛴다.
 * 열린 글이 들어 있으면 저장하지 않은 변경을 먼저 확인하고(취소하면 0·0), 구조 변경 구간은 전체에 한 번만 건다. 트리는 마지막에 한 번 갱신한다.
 * 항목마다 실패해도 나머지는 계속한다 — 이름이 겹치는 항목은 서버가 거절해 실패로 센다(단일 이동과 같은 규칙)
 */
export async function moveMany(nodes: TreeNode[], destDir: string): Promise<BulkResult> {
  const list = nodes.map(realNode).filter((n) => {
    const to = joinPath(destDir, n.name);
    return !(to === n.path || destDir === n.path || destDir.startsWith(n.path + '/'));
  });
  if (!list.length) return { ok: 0, failed: 0 };
  const mine = list.some((n) => affects(n.path));
  if (mine && !(await guardDirty())) return { ok: 0, failed: 0 };
  if (mine) await beginStructural();
  let ok = 0, failed = 0;
  let error: string | undefined;
  try {
    for (const node of list) {
      try {
        const reopen = await relocateOne(node, joinPath(destDir, node.name));
        ok++;
        if (reopen) await loadDoc(reopen).catch((e) => toast(errMsg(e), 'error')); // 링크가 갱신된 파일을 다시 읽는다
      } catch (e) {
        failed++;
        error ??= errMsg(e);
      }
    }
    expandFolder(destDir);
    await refreshTree().catch((e) => toast(errMsg(e), 'error'));
  } finally {
    if (mine) endStructural();
  }
  return { ok, failed, error };
}

// 열린 글의 이름 변경·삭제 전: 자동 저장·재시도·지연 스냅샷을 멈추고, 진행 중인 저장과 이력 기록이 끝나길 기다린다.
// 그래야 늦게 끝난 저장이 옛 경로의 파일(과 이력)을 다시 만들지 않는다. 세대를 올려 그 뒤에 도착하는 응답은 버린다.
async function beginStructural() {
  busy++;
  clearAutosave();
  clearRetry();
  clearTimeout(snapTimer);
  await saveQueue;
  await Promise.allSettled([...snaps]);
  docGen++;
}
function endStructural() {
  busy = Math.max(0, busy - 1);
  if (!busy && doc.path && doc.dirty) scheduleAutosave(); // 그 사이 입력한 내용은 다시 저장 대상으로
}

/**
 * 글·폴더를 휴지통으로 보낸다 — 확인 없이(복구할 수 있다). 단일 삭제(removeNode)와 일괄 삭제(트리 ctl.removeMany)가 모두 이 함수 하나를 거친다.
 * 서버가 파일·assets·코멘트·이력·스레드를 `.works-trash` 로 함께 옮긴다. 클라이언트는 묘비(다른 기기의 번들 병합이 되살리지 않게)를 남기고,
 * 글감 핀은 떼지 않는다(복구하면 그대로 살아난다. 완전 삭제 때 뗀다). 선택 폴더·열린 글(닫는다)을 정리하고 트리는 마지막에 한 번 갱신한다.
 * 구조 변경 구간(beginStructural/endStructural)은 전체에 한 번만 건다. 항목마다 실패해도 나머지는 계속하고, 성공·실패 개수와 첫 실패 이유를 돌려준다.
 * 성공하면 '휴지통으로 옮겼습니다 + 되돌리기' 토스트를 띄운다(실패 안내는 호출부).
 */
export async function deletePaths(nodes: TreeNode[]): Promise<BulkResult> {
  const list = nodes.map(realNode);
  if (!list.length) return { ok: 0, failed: 0 };
  const mine = list.some((n) => affects(n.path));
  if (mine) await beginStructural();
  let ok = 0, failed = 0;
  let error: string | undefined;
  const sent: { id: string; node: TreeNode; docs: number; reopen: string }[] = [];
  try {
    try {
      await flushComments();
    } catch (e) {
      return { ok: 0, failed: list.length, error: errMsg(e) };
    }
    for (const node of list) {
      const hit = affects(node.path); // 열린 글이 이 항목 안에 있는가(지우면 닫는다)
      const gone = docPaths(node).filter((p) => /\.md$/i.test(p));
      const reopen = hit ? doc.path : '';
      try {
        const r = await call<{ ok: boolean; trashId: string }>(`/api/file?path=${q(node.path)}`, { method: 'DELETE' }); // 휴지통으로 옮긴다(이력·코멘트·assets 는 서버가 함께 옮긴다)
        await recordDocsGone(gone).catch(() => { /* 무시 */ }); // 다른 기기의 번들에서 되살아나지 않도록 묘비를 남긴다(번들이 더 늦게 수정됐으면 되살린다. 복구하면 걷는다)
        if (nav.dir === node.path || nav.dir.startsWith(node.path + '/')) nav.dir = dirname(node.path);
        if (hit) resetDoc();
        if (r.trashId) sent.push({ id: r.trashId, node, docs: gone.length, reopen });
        ok++;
      } catch (e) {
        failed++;
        error ??= errMsg(e);
      }
    }
    await refreshTree().catch((e) => toast(errMsg(e), 'error'));
  } finally {
    if (mine) endStructural();
  }
  if (sent.length) {
    void refreshTrashCount();
    const one = sent.length === 1 ? sent[0] : undefined;
    const text = !one ? `${sent.length}개를 휴지통으로 옮겼습니다`
      : one.node.type === 'dir' ? (one.docs ? `휴지통으로 옮겼습니다: 폴더 ${one.node.name} (글 ${one.docs}개)` : `휴지통으로 옮겼습니다: 빈 폴더 ${one.node.name}`)
      : `휴지통으로 옮겼습니다: ${stripExt(one.node.name)}`;
    const known = new Map(sent.map((s) => [s.id, { path: s.node.path, type: s.node.type }]));
    const reopen = sent.find((s) => s.reopen);
    toast(text, 'info', { action: { label: '되돌리기', run: () => void undoTrash([...known.keys()], known, reopen && { from: reopen.node.path, doc: reopen.reopen }) } });
  }
  return { ok, failed, error };
}

export async function removeNode(node: TreeNode) {
  const r = await deletePaths([node]); // 복구할 수 있으므로 확인은 묻지 않는다
  if (r.failed && r.error) toast(r.error, 'error');
}

// ---- 휴지통 ----
/** 휴지통에 든 항목 수(사이드바의 '휴지통 (N)' 단추) */
export const trash = $state({ count: 0 });
let trashKnown = new Map<string, { path: string; type: 'file' | 'dir' }>(); // 마지막으로 읽은 항목(복구·완전 삭제 뒤처리에 원래 경로가 필요하다)

export async function refreshTrashCount() {
  try { trash.count = (await call<{ items: TrashItem[] }>('/api/trash')).items.length; } catch { /* 다음에 다시 읽는다 */ }
}

const findNode = (path: string, list: TreeNode[] = tree.nodes): TreeNode | undefined => {
  for (const n of list) {
    if (n.path === path) return n;
    const hit = n.type === 'dir' && n.children ? findNode(path, n.children) : undefined;
    if (hit) return hit;
  }
};

/**
 * 복구: 서버가 원래 자리에 되돌린다(같은 이름이 있으면 '이름 (2)'). 되돌린 뒤 트리를 다시 읽고,
 * 경로가 바뀌었으면 글감 핀을 새 경로로 옮기고(원래 경로에 다른 글이 없을 때만), 복구된 글의 삭제 묘비를 걷는다.
 * 코멘트·이력·스레드는 서버가 경로에 맞춰 옮기므로 새 경로로 그대로 읽힌다.
 */
async function restoreIds(ids: string[], known: Map<string, { path: string; type: 'file' | 'dir' }> = trashKnown): Promise<{ ok: number; failed: number; error?: string; paths: string[]; from: string[] }> {
  let ok = 0, failed = 0;
  let error: string | undefined;
  const paths: string[] = [];
  const from: string[] = [];
  const back: { to: string; type: 'file' | 'dir'; was?: string }[] = [];
  for (const id of ids) {
    try {
      const r = await call<{ ok: boolean; path: string; type: 'file' | 'dir' }>('/api/trash/restore', jsonInit('POST', { id }));
      paths.push(r.path);
      from.push(known.get(id)?.path ?? r.path);
      back.push({ to: r.path, type: r.type, was: known.get(id)?.path });
      ok++;
    } catch (e) {
      failed++;
      error ??= errMsg(e);
    }
  }
  if (ok) {
    await refreshTree().catch((e) => toast(errMsg(e), 'error'));
    for (const b of back) {
      const node = findNode(b.to);
      for (const p of node ? docPaths(node).filter((x) => /\.md$/i.test(x)) : [b.to]) await clearDocGone(p).catch(() => { /* 무시 */ });
      if (b.was && b.was !== b.to && !findNode(b.was)) await (b.type === 'dir' ? reattachPrefix(b.was, b.to) : reattachDoc(b.was, b.to)).catch(() => { /* 무시 */ });
      for (const [id, k] of known) if (k.path === b.was) trashKnown.delete(id);
    }
    markChanged();
  }
  void refreshTrashCount();
  return { ok, failed, ...(error ? { error } : {}), paths, from };
}

/** 휴지통으로 보낸 것을 되돌린다(토스트의 '되돌리기'). 열려 있던 글이 닫혔고 지금 열린 글이 없으면 다시 연다 */
async function undoTrash(ids: string[], known: Map<string, { path: string; type: 'file' | 'dir' }>, reopen?: { from: string; doc: string }) {
  const r = await restoreIds(ids, known);
  if (!r.ok) { toast(`되돌리지 못했습니다: ${r.error ?? '알 수 없는 오류'}`, 'error'); return; }
  const renamed = r.paths.some((p, i) => p !== r.from[i]);
  toast(r.failed ? `${r.ok}개를 되돌렸고 ${r.failed}개는 되돌리지 못했습니다: ${r.error ?? ''}` : `되돌렸습니다${renamed ? ' (같은 이름이 있어 이름이 바뀌었습니다)' : ''}`, r.failed ? 'error' : 'info');
  if (reopen && !doc.path) {
    const i = r.from.indexOf(reopen.from);
    if (i >= 0) {
      const target = r.paths[i] + reopen.doc.slice(reopen.from.length);
      if (findNode(target)) await openDoc(target).catch(() => { /* 무시 */ });
    }
  }
}

/** 완전 삭제 뒤처리: 그 경로에 다른 글이 없으면 글감 핀을 뗀다(지운 글의 이력·스레드·코멘트는 서버가 함께 지웠다) */
async function afterPurge(ids: string[]) {
  for (const id of ids) {
    const k = trashKnown.get(id);
    if (!k) continue;
    trashKnown.delete(id);
    if (findNode(k.path)) continue; // 같은 경로에 새로 만든 글이 있으면 그 글의 핀이다
    await (k.type === 'dir' ? reattachPrefix(k.path) : reattachDoc(k.path)).catch(() => { /* 무시 */ });
  }
}

/** 사이드바 휴지통 보기에 연결하는 구현(30일 자동 비움은 서버가 하므로 목록만 다시 읽는다) */
export const trashCtl: TrashCtl = {
  async list() {
    const { items } = await call<{ items: TrashItem[] }>('/api/trash');
    trashKnown = new Map(items.map((i) => [i.id, { path: i.path, type: i.type }]));
    trash.count = items.length;
    return items;
  },
  restore: async (ids) => { const { from: _f, ...r } = await restoreIds(ids); void _f; return r; },
  async purge(ids) {
    const failed: string[] = [];
    for (const id of ids) {
      try { await call(`/api/trash?id=${q(id)}`, { method: 'DELETE' }); } catch (e) { failed.push(errMsg(e)); }
    }
    await afterPurge(ids);
    void refreshTrashCount();
    if (failed.length) throw new Error(failed[0]);
  },
  async empty() {
    await call('/api/trash', { method: 'DELETE' });
    await afterPurge([...trashKnown.keys()]);
    trash.count = 0;
  },
};

/**
 * 선택한 글·폴더를 파일 하나로 내려받는다(트리 ctl.downloadMany). format: 'zip'(기본) · 'json' · 'md'.
 * nodes 는 트리가 정렬한 노드를 그대로 받는다(연결된 MD 의 순서가 화면 순서가 되도록)
 */
export async function downloadMany(nodes: TreeNode[], format = 'zip') {
  const kind: FolderExportKind = format === 'json' || format === 'md' ? format : 'zip';
  await exportSelection(kind, nodes);
}

// ---- 이미지 ----
async function uploadFile(file: Blob, docPath: string): Promise<string> {
  const r = await call<{ url: string }>(
    `/api/upload?doc=${q(docPath)}&ext=${imageExt(file)}`,
    { method: 'POST', body: file },
  );
  return r.url;
}

// 에디터의 이미지 삽입 훅: 전역 설정에 따라 파일 또는 Base64
export async function upload(file: File): Promise<string> {
  if (settings.imageMode === 'base64') return fileToDataUrl(file);
  if (!doc.path) throw new Error('문서를 먼저 선택하세요');
  return uploadFile(file, doc.path);
}

// 문서의 상대경로 이미지를 화면에 표시할 URL 로 바꾼다
export function resolveUrl(src: string): string {
  if (isExternalSrc(src) || !doc.path) return src;
  const rel = joinPath(dirname(doc.path), safeDecode(src));
  return `/api/raw?path=${q(rel)}`;
}

// 문서 단위 변환: 파일 ↔ Base64
export async function convertImages(to: 'base64' | 'file') {
  if (!doc.path) return;
  const docPath = doc.path;
  try {
    const { text, count } = await replaceImages(doc.content, async (src) => {
      if (to === 'base64') {
        if (isExternalSrc(src)) return null;
        const res = await fetch(resolveUrl(src));
        if (!res.ok) throw new Error(`이미지를 읽지 못했습니다: ${src}`);
        return fileToDataUrl(await res.blob());
      }
      if (!src.startsWith('data:image/')) return null;
      return uploadFile(await (await fetch(src)).blob(), docPath);
    });
    if (!count) {
      toast(to === 'base64' ? '변환할 파일 이미지가 없습니다' : '변환할 Base64 이미지가 없습니다');
      return;
    }
    doc.content = text;
    doc.dirty = true;
    doc.key++;
    toast(`이미지 ${count}개를 ${to === 'base64' ? 'Base64' : '파일'}로 변환했습니다. 저장하면 반영됩니다.`);
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

// ---- 새 문서 만들기: 붙여넣기 / 파일 드롭 ----

// 같은 이름이 있으면 '이름 (2).md' 처럼 번호를 붙여 빈 파일을 만든다
async function createUnique(dir: string, stem: string): Promise<string> {
  for (let i = 1; ; i++) {
    const path = joinPath(dir, i === 1 ? `${stem}.md` : `${stem} (${i}).md`);
    try {
      await call('/api/create', jsonInit('POST', { path, type: 'file' }));
      await clearDocGone(path).catch(() => { /* 무시 */ });
      return path;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) throw e;
    }
  }
}

// 내용으로 새 문서를 만들어 연다. docx 에서 온 Base64 이미지는 설정이 '파일'이면 assets 로 분리한다.
export async function createFromContent(stem: string, content: string, opts: { splitImages?: boolean; edit?: boolean } = {}) {
  const path = await createUnique(nav.dir, stem);
  let text = content;
  if (opts.splitImages && settings.imageMode === 'file') {
    const r = await replaceImages(text, async (src) =>
      src.startsWith('data:image/') ? uploadFile(await (await fetch(src)).blob(), path) : null,
    );
    text = r.text;
  }
  await call(`/api/file?path=${q(path)}`, jsonInit('PUT', { content: text }));
  await refreshTree();
  await openDoc(path);
  if (opts.edit && doc.path === path) doc.edit = true; // 기본이 편집 모드라 중복이지만 호출부 의도를 남겨 둔다
}

export async function createFromText(name: string, text: string) {
  try {
    const stem = name.replace(/\.(md|markdown|txt)$/i, '').trim() || '새 문서';
    await createFromContent(stem, text, { edit: true }); // 붙여넣어 만든 문서는 편집 모드로 시작
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

// 파일 드롭: .md/.txt 및 pandoc 이 읽는 형식(docx·html·odt …)을 새 문서로. 이름은 묻지 않고 원본 파일 이름을 쓴다(같은 이름이 있으면 번호가 붙는다).
export async function handleDrop(files: File[]) {
  const list = files.filter(isImportable);
  if (!list.length) {
    toast(`${IMPORT_LABEL} 파일만 새 문서로 만들 수 있습니다`, 'error');
    return;
  }
  for (const file of list) {
    try {
      const imp = await readImport(file);
      await createFromContent(stripExt(imp.name), imp.content, { splitImages: imp.converted });
    } catch (e) {
      toast(`'${file.name}': ${errMsg(e)}`, 'error');
    }
  }
}

// ---- docx 내보내기 ----

export async function refreshTemplates() {
  try {
    const t = await call<{ dir: string; files: string[] }>('/api/templates');
    templates.dir = t.dir;
    templates.files = t.files;
    // 지워진 템플릿을 가리키고 있으면 기본으로 되돌린다
    if (settings.template && !t.files.includes(settings.template)) selectTemplate('');
  } catch { /* 템플릿 목록 없이 기본 템플릿만 사용 */ }
}

export function selectTemplate(name: string) {
  settings.template = name;
  persistSettings();
}

// 문서 속 상대경로 이미지 파일을 data URI 로 인라인한다.
// (docx: pandoc-wasm 에 파일 시스템이 없음 / md 다운로드: 폴더 밖에서는 상대 링크가 깨짐)
async function inlineImages(markdown: string) {
  return replaceImages(markdown, async (src) => {
    if (isExternalSrc(src)) return null;
    const res = await fetch(resolveUrl(src));
    return res.ok ? fileToDataUrl(await res.blob()) : null;
  });
}

// .md 로 내려받기 (노트 폴더와 무관한 다운로드). 이미지 파일은 Base64 로 포함해 단독으로 열어도 보이게 한다.
export async function exportMdCurrent() {
  if (!doc.path) return;
  try {
    const { text, count } = await inlineImages(doc.content);
    downloadText(/\.md$/i.test(doc.name) ? doc.name : `${doc.name}.md`, text);
    toast(count > 0 ? `.md 파일을 내려받았습니다 (이미지 ${count}개는 Base64로 포함)` : '.md 파일을 내려받았습니다');
  } catch (e) {
    toast(`.md 내보내기 실패: ${errMsg(e)}`, 'error');
  }
}

export async function copyMdCurrent() {
  if (!doc.path) return;
  try {
    await writeClipboard(stripEmptyBlocks(doc.content));
    toast('마크다운 텍스트를 클립보드에 복사했습니다');
  } catch (e) {
    toast(`복사 실패: ${errMsg(e)}`, 'error');
  }
}

export async function exportDocxCurrent() {
  if (!doc.path) return;
  try {
    const { text } = await inlineImages(doc.content);
    let template: Blob | null = null;
    if (settings.template) {
      const res = await fetch(`/api/template?name=${q(settings.template)}`);
      if (res.ok) template = await res.blob();
      else toast(`템플릿 '${settings.template}' 을 읽지 못해 기본 템플릿을 사용합니다`, 'error');
    }
    await exportDocx(text, doc.name, template);
  } catch (e) {
    toast(`DOCX 내보내기 실패: ${errMsg(e)}`, 'error');
  }
}
