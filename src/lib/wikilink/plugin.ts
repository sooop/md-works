// 에디터 표시: `[[글 이름]]` 범위를 링크처럼 꾸민다. 문서 모델은 일반 글자 그대로 두고 데코레이션만 얹는다(pmComments 와 같은 방식).
// 데코레이션은 문서가 바뀔 때만 다시 만들고(플러그인 state 에 캐시), 글 목록이 바뀌면 같은 범위를 다시 해석한다.
// 편집 모드에서는 Ctrl(Mac Cmd)+클릭, 읽기 모드에서는 그냥 클릭으로 대상 글을 연다.
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { MASK, createResolver, scanLinks, type DocRef, type Resolved, type Resolver } from './parse';

export interface Span { from: number; to: number; target: string }
interface PluginState { spans: Span[]; docs: DocRef[]; resolver: Resolver; set: DecorationSet }
export const key = new PluginKey<PluginState>('md-works-wikilink');

export interface WikiHandlers {
  /** 링크를 열려는 동작(해석 결과와 함께) */
  onOpen(target: string, res: Resolved): void;
}

const OBJ = '￼';
const isCode = (m: { type: { name: string; spec: { code?: boolean } } }) => m.type.name === 'inlineCode' || !!m.type.spec.code;

/** 문서의 링크 범위들. 코드 블록·인라인 코드 안은 건너뛴다 */
export function collectSpans(doc: PMNode): Span[] {
  const out: Span[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') return false;
    if (!node.isTextblock) return true;
    if (!node.textContent.includes('[[')) return false;
    // 글자만 모으되 코드 마크와 글자가 아닌 인라인 노드(이미지·각주 등)는 링크가 못 되게 가린다. 위치(UTF-16 단위)는 그대로
    let s = '';
    node.forEach((child) => {
      if (child.isText) s += child.marks.some(isCode) ? MASK.repeat(child.nodeSize) : child.text!;
      else s += OBJ.repeat(child.nodeSize);
    });
    for (const l of scanLinks(s, pos + 1)) out.push({ from: l.from, to: l.to, target: l.target });
    return false;
  });
  return out;
}

const TITLES: Record<Resolved['kind'], (r: Resolved) => string> = {
  ok: (r) => (r.kind === 'ok' ? r.path : ''),
  ambiguous: () => '같은 이름의 글이 여러 개 있습니다',
  missing: () => '없는 글',
};

function decorate(doc: PMNode, spans: Span[], resolver: Resolver): DecorationSet {
  if (!spans.length) return DecorationSet.empty;
  return DecorationSet.create(doc, spans.filter((s) => s.to <= doc.content.size).map((s) => {
    const r = resolver.resolve(s.target);
    return Decoration.inline(s.from, s.to, { class: `wl wl-${r.kind}`, 'data-wl': s.target, title: TITLES[r.kind](r) });
  }));
}

export function createWikiLinkPlugin(h: WikiHandlers, docs: DocRef[] = []): Plugin<PluginState> {
  const build = (doc: PMNode, spans: Span[], d: DocRef[], resolver: Resolver): PluginState => ({ spans, docs: d, resolver, set: decorate(doc, spans, resolver) });
  return new Plugin<PluginState>({
    key,
    state: {
      init: (_c, state) => build(state.doc, collectSpans(state.doc), docs, createResolver(docs)),
      apply(tr, prev) {
        const meta = tr.getMeta(key) as { docs?: DocRef[] } | undefined;
        if (meta?.docs) {
          // 글 목록의 경로가 그대로면(다른 이유로 목록 객체만 다시 만들어진 경우) 다시 해석하지 않는다
          if (!tr.docChanged && meta.docs.length === prev.docs.length && meta.docs.every((d, i) => d.path === prev.docs[i].path)) return prev;
          const resolver = createResolver(meta.docs);
          return build(tr.doc, tr.docChanged ? collectSpans(tr.doc) : prev.spans, meta.docs, resolver);
        }
        if (!tr.docChanged) return prev;
        const spans = collectSpans(tr.doc);
        if (!spans.length && !prev.spans.length) return prev; // 링크가 없는 글을 편집하는 동안은 같은 상태(같은 DecorationSet)
        return build(tr.doc, spans, prev.docs, prev.resolver);
      },
    },
    props: {
      decorations: (state) => key.getState(state)?.set,
      handleDOMEvents: {
        click(view, e) {
          if (e.button !== 0) return false;
          const el = (e.target as Element | null)?.closest?.('[data-wl]') as HTMLElement | null;
          if (!el) return false;
          if (view.editable) {
            if (!(e.ctrlKey || e.metaKey)) return false; // 편집 중에는 Ctrl+클릭만(그냥 클릭은 커서를 놓는다)
          } else {
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed) return false; // 글자를 드래그해 선택한 경우는 열지 않는다
          }
          const target = el.dataset.wl ?? '';
          const st = key.getState(view.state);
          if (!target || !st) return false;
          e.preventDefault();
          h.onOpen(target, st.resolver.resolve(target));
          return true;
        },
      },
    },
  });
}

export interface WikiCtl { setDocs(docs: DocRef[]): void; destroy(): void }

/** 에디터 뷰에 링크 표시 플러그인을 붙이고 제어 객체를 돌려준다 */
export function attachWikiLinks(view: EditorView, h: WikiHandlers, docs: DocRef[] = []): WikiCtl {
  view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, createWikiLinkPlugin(h, docs)] }));
  let alive = true;
  return {
    setDocs(d) { if (alive) view.dispatch(view.state.tr.setMeta(key, { docs: d }).setMeta('addToHistory', false)); },
    destroy() { alive = false; },
  };
}
