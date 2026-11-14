// 자동 완성: 본문에서 `[[` 를 치면 글 이름 후보 팝업이 뜬다. 이어 치는 글자로 거르고(부분 문자열 + 한글 초성),
// ↑/↓ 이동, Enter/Tab 선택(`[[이름]]` 을 완성하고 커서를 닫는 괄호 뒤로), Esc 닫기.
// 한글 조합 중(view.composing)에는 키를 가로채지 않는다. 코드 블록·인라인 코드 안에서는 뜨지 않는다.
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { matchName } from '../search/nameMatch';
import { docName, docPath, norm, type DocRef } from './parse';

export interface Candidate {
  /** `폴더/이름` */
  path: string;
  name: string;
  /** 폴더(없으면 빈 문자열) */
  folder: string;
  /** 본문에 넣을 글자: 이름이 유일하면 이름, 같은 이름이 여럿이면 경로 */
  insert: string;
}

const LIMIT = 12;

/** 입력한 글자(query)에 맞는 후보. 이름 앞부분 일치 → 이름 일부 일치(초성 포함) → 경로 일치 순, 같은 순위는 이름순 */
export function suggestCandidates(query: string, docs: DocRef[], opts: { current?: string; limit?: number } = {}): Candidate[] {
  const cur = opts.current ? norm(docPath(opts.current)) : '';
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const d of docs) {
    const p = docPath(d.path);
    const k = norm(p);
    if (!p || k === cur || seen.has(k)) continue;
    seen.add(k);
    paths.push(p);
  }
  const names = new Map<string, number>();
  for (const p of paths) { const k = norm(docName(p)); names.set(k, (names.get(k) ?? 0) + 1); }
  const q = norm(query);
  const scored: { c: Candidate; rank: number }[] = [];
  for (const path of paths) {
    const name = docName(path);
    let rank: number;
    if (!q) rank = 0;
    else if (norm(name).startsWith(q)) rank = 0;
    else if (norm(name).includes(q)) rank = 1;
    else if (matchName(name, q)) rank = 2;
    else if (matchName(path, q)) rank = 3;
    else continue;
    scored.push({ rank, c: { path, name, folder: path.slice(0, path.length - name.length).replace(/\/$/, ''), insert: (names.get(norm(name)) ?? 0) > 1 ? path : name } });
  }
  scored.sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name, 'ko') || a.c.path.localeCompare(b.c.path, 'ko'));
  return scored.slice(0, opts.limit ?? LIMIT).map((s) => s.c);
}

// ---- 트리거 찾기 ----
export interface Trigger {
  /** `[[` 의 시작 위치 */
  from: number;
  /** 바꿀 범위의 끝: 커서(바로 뒤에 `]]` 가 있으면 그것까지) */
  to: number;
  query: string;
}

const OBJ = '￼';
const isCode = (m: { type: { name: string; spec: { code?: boolean } } }) => m.type.name === 'inlineCode' || !!m.type.spec.code;

