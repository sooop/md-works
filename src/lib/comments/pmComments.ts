// 코멘트 표시: ProseMirror 플러그인. 문서 내용은 건드리지 않고 데코레이션으로 범위만 표시한다.
// 범위는 편집 중 트랜잭션 매핑으로 따라 움직이고, 통째로 지워지면 from === to 로 접힌다(= 위치 잃음).
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Node as PMNode } from '@milkdown/kit/prose/model';

export interface Entry { id: string; from: number; to: number; resolved: boolean }
export interface SelInfo { from: number; to: number; x: number; y: number }

/** 읽기 모드 '코멘트 보기'·인쇄용 배지 번호(코멘트 id → 번호). null 이면 배지를 그리지 않는다 */
export type Badges = Record<string, number> | null;
interface PluginState { entries: Entry[]; active: string; badges: Badges; deco: DecorationSet }
export const key = new PluginKey<PluginState>('md-works-comments');

const live = (e: Entry) => e.from < e.to;

function badgeEl(n: number, resolved: boolean, block: boolean): HTMLElement {
  const el = document.createElement('span');
  el.className = 'cm-badge' + (resolved ? ' cm-resolved' : '') + (block ? ' cm-badge-block' : '');
  el.textContent = `C${n}`;
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('aria-label', `코멘트 ${n}`);
  return el;
}

function build(doc: PMNode, entries: Entry[], active: string, badges: Badges): DecorationSet {
  const decos: Decoration[] = [];
  for (const e of entries) {
    if (!live(e) || e.to > doc.content.size) continue;
    const mods = (e.resolved ? ' cm-resolved' : '') + (e.id === active ? ' cm-active' : '');
    const $from = doc.resolve(e.from);
    if ($from.parent.type.name === 'code_block') {
      // 코드 블록은 CodeMirror 가 따로 그리므로 블록 단위로 표시한다
      const start = $from.before();
      decos.push(Decoration.node(start, start + $from.parent.nodeSize, { class: `cm-comment-code${mods}`, 'data-cid': e.id }));
      // 코드 블록 안에는 위젯을 둘 수 없으니 블록 바로 뒤에 둔다
      const n = badges?.[e.id];
      if (n) decos.push(Decoration.widget(start + $from.parent.nodeSize, () => badgeEl(n, e.resolved, true), { side: -1, key: `cb-${e.id}-${n}-${e.resolved}` }));
    } else {
      decos.push(Decoration.inline(e.from, e.to, { class: `cm-comment${mods}`, 'data-cid': e.id }));
      const n = badges?.[e.id];
      if (n) decos.push(Decoration.widget(e.to, () => badgeEl(n, e.resolved, false), { side: 1, key: `cb-${e.id}-${n}-${e.resolved}` }));
    }
  }
  return DecorationSet.create(doc, decos);
}

export interface Handlers {
  /** 범위가 바뀔 때(편집으로 이동 / set 호출) */
  onRanges(entries: Entry[]): void;
  /** 텍스트 선택이 바뀔 때. 선택이 없으면 null */
  onSelect(sel: SelInfo | null): void;
  /** 코멘트가 달린 곳을 눌렀을 때 */
  onPick(ids: string[], x: number, y: number): void;
}

export interface CommentCtl {
  set(entries: Entry[]): void;
  /** 본문 배지(번호) 표시. null 이면 끈다. 문서 내용은 바뀌지 않는다(데코레이션만) */
  setBadges(badges: Badges): void;
  setActive(id: string): void;
  ranges(): Entry[];
  doc(): PMNode;
  selection(): { from: number; to: number } | null;
  reveal(id: string): void;
  destroy(): void;
}

