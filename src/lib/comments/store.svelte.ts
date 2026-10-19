// 코멘트 상태와 동작 (두 모드 공통). 저장소는 모드가 useBackend 로 주입한다:
// 서버 모드는 노트 폴더의 `.comments/<경로>.json` 사이드카, 스탠드얼론은 IndexedDB.
import type { EditorView } from '@milkdown/kit/prose/view';
import { toast, errMsg } from '../store.svelte';
import { anchorOf, flatten, locate, MAX_QUOTE, type Comment } from './anchor';
import { attachComments, type CommentCtl, type Entry } from './pmComments';

export interface Backend {
  load(docKey: string): Promise<Comment[]>;
  save(docKey: string, comments: Comment[]): Promise<void>;
}
let backend: Backend | null = null;
export function useBackend(b: Backend) { backend = b; }

interface Pos { x: number; y: number }
type Range = { from: number; to: number };

// 화면 상태. ranges 는 에디터 플러그인이 가진 실제 위치의 사본이다(접힌 범위 = 위치 잃음).
export const cm = $state({
  key: '',
  loaded: false,
  items: [] as Comment[],
  ranges: {} as Record<string, Range>,
  active: '',
  sel: null as null | (Range & Pos), // 떠 있는 '코멘트' 버튼
  pick: null as null | ({ ids: string[] } & Pos), // 코멘트가 달린 곳을 눌러 연 팝오버
  draft: null as null | (Range & Pos & { text: string }), // 새 코멘트 입력
  hideResolved: false,
});

export const isLost = (id: string) => {
  const r = cm.ranges[id];
  return !r || r.from >= r.to;
};
export const openCount = () => cm.items.filter((c) => !c.resolved).length;

let cur: { ctl: CommentCtl; key: string } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;
let pending: Promise<void> = Promise.resolve(); // 마지막 저장 (같은 문서를 곧바로 다시 열 때 기다린다)

function persistNow() {
  clearTimeout(saveTimer);
  if (!dirty || !cur || !backend) return;
  dirty = false;
  const { key } = cur;
  const list = $state.snapshot(cm.items) as Comment[];
  pending = pending
    .then(() => backend!.save(key, list))
    .catch((e) => { toast(`코멘트를 저장하지 못했습니다: ${errMsg(e)}`, 'error'); });
}
function persist() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 400);
}

/** 대기 중인 저장을 즉시 끝낸다 (서버 모드에서 이름 변경·삭제 전에 호출) */
export async function flushComments() {
  persistNow();
  await pending;
}

const entryOf = (c: Comment, r: Range): Entry => ({ id: c.id, from: r.from, to: r.to, resolved: c.resolved });

// 현재 items + ranges 를 플러그인에 반영한다
function push() {
  if (!cur) return;
  cur.ctl.set(cm.items.filter((c) => cm.ranges[c.id]).map((c) => entryOf(c, cm.ranges[c.id])));
}

// 편집 뒤 정리: 살아 있는 범위는 앵커(원문·문맥)를 새 내용으로 갱신하고, 잃은 코멘트는 다시 찾아 본다
function refresh() {
  if (!cur) return;
  const flat = flatten(cur.ctl.doc());
  let moved = false;
  let changed = false;
  for (const c of cm.items) {
    const r = cm.ranges[c.id];
    if (r && r.from < r.to) {
      const a = anchorOf(flat, r.from, r.to);
      if (a && (a.quote !== c.quote || a.prefix !== c.prefix || a.suffix !== c.suffix)) { Object.assign(c, a); changed = true; }
    } else {
      const loc = locate(flat, c, r?.from ?? -1);
      if (loc) { cm.ranges[c.id] = loc; moved = true; }
    }
  }
  if (moved) push();
  if (changed) persist();
}

/**
 * 열린 문서의 에디터에 코멘트를 연결한다. 돌려주는 함수로 해제한다.
 * docKey: 스탠드얼론은 문서 id, 서버 모드는 루트 기준 경로.
 */
