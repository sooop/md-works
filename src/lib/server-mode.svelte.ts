// 웹서버 버전: 파일 API 호출과 폴더 노트 앱 로직
import {
  doc, settings, persistSettings, toast, askPrompt, askConfirm, askChoose, errMsg,
} from './store.svelte';
import {
  basename, dirname, joinPath, safeDecode, stripExt, fileToDataUrl, imageExt,
  isExternalSrc, replaceImages, downloadText, writeClipboard,
} from './utils';
import { exportDocx, isImportable, readImport } from './docx-flow';
import { snapshot, moveHistory, removeHistory } from './history';
import type { SearchResponse, FileHit } from './search/types';
import { useBackend, flushComments } from './comments/store.svelte';
import { sanitize } from './comments/anchor';

// 새 문서를 만들 폴더(사이드바에서 선택한 폴더, 열린 문서의 폴더). 빈 문자열이면 루트.
export const nav = $state({ dir: '', filter: '' }); // filter: 사이드바 파일명 검색어

// docx 내보내기 템플릿 폴더의 .docx 목록
export const templates = $state<{ dir: string; files: string[] }>({ dir: '', files: [] });

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

export const tree = $state<{ nodes: TreeNode[]; root: string }>({ nodes: [], root: '' });

const LAST_KEY = 'notes.lastDoc';

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `요청 실패 (${res.status})`, res.status);
  return data as T;
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