export function makePlugin(h: Handlers): Plugin<PluginState> {
  return new Plugin<PluginState>({
    key,
    state: {
      init: () => ({ entries: [], active: '', badges: null, deco: DecorationSet.empty }),
      apply(tr, prev) {
        const meta = tr.getMeta(key) as { entries?: Entry[]; active?: string; badges?: Badges } | undefined;
        let { entries, active, badges } = prev;
        if (meta?.entries) entries = meta.entries;
        else if (tr.docChanged) {
          // 코멘트가 없거나 위치가 그대로면 같은 배열을 돌려줘 onRanges·반응형 상태 교체를 피한다
          if (entries.length) {
            let changed = false;
            const mapped = entries.map((e) => {
              if (!live(e)) return e;
              const from = tr.mapping.map(e.from, 1), to = tr.mapping.map(e.to, -1);
              if (from === e.from && to === e.to) return e;
              changed = true;
              return { ...e, from, to };
            });
            if (changed) entries = mapped;
          }
        }
        if (meta?.active !== undefined) active = meta.active;
        if (meta && 'badges' in meta) badges = meta.badges ?? null;
        // 코멘트가 없으면 문서가 바뀌어도 표시할 것이 없다
        if (entries === prev.entries && active === prev.active && badges === prev.badges && (!tr.docChanged || !entries.length)) return prev;
        return { entries, active, badges, deco: build(tr.doc, entries, active, badges) };
      },
    },
    props: { decorations: (s) => key.getState(s)?.deco },
    view() {
      let lastSel = '';
      return {
        update(view, prev) {
          const s = key.getState(view.state)!;
          if (s.entries !== key.getState(prev)!.entries) h.onRanges(s.entries);
          const { from, to, empty } = view.state.selection;
          const sig = empty ? '' : `${from}-${to}`;
          if (sig === lastSel && view.state.doc !== prev.doc) lastSel = ''; // 문서가 바뀌면 위치를 다시 계산
          if (sig === lastSel) return;
          lastSel = sig;
          if (empty) { h.onSelect(null); return; }
          try {
            const r = view.coordsAtPos(to);
            h.onSelect({ from, to, x: r.left, y: r.bottom });
          } catch { h.onSelect(null); }
        },
      };
    },
  });
}

// 에디터 뷰에 코멘트 플러그인을 붙이고 제어 객체를 돌려준다.
export function attachComments(view: EditorView, h: Handlers): CommentCtl {
  view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, makePlugin(h)] }));
  let alive = true;
  const dispatch = (meta: object) => { if (alive) view.dispatch(view.state.tr.setMeta(key, meta)); };
  const state = () => key.getState(view.state)!;

  // 코멘트가 달린 곳 클릭: 같은 지점의 겹친 코멘트를 모두 모아 알린다. 글자를 드래그해 선택한 경우는 무시한다.
  const onClick = (e: MouseEvent) => {
    // 에디터 상태의 선택은 클릭 직후엔 아직 갱신 전일 수 있어 DOM 선택으로 판단한다
    const ds = window.getSelection();
    if (ds && !ds.isCollapsed) return;
    const el = (e.target as Element | null)?.closest?.('[data-cid]') as HTMLElement | null;
    const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
    let ids = at ? state().entries.filter((r) => live(r) && r.from <= at.pos && at.pos <= r.to).map((r) => r.id) : [];
    if (!ids.length && el?.dataset.cid) ids = [el.dataset.cid];
    if (ids.length) h.onPick(ids, e.clientX, e.clientY);
  };
  view.dom.addEventListener('click', onClick);

  return {
    set: (entries) => dispatch({ entries }),
    setBadges: (badges) => dispatch({ badges }),
    setActive: (id) => dispatch({ active: id }),
    ranges: () => state().entries,
    doc: () => view.state.doc,
    selection() {
      const { from, to, empty } = view.state.selection;
      return empty ? null : { from, to };
    },
    reveal(id) {
      const e = state().entries.find((r) => r.id === id);
      if (!e || !live(e)) return;
      let el: Node | null = view.domAtPos(e.from).node;
      if (el?.nodeType === 3) el = el.parentElement;
      (el as HTMLElement | null)?.scrollIntoView?.({ block: 'center', behavior: 'instant' as ScrollBehavior });
    },
    destroy() {
      alive = false;
      view.dom.removeEventListener('click', onClick);
    },
  };
}
