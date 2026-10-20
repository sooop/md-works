// 글감함 UI 상태와 동작. 저장은 works/snippets.ts → worksStore() 를 거친다.
import { doc, toast, errMsg, askConfirm } from '../store.svelte';
import {
  createSnippet, listSnippets, listTrashedSnippets, updateSnippet, attachSnippet, detachSnippet, trashSnippet, restoreSnippet, purgeSnippet,
  reorderSnippets, setSnippetColors, trashSnippets,
} from '../works/snippets';
import { assignOrders, moveBlock, shiftBlock } from '../works/snippetOrder';
import { addRange, inListOrder, pruneSelection, toggleId } from './selection';
import type { Snippet, SnippetColor, SnippetSource } from '../works/types';
import { hasWorksStore } from '../works/store';
import { openRight } from '../rightbar/state.svelte';
import { filterSnippets, findByPhrase, type SnippetView } from './filter';

export const sn = $state({
  active: [] as Snippet[],
  trashed: [] as Snippet[],
  loaded: false,
  view: 'doc' as SnippetView,
  color: '' as SnippetColor | '',
  query: '',
  phrase: '', // '문구로 글감 찾기' 입력
  openId: '', // 펼친 카드 (비슷한 글감을 보여 준다)
  focusInput: 0, // 바뀔 때마다 빠른 입력창에 포커스
  focusPhrase: 0, // 바뀔 때마다 문구 입력창에 포커스
  // ---- 다중 선택·드래그 (UI 상태, 저장하지 않는다) ----
  selected: [] as string[], // 선택된 글감 id
  selectMode: false, // 체크박스 선택 모드
  anchor: '', // 마지막으로 클릭한 카드 (Shift 범위의 기준)
  dragIds: [] as string[], // 끌고 있는 글감들(없으면 드래그 중 아님)
  dropIndex: -1, // 놓을 위치(보이는 목록 기준 삽입 인덱스, -1 = 없음)
});

export async function reload() {
  if (!hasWorksStore()) return; // 시작 직후엔 아직 저장소가 없다 — 글감 탭을 열 때 다시 읽는다
  try {
    [sn.active, sn.trashed] = await Promise.all([listSnippets(), listTrashedSnippets()]);
    sn.loaded = true;
  } catch (e) {
    toast(`글감을 읽지 못했습니다: ${errMsg(e)}`, 'error');
  }
}

/** 현재 화면에 보일 글감: 문구 검색이 있으면 관련도 순, 없으면 보기·색·검색어 필터 */
export const visible = (): Snippet[] =>
  sn.phrase.trim() ? findByPhrase(sn.phrase, sn.active) : filterSnippets(sn.active, sn.trashed, { view: sn.view, docKey: doc.path, color: sn.color, query: sn.query });

/** 정렬 값을 바꿀 수 있는 상태인가: '이 글에 붙은 것' 보기이고 문구 찾기·검색어·색 필터가 없을 때 */
export const canReorder = (): boolean => sn.view === 'doc' && !!doc.path && !sn.phrase.trim() && !sn.query.trim() && !sn.color;

/** 순서를 바꿀 수 없을 때 보여 줄 안내(바꿀 수 있으면 빈 문자열) */
export function reorderHint(): string {
  if (canReorder()) return '';
  if (sn.view === 'doc' && doc.path && !sn.phrase.trim()) return '필터를 풀면 순서를 바꿀 수 있습니다';
  return "'이 글에 붙은 것' 보기에서만 순서를 바꿀 수 있습니다";
}

async function run<T>(fn: () => Promise<T>, fail: string): Promise<T | undefined> {
  try {
    const r = await fn();
    await reload();
    return r;
  } catch (e) {
    toast(`${fail}: ${errMsg(e)}`, 'error');
    return undefined;
  }
}

export const addSnippet = (body: string, source?: SnippetSource, attach = true) =>
  run(() => createSnippet({ body, ...(source ? { source } : {}), ...(attach && doc.path ? { attachTo: [doc.path] } : {}) }), '글감을 추가하지 못했습니다');
export const editSnippet = (id: string, patch: Partial<Pick<Snippet, 'body' | 'source' | 'color'>>) => run(() => updateSnippet(id, patch), '글감을 고치지 못했습니다');
export const attachHere = (id: string) => doc.path ? run(() => attachSnippet(id, doc.path), '붙이지 못했습니다') : Promise.resolve(undefined);
export const detachHere = (id: string) => doc.path ? run(() => detachSnippet(id, doc.path), '떼지 못했습니다') : Promise.resolve(undefined);
export const discardSnippet = (id: string) => run(() => trashSnippet(id), '휴지통으로 옮기지 못했습니다');
export const recoverSnippet = (id: string) => run(() => restoreSnippet(id), '복구하지 못했습니다');
export async function deleteForever(id: string) {
  if (!(await askConfirm('이 글감을 완전히 삭제할까요? 되돌릴 수 없습니다.', '삭제'))) return;
  await run(() => purgeSnippet(id), '삭제하지 못했습니다');
}

// ---- 다중 선택 ----
const visibleIds = () => visible().map((s) => s.id);