/** 커서 앞의 같은 줄에 열린 `[[글…` 이 있으면 그 범위. 코드 블록·인라인 코드·선택 영역이 있을 때는 null */
export function findTrigger(state: EditorState): Trigger | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  const parent = $from.parent;
  if (!parent.isTextblock || parent.type.name === 'code_block' || parent.type.spec.code) return null;
  if ($from.marks().some(isCode)) return null;
  const before = parent.textBetween(0, $from.parentOffset, undefined, OBJ);
  const m = /\[\[([^[\]\n|￼]*)$/.exec(before);
  if (!m || before[m.index - 1] === '!') return null;
  const after = parent.textBetween($from.parentOffset, parent.content.size, undefined, OBJ);
  return { from: $from.start() + m.index, to: $from.pos + (after.startsWith(']]') ? 2 : 0), query: m[1] };
}

// ---- 플러그인 ----
interface PS { trigger: Trigger | null; items: Candidate[]; index: number; dismissed: number }
export const key = new PluginKey<PS>('md-works-wikilink-suggest');

export interface SuggestView { items: Candidate[]; index: number; x: number; y: number }
export interface SuggestHandlers {
  docs(): DocRef[];
  /** 지금 열린 글(`폴더/이름`, 후보에서 뺀다) */
  current(): string;
  /** 팝업을 보여 줄 내용이 바뀔 때(없으면 null) */
  onChange(v: SuggestView | null): void;
}

const NONE: PS = { trigger: null, items: [], index: 0, dismissed: -1 };

export function createSuggestPlugin(h: SuggestHandlers): Plugin<PS> {
  const compute = (state: EditorState, prev: PS, meta: { index?: number; dismiss?: boolean } | undefined): PS => {
    const trigger = findTrigger(state);
    if (!trigger) return prev === NONE ? prev : NONE;
    let dismissed = prev.dismissed;
    if (meta?.dismiss) dismissed = trigger.from;
    else if (dismissed !== trigger.from) dismissed = -1; // 다른 `[[` 에서는 다시 뜬다
    if (dismissed === trigger.from) return { trigger, items: [], index: 0, dismissed };
    const items = suggestCandidates(trigger.query, h.docs(), { current: h.current() });
    const same = prev.trigger?.query === trigger.query && prev.trigger.from === trigger.from;
    const index = meta?.index !== undefined ? ((meta.index % items.length) + items.length) % items.length || 0 : same ? Math.min(prev.index, Math.max(0, items.length - 1)) : 0;
    return { trigger, items, index, dismissed };
  };

  let focused = true;
  const publish = (view: EditorView) => {
    const s = key.getState(view.state);
    if (!s || !s.trigger || !s.items.length || !view.editable || !focused) { h.onChange(null); return; }
    try {
      const r = view.coordsAtPos(s.trigger.to);
      h.onChange({ items: s.items, index: s.index, x: r.left, y: r.bottom });
    } catch { h.onChange(null); }
  };

  return new Plugin<PS>({
    key,
    state: {
      init: () => NONE,
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(key) as { index?: number; dismiss?: boolean } | undefined;
        if (!tr.docChanged && !tr.selectionSet && !meta) return prev;
        return compute(state, prev, meta);
      },
    },
    props: {
      handleKeyDown(view, e) {
        const s = key.getState(view.state);
        if (!s?.items.length || !view.editable) return false;
        // 한글 조합 중의 Enter·방향키는 입력기의 것이다
        if (view.composing || e.isComposing || e.keyCode === 229) return false;
        if (e.ctrlKey || e.metaKey || e.altKey) return false;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          view.dispatch(view.state.tr.setMeta(key, { index: s.index + (e.key === 'ArrowDown' ? 1 : -1) }));
          return true;
        }
        if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
          applyCandidate(view, s.items[s.index]);
          return true;
        }
        if (e.key === 'Escape') {
          view.dispatch(view.state.tr.setMeta(key, { dismiss: true }));
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        blur(view) { focused = false; publish(view); return false; },
        focus(view) { focused = true; publish(view); return false; },
      },
    },
    view: (view) => {
      focused = view.hasFocus();
      return { update: (v) => publish(v), destroy: () => h.onChange(null) };
    },
  });
}

/** 후보를 `[[이름]]` 으로 완성하고 커서를 닫는 괄호 뒤에 둔다 */
export function applyCandidate(view: EditorView, c: Candidate | undefined): boolean {
  const s = key.getState(view.state);
  if (!s?.trigger || !c) return false;
  const text = `[[${c.insert}]]`;
  const tr = view.state.tr.insertText(text, s.trigger.from, s.trigger.to);
  tr.setSelection(TextSelection.create(tr.doc, s.trigger.from + text.length));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

export interface SuggestCtl { pick(index: number): void; destroy(): void }

/** 에디터 뷰에 자동 완성 플러그인을 붙인다. 목록·리스트 항목의 Enter/Tab 보다 먼저 키를 받도록 앞에 넣는다 */
export function attachWikiSuggest(view: EditorView, h: SuggestHandlers): SuggestCtl {
  view.updateState(view.state.reconfigure({ plugins: [createSuggestPlugin(h), ...view.state.plugins] }));
  return {
    pick(i) { const s = key.getState(view.state); if (s) applyCandidate(view, s.items[i]); },
    destroy() { h.onChange(null); },
  };
}
