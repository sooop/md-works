// 문서 내 검색: ProseMirror 플러그인. 문서 내용은 건드리지 않고 데코레이션으로 일치 항목만 표시한다.
// 일반 텍스트는 글자 단위로 하이라이트하고, 코드 블록은 CodeMirror 가 따로 그리므로 블록 단위로 표시한다.
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { Fragment, type Node as PMNode } from '@milkdown/kit/prose/model';
import { buildMatcher, type SearchOpts } from '../../../server/searchCore.js';
import { replacementFor } from './replaceText';

// m: 정규식 모드에서만 둔다(바꿀 말의 $1 같은 캡처 참조를 풀 때 쓴다)
export interface Hit { from: number; to: number; code: boolean; blockPos: number; m: RegExpMatchArray | null }
interface PluginState {
  query: string;
  opts: SearchOpts;
  error: string;
  hits: Hit[];
  current: number;
  deco: DecorationSet;
  notice: string;
}
// notice: 일치가 상한을 넘었거나 시간 예산을 다 써서 일부만 표시할 때의 안내(오류는 아님)
export interface FinderState { total: number; current: number; error: string; notice: string }

export const searchKey = new PluginKey<PluginState>('md-works-search');
const key = searchKey;
const MAX_HITS = 5000;
// 전체 탐색에 쓸 수 있는 시간. 정규식은 상한이 없어 메인 스레드를 오래 잡을 수 있으므로 텍스트 블록마다 확인한다
export const SEARCH_BUDGET_MS = 200;
export const PARTIAL_NOTICE = '일치가 너무 많거나 검색이 오래 걸려 일부만 표시합니다';