/** Ctrl/Cmd+클릭(또는 선택 모드의 클릭·체크박스): 하나를 켜고 끈다 */
export function toggleSelect(id: string) {
  sn.selected = toggleId(sn.selected, id);
  sn.anchor = id;
}
/** Shift+클릭: 마지막으로 클릭한 카드부터 이 카드까지 연속 선택(현재 보이는 목록 기준) */
export function selectRangeTo(id: string) {
  sn.selected = addRange(sn.selected, visibleIds(), sn.anchor, id);
  sn.anchor = id;
}
export const clearSelection = () => { sn.selected = []; };
export function setSelectMode(on: boolean) { sn.selectMode = on; }
/** 보이는 목록에서 사라진 카드를 선택에서 뺀다 */
export function pruneSelected() {
  const next = pruneSelection(sn.selected, visibleIds());
  if (next !== sn.selected) sn.selected = next;
  if (sn.anchor && !visibleIds().includes(sn.anchor)) sn.anchor = '';
}

// ---- 일괄 작업 (한 번의 putMany) ----
export async function bulkColor(color: SnippetColor) {
  const ids = [...sn.selected];
  if (ids.length) await run(() => setSnippetColors(ids, color), '색을 바꾸지 못했습니다');
}
export async function bulkTrash() {
  const ids = [...sn.selected];
  if (!ids.length) return;
  const n = await run(() => trashSnippets(ids), '휴지통으로 옮기지 못했습니다');
  if (n === undefined) return;
  sn.selected = [];
  toast(`${n}개를 휴지통으로 보냈습니다`);
}

// ---- 순서 바꾸기 ----
/** 끌기를 시작할 때 함께 움직일 카드: 선택된 카드를 끌면 선택 전체(목록 순서), 아니면 그 카드 한 장 */
export const dragGroup = (id: string): string[] =>
  sn.selected.includes(id) ? inListOrder(sn.selected, visibleIds()) : [id];

async function applyOrder(oldIds: string[], newIds: string[], moving: string[]) {
  const byId = new Map(sn.active.map((s) => [s.id, s]));
  const changes = assignOrders(oldIds, newIds, moving, (id) => byId.get(id)?.orders?.[doc.path]);
  if (changes.length) await run(() => reorderSnippets(doc.path, changes), '순서를 바꾸지 못했습니다');
}
/** 카드를 끌어 놓았을 때: moving 을 targetIndex(보이는 목록 기준 삽입 위치)로 옮긴다 */
export async function moveTo(moving: string[], targetIndex: number) {
  if (!canReorder() || !moving.length) return;
  const ids = visibleIds();
  await applyOrder(ids, moveBlock(ids, moving, targetIndex), moving);
}
/** 키보드·선택 바 버튼: 대상(선택이 있고 id 가 선택에 속하면 선택 전체, 아니면 id 한 장)을 한 칸 위/아래로 */
export async function moveStep(dir: -1 | 1, id?: string) {
  if (!canReorder()) return;
  const moving = id && !sn.selected.includes(id) ? [id] : [...sn.selected];
  if (!moving.length) return;
  const ids = visibleIds();
  await applyOrder(ids, shiftBlock(ids, moving, dir), moving);
}

// ---- 에디터 선택 텍스트 (코멘트·검색과 같이 DOM 선택을 쓴다: 사이드바를 눌러도 마지막 선택을 기억) ----
const last = { text: '', para: '' };
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th';

function onSelChange() {
  const s = window.getSelection();
  const n = s?.anchorNode;
  const el = n instanceof Element ? n : n?.parentElement;
  const pm = el?.closest('.editor-wrap .ProseMirror');
  if (!s || !el || !pm) return;
  last.text = s.isCollapsed ? '' : s.toString().trim();
  last.para = el.closest(BLOCK)?.textContent?.trim() ?? '';
}
/** 선택 변화 추적을 시작한다. 돌려주는 함수로 해제 */
export function trackEditorSelection(): () => void {
  document.addEventListener('selectionchange', onSelChange);
  return () => document.removeEventListener('selectionchange', onSelChange);
}
/** 선택한 텍스트, 없으면 커서가 놓인 문단 */
export const editorText = (): { text: string; selected: boolean } =>
  last.text ? { text: last.text, selected: true } : { text: last.para, selected: false };

/** 본문 선택 → 새 글감 (원전 없음, 현재 글에 붙임) */
export async function sendSelection() {
  if (!doc.path) { toast('문서를 먼저 여세요'); return; }
  const { text, selected } = editorText();
  if (!selected) { toast('글감으로 보낼 본문을 먼저 선택하세요'); return; }
  if (await addSnippet(text)) toast('글감으로 보냈습니다');
}

/** 에디터 선택(없으면 문단)을 문구 칸에 채워 관련 글감을 보여 준다 */
export function findByEditorText() {
  openRight('snippets'); // 오른쪽 사이드바의 글감 탭을 연다
  const { text } = editorText();
  if (text) sn.phrase = text.slice(0, 500);
  sn.focusPhrase++;
}
