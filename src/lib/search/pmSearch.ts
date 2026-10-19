// 문서 내 검색: ProseMirror 플러그인. 문서 내용은 건드리지 않고 데코레이션으로 일치 항목만 표시한다.
// 일반 텍스트는 글자 단위로 하이라이트하고, 코드 블록은 CodeMirror 가 따로 그리므로 블록 단위로 표시한다.
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { buildMatcher, type SearchOpts } from '../../../server/searchCore.js';

interface Hit { from: number; to: number; code: boolean; blockPos: number }
interface PluginState {
  query: string;
  opts: SearchOpts;
  error: string;
  hits: Hit[];
  current: number;
  deco: DecorationSet;
}
export interface FinderState { total: number; current: number; error: string }

const key = new PluginKey<PluginState>('md-works-search');
const MAX_HITS = 5000;

function collect(doc: PMNode, query: string, opts: SearchOpts): { hits: Hit[]; error: string } {
  if (!query) return { hits: [], error: '' };
  const m = buildMatcher(query, opts);
  if (m.error !== undefined) return { hits: [], error: m.error };
  const hits: Hit[] = [];
  doc.descendants((node, pos) => {
    if (hits.length >= MAX_HITS) return false;
    if (!node.isTextblock) return true;
    // 줄바꿈 같은 인라인 leaf 는 한 글자짜리 대체 문자로 바꿔 오프셋이 문서 위치와 1:1 이 되게 한다
    const text = node.textBetween(0, node.content.size, undefined, '￼');
    const code = node.type.name === 'code_block';
    for (const r of text.matchAll(m.re)) {
      if (!r[0]) continue;
      hits.push({ from: pos + 1 + r.index, to: pos + 1 + r.index + r[0].length, code, blockPos: pos });
      if (hits.length >= MAX_HITS) break;
    }
    return false;
  });
  return { hits, error: '' };
}

function decorate(doc: PMNode, hits: Hit[], current: number): DecorationSet {
  const decos: Decoration[] = [];
  const codeBlocks = new Map<number, { size: number; cur: boolean }>();
  hits.forEach((h, i) => {
    if (h.code) {
      const prev = codeBlocks.get(h.blockPos);
      const size = doc.nodeAt(h.blockPos)?.nodeSize ?? 0;
      codeBlocks.set(h.blockPos, { size, cur: (prev?.cur ?? false) || i === current });
    } else {
      decos.push(Decoration.inline(h.from, h.to, { class: i === current ? 'search-hit search-current' : 'search-hit' }));
    }
  });
  for (const [pos, b] of codeBlocks) {
    if (b.size) decos.push(Decoration.node(pos, pos + b.size, { class: b.cur ? 'search-code-hit search-code-current' : 'search-code-hit' }));
  }
  return DecorationSet.create(doc, decos);
}

const EMPTY: PluginState = { query: '', opts: {}, error: '', hits: [], current: 0, deco: DecorationSet.empty };

function makePlugin(notify: () => void): Plugin<PluginState> {
  return new Plugin<PluginState>({
    key,
    state: {
      init: () => EMPTY,
      apply(tr, prev) {
        const meta = tr.getMeta(key) as Partial<Pick<PluginState, 'query' | 'opts' | 'current'>> | undefined;
        if (!meta && !tr.docChanged) return prev;
        const query = meta?.query ?? prev.query;
        const opts = meta?.opts ?? prev.opts;
        const { hits, error } = collect(tr.doc, query, opts);
        const wanted = meta?.current ?? prev.current;
        const current = hits.length ? Math.min(Math.max(wanted, 0), hits.length - 1) : 0;
        return { query, opts, error, hits, current, deco: decorate(tr.doc, hits, current) };
      },
    },
    props: { decorations: (s) => key.getState(s)?.deco },
    view: () => ({ update: () => notify() }),
  });
}

export interface Finder {
  setQuery(query: string, opts: SearchOpts): void;
  next(): void;
  prev(): void;
  goto(index: number): void;
  clear(): void;
  destroy(): void;
}

// 에디터 뷰에 검색 플러그인을 붙이고 제어 객체를 돌려준다. 상태가 바뀔 때마다 onState 로 알린다.
export function attachFinder(view: EditorView, onState: (s: FinderState) => void): Finder {
  const read = (): FinderState => {
    const s = key.getState(view.state) ?? EMPTY;
    return { total: s.hits.length, current: s.hits.length ? s.current : -1, error: s.error };
  };
  let last = '';
  const notify = () => {
    const s = read();
    const sig = `${s.total}|${s.current}|${s.error}`;
    if (sig === last) return;
    last = sig;
    onState(s);
  };
  let alive = true;
  view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, makePlugin(notify)] }));

  const dispatch = (meta: object) => { if (alive) view.dispatch(view.state.tr.setMeta(key, meta)); };

  function reveal() {
    const s = key.getState(view.state);
    const h = s?.hits[s.current];
    if (!h) return;
    let el: Node | null;
    if (h.code) el = view.nodeDOM(h.blockPos);
    else el = view.domAtPos(h.from).node;
    if (el && el.nodeType === 3) el = el.parentElement;
    (el as HTMLElement | null)?.scrollIntoView?.({ block: 'center', behavior: 'instant' as ScrollBehavior });
  }
  const move = (to: number) => { dispatch({ current: to }); reveal(); };

  return {
    setQuery(query, opts) {
      const s = key.getState(view.state) ?? EMPTY;
      if (s.query === query && s.opts.caseSensitive === opts.caseSensitive && s.opts.regex === opts.regex) return;
      dispatch({ query, opts, current: 0 });
      if (query) reveal();
    },
    next() { const s = key.getState(view.state); if (s?.hits.length) move((s.current + 1) % s.hits.length); },
    prev() { const s = key.getState(view.state); if (s?.hits.length) move((s.current - 1 + s.hits.length) % s.hits.length); },
    goto(index) { if (key.getState(view.state)?.hits.length) move(index); },
    clear() { dispatch({ query: '', current: 0 }); },
    destroy() { alive = false; },
  };
}