export function bindComments(view: EditorView, docKey: string): () => void {
  let alive = true;
  Object.assign(cm, { key: docKey, loaded: false, items: [], ranges: {}, active: '', sel: null, pick: null, draft: null });
  const ctl = attachComments(view, {
    onRanges(entries) {
      const next: Record<string, Range> = {};
      for (const e of entries) next[e.id] = { from: e.from, to: e.to };
      cm.ranges = next;
      if (cm.loaded) { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 500); }
    },
    onSelect(sel) { cm.sel = sel; },
    onPick(ids, x, y) { if (cm.loaded) { cm.draft = null; cm.pick = { ids, x, y }; } },
  });
  cur = { ctl, key: docKey };

  // 선택이 에디터 밖으로 나가면 떠 있는 버튼을 거둔다 (버튼·입력창 자체를 누르는 동안은 유지)
  const onSelChange = () => {
    const s = window.getSelection();
    if (s && !s.isCollapsed && view.dom.contains(s.anchorNode)) return;
    if (cm.sel && !document.activeElement?.closest?.('.cm-layer')) cm.sel = null;
  };
  document.addEventListener('selectionchange', onSelChange);

  pending
    .then(() => backend?.load(docKey) ?? [])
    .then((list) => {
      if (!alive) return;
      const flat = flatten(ctl.doc());
      const ranges: Record<string, Range> = {};
      for (const c of list) {
        const loc = locate(flat, c);
        if (loc) ranges[c.id] = loc;
      }
      cm.items = list;
      cm.ranges = ranges;
      cm.loaded = true;
      push();
    })
    .catch((e) => { if (alive) toast(`코멘트를 읽지 못했습니다: ${errMsg(e)}`, 'error'); });

  return () => {
    alive = false;
    clearTimeout(refreshTimer);
    persistNow();
    document.removeEventListener('selectionchange', onSelChange);
    ctl.destroy();
    if (cur?.ctl === ctl) cur = null;
    Object.assign(cm, { key: '', loaded: false, items: [], ranges: {}, active: '', sel: null, pick: null, draft: null });
  };
}

// ---- 새 코멘트 ----
/** 현재 선택 영역에 대한 코멘트 입력을 연다 */
export function startDraft() {
  if (!cur || !cm.loaded) return;
  const p = cur.ctl.selection();
  if (!p) { toast('코멘트를 달 본문을 먼저 선택하세요'); return; }
  cm.pick = null;
  cm.draft = { ...p, x: cm.sel?.x ?? 120, y: cm.sel?.y ?? 160, text: '' };
}

export function cancelDraft() { cm.draft = null; }

function anchorFor(r: Range) {
  const a = anchorOf(flatten(cur!.ctl.doc()), r.from, r.to);
  if (!a) { toast('선택한 영역에 글자가 없습니다', 'error'); return null; }
  if (a.quote.length > MAX_QUOTE) { toast(`선택 영역이 너무 깁니다 (${MAX_QUOTE.toLocaleString('ko-KR')}자 이하)`, 'error'); return null; }
  return a;
}

export function commitDraft() {
  const d = cm.draft;
  if (!d || !cur) return;
  const text = d.text.trim();
  if (!text) { cm.draft = null; return; }
  const a = anchorFor(d);
  if (!a) return;
  const now = Date.now();
  const c: Comment = { id: crypto.randomUUID(), ...a, text, created: now, updated: now, resolved: false };
  cm.items.push(c);
  cm.ranges[c.id] = { from: d.from, to: d.to };
  push();
  persist();
  cm.draft = null;
  cm.sel = null;
  select(c.id);
}

// ---- 기존 코멘트 ----
const find = (id: string) => cm.items.find((c) => c.id === id);

export function editComment(id: string, text: string) {
  const c = find(id);
  const t = text.trim();
  if (!c || !t || t === c.text) return;
  c.text = t;
  c.updated = Date.now();
  persist();
}

export function toggleResolved(id: string) {
  const c = find(id);
  if (!c) return;
  c.resolved = !c.resolved;
  c.updated = Date.now();
  push();
  persist();
}

export function removeComment(id: string) {
  const i = cm.items.findIndex((c) => c.id === id);
  if (i < 0) return;
  cm.items.splice(i, 1);
  delete cm.ranges[id];
  if (cm.pick) {
    cm.pick.ids = cm.pick.ids.filter((x) => x !== id);
    if (!cm.pick.ids.length) cm.pick = null;
  }
  if (cm.active === id) cm.active = '';
  push();
  persist();
}

let activeTimer: ReturnType<typeof setTimeout> | undefined;
/** 본문에서 해당 코멘트 위치로 이동하고 잠시 강조한다 */
export function select(id: string) {
  if (!cur) return;
  cm.active = id;
  cur.ctl.setActive(id);
  if (!isLost(id)) cur.ctl.reveal(id);
  clearTimeout(activeTimer);
  activeTimer = setTimeout(() => { cm.active = ''; cur?.ctl.setActive(''); }, 2500);
}

/** 위치를 잃은 코멘트를 본문에서 지금 선택한 영역에 다시 붙인다 */
export function reattach(id: string) {
  const c = find(id);
  if (!c || !cur) return;
  const sel = cur.ctl.selection();
  if (!sel) { toast('다시 붙일 본문을 먼저 선택하세요'); return; }
  const a = anchorFor(sel);
  if (!a) return;
  Object.assign(c, a);
  c.updated = Date.now();
  cm.ranges[id] = { from: sel.from, to: sel.to };
  push();
  persist();
  select(id);
}

export function closePick() { cm.pick = null; }