export function collect(
  doc: PMNode, query: string, opts: SearchOpts,
  budgetMs = SEARCH_BUDGET_MS, now: () => number = () => performance.now(),
): { hits: Hit[]; error: string; truncated: boolean } {
  if (!query) return { hits: [], error: '', truncated: false };
  const m = buildMatcher(query, opts);
  if (m.error !== undefined) return { hits: [], error: m.error, truncated: false };
  const hits: Hit[] = [];
  const deadline = now() + budgetMs;
  let truncated = false;
  doc.descendants((node, pos) => {
    if (truncated) return false;
    if (hits.length >= MAX_HITS) { truncated = true; return false; }
    if (hits.length && now() > deadline) { truncated = true; return false; }
    if (!node.isTextblock) return true;
    // 줄바꿈 같은 인라인 leaf 는 한 글자짜리 대체 문자로 바꿔 오프셋이 문서 위치와 1:1 이 되게 한다
    const text = node.textBetween(0, node.content.size, undefined, '￼');
    const code = node.type.name === 'code_block';
    for (const r of text.matchAll(m.re)) {
      if (!r[0]) continue;
      hits.push({ from: pos + 1 + r.index, to: pos + 1 + r.index + r[0].length, code, blockPos: pos, m: opts.regex ? r : null });
      if (hits.length >= MAX_HITS) { truncated = true; break; }
    }
    return false;
  });
  return { hits, error: '', truncated };
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

const EMPTY: PluginState = { query: '', opts: {}, error: '', hits: [], current: 0, deco: DecorationSet.empty, notice: '' };

export function makePlugin(notify: () => void): Plugin<PluginState> {
  return new Plugin<PluginState>({
    key,
    state: {
      init: () => EMPTY,
      apply(tr, prev) {
        const meta = tr.getMeta(key) as Partial<Pick<PluginState, 'query' | 'opts' | 'current'>> & { after?: number } | undefined;
        if (!meta && !tr.docChanged) return prev;
        const query = meta?.query ?? prev.query;
        const opts = meta?.opts ?? prev.opts;
        // 검색어가 없고 이전에도 일치가 없으면 다시 만들 것이 없다
        if (!query && !prev.query && !prev.hits.length && !prev.error) return prev;
        const { hits, error, truncated } = collect(tr.doc, query, opts);
        // after: 바꾼 뒤에는 바꾼 자리 다음의 첫 일치로 간다(없으면 처음으로)
        const nextIdx = meta?.after === undefined ? -1 : hits.findIndex((h) => h.from >= meta.after!);
        const wanted = meta?.after === undefined ? (meta?.current ?? prev.current) : Math.max(nextIdx, 0);
        const current = hits.length ? Math.min(Math.max(wanted, 0), hits.length - 1) : 0;
        return { query, opts, error, hits, current, deco: decorate(tr.doc, hits, current), notice: truncated ? PARTIAL_NOTICE : '' };
      },
    },
    props: { decorations: (s) => key.getState(s)?.deco },
    view: () => ({ update: () => notify() }),
  });
}

// 일치 하나를 바꿀 내용. 대체 텍스트는 일치 시작 위치의 마크(굵게 등)를 물려받는다. 빈 문자열이면 null(삭제)
function insertion(state: EditorState, h: Hit, template: string): Fragment | null {
  const text = replacementFor(template, h.m as RegExpMatchArray, !!h.m);
  if (!text) return null;
  const marks = state.doc.resolve(h.from).nodeAfter?.marks ?? [];
  const { schema } = state;
  const br = schema.nodes.hardbreak;
  if (!h.code && br && text.includes('\n')) { // 문단 안의 줄바꿈은 글자가 아니라 하드 브레이크 노드로
    const nodes = text.split(/\r?\n/).flatMap((t, i) => [...(i ? [br.create()] : []), ...(t ? [schema.text(t, marks)] : [])]);
    return Fragment.from(nodes);
  }
  return Fragment.from(schema.text(text, marks));
}

function applyHit(tr: Transaction, state: EditorState, h: Hit, template: string) {
  const frag = insertion(state, h, template);
  if (frag) tr.replaceWith(h.from, h.to, frag); else tr.delete(h.from, h.to);
}

// 모두 바꾸기: 트랜잭션 하나(실행 취소 한 번)로 바꾼다. 뒤에서 앞으로 적용하므로 앞쪽 일치의 위치가 밀리지 않는다.
// partial: 일치가 상한·시간 예산에 걸려 보이는 일치만 바꿨다
export function replaceAllTr(state: EditorState, template: string): { tr: Transaction; count: number; partial: boolean } | null {
  const s = key.getState(state);
  if (!s || !s.hits.length) return null;
  const tr = state.tr;
  for (let i = s.hits.length - 1; i >= 0; i--) applyHit(tr, state, s.hits[i], template);
  return { tr, count: s.hits.length, partial: !!s.notice };
}

// 현재 일치 하나를 바꾸고 다음 일치로 간다
export function replaceCurrentTr(state: EditorState, template: string): Transaction | null {
  const s = key.getState(state);
  const h = s?.hits[s.current];
  if (!s || !h) return null;
  const tr = state.tr;
  applyHit(tr, state, h, template);
  return tr.setMeta(key, { after: tr.mapping.map(h.to) });
}

export interface Finder {
  /** 읽기 모드거나 일치가 없으면 false */
  replaceCurrent(template: string): boolean;
  /** 읽기 모드거나 일치가 없으면 null */
  replaceAll(template: string): { count: number; partial: boolean } | null;
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
    return { total: s.hits.length, current: s.hits.length ? s.current : -1, error: s.error, notice: s.notice };
  };
  let last = '';
  const notify = () => {
    const s = read();
    const sig = `${s.total}|${s.current}|${s.error}|${s.notice}`;
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
    replaceCurrent(template) {
      if (!alive || !view.editable) return false;
      const tr = replaceCurrentTr(view.state, template);
      if (!tr) return false;
      view.dispatch(tr);
      reveal();
      return true;
    },
    replaceAll(template) {
      if (!alive || !view.editable) return null;
      const r = replaceAllTr(view.state, template);
      if (!r) return null;
      view.dispatch(r.tr);
      return { count: r.count, partial: r.partial };
    },
    next() { const s = key.getState(view.state); if (s?.hits.length) move((s.current + 1) % s.hits.length); },
    prev() { const s = key.getState(view.state); if (s?.hits.length) move((s.current - 1 + s.hits.length) % s.hits.length); },
    goto(index) { if (key.getState(view.state)?.hits.length) move(index); },
    clear() { dispatch({ query: '', current: 0 }); },
    destroy() { alive = false; },
  };
}