export async function init() {
  // 코멘트는 노트 폴더의 .comments/<경로>.json 사이드카에 둔다
  useBackend({
    load: async (key) => sanitize((await call<{ comments: unknown }>(`/api/comments?path=${q(key)}`)).comments),
    save: async (key, comments) => { await call(`/api/comments?path=${q(key)}`, jsonInit('PUT', { comments })); },
  });
  try {
    const info = await call<{ root: string }>('/api/info');
    tree.root = info.root;
    await refreshTree();
    void refreshTemplates();
    const last = localStorage.getItem(LAST_KEY);
    if (last) await loadDoc(last).catch(() => localStorage.removeItem(LAST_KEY));
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

// ---- 문서 열기/저장 ----
// 자동 저장: 입력이 AUTOSAVE_IDLE_MS 멈추면 저장하고, 계속 입력해도 첫 변경 후 AUTOSAVE_MAX_MS 가 지나면 저장한다
const AUTOSAVE_IDLE_MS = 700;
const AUTOSAVE_MAX_MS = 10_000;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
let autosaveMaxTimer: ReturnType<typeof setTimeout> | undefined;

function clearAutosave() {
  clearTimeout(autosaveTimer);
  clearTimeout(autosaveMaxTimer);
  autosaveMaxTimer = undefined;
}

async function loadDoc(path: string) {
  const f = await call<{ content: string }>(`/api/file?path=${q(path)}`);
  clearAutosave();
  doc.path = path;
  nav.dir = dirname(path);
  doc.name = basename(path);
  doc.content = f.content;
  doc.dirty = false;
  doc.key++;
  void snapshot(path, f.content).catch(() => { /* 이력은 부가 기능이라 실패해도 무시 */ });
  try { localStorage.setItem(LAST_KEY, path); } catch { /* 무시 */ }
}

// 변경이 있으면 저장/버리기/취소를 묻는다. true 면 진행해도 된다.
export async function guardDirty(): Promise<boolean> {
  if (!doc.dirty || !doc.path) return true;
  if (settings.autosave) return save();
  const pick = await askChoose(`'${doc.name}' 에 저장하지 않은 변경이 있습니다.`, ['저장', '버리기', '취소']);
  if (pick === 0) return save();
  return pick === 1;
}

export async function openDoc(path: string) {
  if (path === doc.path) return;
  if (!(await guardDirty())) return;
  try { await loadDoc(path); } catch (e) { toast(errMsg(e), 'error'); }
}

export async function save(): Promise<boolean> {
  if (!doc.path) return false;
  clearAutosave();
  doc.saving = true;
  try {
    const { path, content } = doc;
    await call(`/api/file?path=${q(path)}`, jsonInit('PUT', { content }));
    doc.dirty = false;
    void snapshot(path, content).catch(() => { /* 무시 */ });
    return true;
  } catch (e) {
    toast(`저장 실패: ${errMsg(e)}`, 'error');
    return false;
  } finally {
    doc.saving = false;
  }
}

export function onEditorChange(md: string) {
  doc.content = md;
  doc.dirty = true;
  clearTimeout(autosaveTimer);
  if (!settings.autosave || !doc.path) return;
  autosaveTimer = setTimeout(() => void save(), AUTOSAVE_IDLE_MS);
  autosaveMaxTimer ??= setTimeout(() => void save(), AUTOSAVE_MAX_MS);
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
  return {
    results: r.results.map((f) => ({ id: f.path, label: stripExt(f.path), matches: f.matches, more: f.more })),
    count: r.count,
    truncated: r.truncated,
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
    await refreshTree();
    await openDoc(path);
    if (doc.path === path) doc.edit = true; // 새로 만든 문서는 편집 모드로 시작
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

async function renameNodeTo(node: TreeNode, name: string) {
  const isFile = node.type === 'file';
  const next = isFile ? (/\.md$/i.test(name) ? name : `${name}.md`) : name;
  if (next === node.name) return;
  if (affects(node.path) && !(await guardDirty())) return;
  const to = joinPath(dirname(node.path), next);
  try {
    await flushComments(); // 대기 중인 코멘트 저장이 옮기기 전 경로에 파일을 다시 만들지 않도록
    await call('/api/rename', jsonInit('POST', { from: node.path, to }));
    await moveHistory(node.path, to).catch(() => { /* 무시 */ });
    const reopen = affects(node.path) ? to + doc.path.slice(node.path.length) : '';
    if (nav.dir === node.path || nav.dir.startsWith(node.path + '/')) nav.dir = to + nav.dir.slice(node.path.length);
    await refreshTree();
    if (reopen) await loadDoc(reopen); // 링크가 갱신된 파일을 다시 읽는다
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

export async function removeNode(node: TreeNode) {
  const what = node.type === 'dir' ? `폴더 '${node.name}' 와 그 안의 모든 문서` : `문서 '${node.name}'`;
  if (!(await askConfirm(`${what}를 삭제할까요? 되돌릴 수 없습니다.`, '삭제'))) return;
  try {
    await flushComments();
    await call(`/api/file?path=${q(node.path)}`, { method: 'DELETE' });
    await removeHistory(node.path).catch(() => { /* 무시 */ });
    if (nav.dir === node.path || nav.dir.startsWith(node.path + '/')) nav.dir = dirname(node.path);
    if (affects(node.path)) {
      clearAutosave();
      Object.assign(doc, { path: '', name: '제목 없음', content: '', dirty: false });
      doc.key++;
      try { localStorage.removeItem(LAST_KEY); } catch { /* 무시 */ }
    }
    await refreshTree();
  } catch (e) {
    toast(errMsg(e), 'error');
  }
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
  if (opts.edit && doc.path === path) doc.edit = true;
}

export async function createFromText(name: string, text: string) {
  try {
    const stem = name.replace(/\.(md|markdown|txt)$/i, '').trim() || '새 문서';
    await createFromContent(stem, text, { edit: true }); // 붙여넣어 만든 문서는 편집 모드로 시작
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

// 파일 드롭: .md/.txt/.docx 를 새 문서로. 한 개면 이름을 확인하고, 여러 개면 원본 이름으로 만든다.
export async function handleDrop(files: File[]) {
  const list = files.filter(isImportable);
  if (!list.length) {
    toast('.md / .txt / .docx 파일만 새 문서로 만들 수 있습니다', 'error');
    return;
  }
  for (const file of list) {
    try {
      const imp = await readImport(file);
      let stem = stripExt(imp.name);
      if (list.length === 1) {
        const picked = await askName('새 문서 이름', stem);
        if (!picked) return;
        stem = picked.replace(/\.md$/i, '');
      }
      await createFromContent(stem, imp.content, { splitImages: imp.fromDocx });
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
    await writeClipboard(doc.content);
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
