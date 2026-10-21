// 각주: 본문의 [^라벨] 과 정의 [^라벨]: 내용 을 다룬다(파싱·저장은 Milkdown GFM 이 이미 한다).
// - 정의 블록은 문서 맨 끝으로 모으고 본문에서 처음 참조된 순서로 정렬한다
// - 화면의 번호는 라벨이 아니라 등장 순서(CSS counter, app.css 의 .fn 규칙)
// - 본문 각주 번호 ↔ 정의 번호를 누르면 서로 이동한다
// - `[^라벨]` 을 입력하면 각주가 되고 정의가 없으면 끝에 만든다. 명령 팔레트의 '각주 삽입'은 새 번호로 만든다
import type { Editor } from '@milkdown/kit/core';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Fragment } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { $prose, $inputRule } from '@milkdown/kit/utils';

const REF = 'footnote_reference';
const DEF = 'footnote_definition';

const isBlankPara = (n: PMNode) => n.type.name === 'paragraph' && n.content.size === 0;

/** 본문에서 처음 참조된 순서의 라벨 목록 */
export function refLabels(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.type.name === REF && !out.includes(n.attrs.label)) out.push(n.attrs.label);
    return true;
  });
  return out;
}

/** 정의 블록(최상위)을 끝으로 모으고 참조 순서로 정렬하는 트랜잭션. 이미 그렇게 되어 있으면 null */
export function normalizeFootnotes(state: EditorState): Transaction | null {
  const { doc } = state;
  const kids: { node: PMNode; pos: number }[] = [];
  doc.forEach((node, pos) => kids.push({ node, pos }));
  const defs = kids.filter((k) => k.node.type.name === DEF);
  if (!defs.length) return null;
  const order = refLabels(doc);
  const rank = (n: PMNode) => { const i = order.indexOf(n.attrs.label); return i < 0 ? order.length : i; };
  const sorted = defs.map((d, i) => ({ d, i })).sort((a, b) => rank(a.d.node) - rank(b.d.node) || a.i - b.i).map((x) => x.d);

  // 이미 끝에 연속으로 모여 있고(뒤따르는 빈 문단 하나는 허용) 순서도 맞는지
  const first = kids.findIndex((k) => k.node.type.name === DEF);
  const tail = kids.slice(first);
  const body = tail.length && isBlankPara(tail[tail.length - 1].node) ? tail.slice(0, -1) : tail;
  if (body.every((k) => k.node.type.name === DEF) && body.every((k, i) => k === sorted[i])) return null;

  const tr = state.tr;
  for (const d of [...defs].reverse()) tr.delete(d.pos, d.pos + d.node.nodeSize);
  const last = tr.doc.lastChild;
  const at = last && tr.doc.childCount > 1 && isBlankPara(last) ? tr.doc.content.size - last.nodeSize : tr.doc.content.size;
  tr.insert(at, Fragment.from(sorted.map((d) => d.node)));
  return tr;
}

function findDef(doc: PMNode, label: string): number {
  let pos = -1;
  doc.forEach((n, p) => { if (pos < 0 && n.type.name === DEF && n.attrs.label === label) pos = p; });
  return pos;
}

function findRef(doc: PMNode, label: string): number {
  let pos = -1;
  doc.descendants((n, p) => {
    if (pos >= 0) return false;
    if (n.type.name === REF && n.attrs.label === label) pos = p;
    return true;
  });
  return pos;
}

/** 위치로 커서를 옮기고 그 요소를 화면 가운데로 스크롤한다. ProseMirror 의 scrollIntoView 에만 맡기면 스크롤 컨테이너(.editor-wrap)에 따라 안 움직일 때가 있어 DOM 으로 직접 스크롤한다 */
function goto(view: EditorView, pos: number, inside: boolean) {
  const sel = inside ? TextSelection.near(view.state.doc.resolve(pos + 2)) : TextSelection.near(view.state.doc.resolve(pos));
  view.dispatch(view.state.tr.setSelection(sel));
  view.focus();
  const el = view.nodeDOM(pos);
  if (el instanceof HTMLElement) requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
}

/** 커서 자리에 각주를 넣는다. label 이 없으면 쓰지 않은 가장 작은 번호. 정의가 없으면 끝에 만들고 그 안으로 커서를 옮긴다 */
export function insertFootnote(view: EditorView, label?: string): boolean {
  const { state } = view;
  const { schema } = state;
  const ref = schema.nodes[REF], def = schema.nodes[DEF];
  if (!ref || !def || !view.editable) return false;
  if (state.selection.$from.parent.type.name === 'code_block') return false;
  const used = new Set<string>();
  state.doc.descendants((n) => { if (n.type.name === REF || n.type.name === DEF) used.add(n.attrs.label); return true; });
  let name = label;
  if (!name) { let i = 1; while (used.has(String(i))) i++; name = String(i); }
  const tr = state.tr.replaceSelectionWith(ref.create({ label: name }), false);
  let newDef = false;
  if (findDef(tr.doc, name) < 0) {
    tr.insert(tr.doc.content.size, def.create({ label: name }, schema.nodes.paragraph.create()));
    newDef = true;
  }
  view.dispatch(tr);
  if (newDef) goto(view, findDef(view.state.doc, name), true);
  return true;
}

const key = new PluginKey('footnotes');

const footnotePlugin = $prose(() => new Plugin({
  key,
  appendTransaction(trs, _old, state) {
    if (!trs.some((t) => t.docChanged)) return null;
    return normalizeFootnotes(state);
  },
  props: {
    // 첫 정의 위에 구분선을 그리기 위한 표식
    decorations(state) {
      let first = -1, size = 0;
      state.doc.forEach((n, p) => { if (first < 0 && n.type.name === DEF) { first = p; size = n.nodeSize; } });
      return first < 0 ? null : DecorationSet.create(state.doc, [Decoration.node(first, first + size, { class: 'fn-first' })]);
    },
    handleDOMEvents: {
      mousedown(view, e) {
        const el = e.target as HTMLElement;
        const sup = el.closest<HTMLElement>(`sup[data-type="${REF}"]`);
        if (sup) {
          const pos = findDef(view.state.doc, sup.dataset.label ?? '');
          if (pos < 0) return false;
          e.preventDefault();
          goto(view, pos, true);
          return true;
        }
        const dt = el.closest<HTMLElement>(`dl[data-type="${DEF}"] > dt`);
        if (dt) {
          const label = dt.parentElement?.dataset.label ?? '';
          const pos = findRef(view.state.doc, label);
          if (pos < 0) return false;
          e.preventDefault();
          goto(view, pos, false);
          return true;
        }
        return false;
      },
    },
  },
}));

// `[^라벨]` 입력 → 각주 참조(정의가 없으면 끝에 만든다)
const footnoteInput = $inputRule(() => new InputRule(/\[\^([^\]\s^]+)\]$/, (state, match, start, end) => {
  const { schema } = state;
  const ref = schema.nodes[REF], def = schema.nodes[DEF];
  if (!ref || !def) return null;
  const label = match[1];
  const tr = state.tr.replaceWith(start, end, ref.create({ label }));
  if (findDef(tr.doc, label) < 0) tr.insert(tr.doc.content.size, def.create({ label }, schema.nodes.paragraph.create()));
  return tr;
}));

export function footnotes(editor: Editor) {
  editor.use(footnotePlugin).use(footnoteInput);
}

/** 문서를 연 직후 한 번: 끝에 모이지 않은 정의를 정리한다 */
export function normalizeNow(view: EditorView) {
  const tr = normalizeFootnotes(view.state);
  if (tr) view.dispatch(tr.setMeta('addToHistory', false));
}

/** 정의의 글자(없으면 빈 문자열) */
function defText(doc: PMNode, label: string): string {
  const pos = findDef(doc, label);
  return pos < 0 ? '' : doc.nodeAt(pos)!.textContent.trim();
}

/** 본문 각주 번호에 마우스를 올리면 정의 내용을 말풍선으로 보여 준다. 말풍선이나 번호를 누르면 정의로 이동 */
export function attachFootnoteTips(view: EditorView): () => void {
  const tip = document.createElement('div');
  tip.className = 'fn-tip';
  tip.hidden = true;
  document.body.append(tip);
  let timer: number | undefined;
  let label = '';

  const hide = () => { clearTimeout(timer); tip.hidden = true; };
  const show = (sup: HTMLElement) => {
    label = sup.dataset.label ?? '';
    const text = defText(view.state.doc, label);
    tip.replaceChildren();
    const body = document.createElement('div');
    body.className = 'fn-tip-body';
    body.textContent = text || '(내용 없음)';
    if (!text) body.classList.add('empty');
    const hint = document.createElement('small');
    hint.textContent = '눌러서 각주로 이동';
    tip.append(body, hint);
    tip.hidden = false;
    const r = sup.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const below = r.bottom + 6 + h <= innerHeight - 8;
    tip.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))}px`;
    tip.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - 6 - h)}px`;
  };

  const onOver = (e: MouseEvent) => {
    const sup = (e.target as HTMLElement).closest<HTMLElement>(`sup[data-type="${REF}"]`);
    if (!sup) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => show(sup), 150);
  };
  const onOut = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(`sup[data-type="${REF}"]`)) { clearTimeout(timer); timer = window.setTimeout(hide, 200); }
  };
  const onTipEnter = () => clearTimeout(timer);
  const onTipClick = () => {
    const pos = findDef(view.state.doc, label);
    hide();
    if (pos >= 0) goto(view, pos, true);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };

  view.dom.addEventListener('mouseover', onOver);
  view.dom.addEventListener('mouseout', onOut);
  view.dom.addEventListener('mousedown', hide, true);
  tip.addEventListener('mouseenter', onTipEnter);
  tip.addEventListener('mouseleave', hide);
  tip.addEventListener('click', onTipClick);
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', hide, true);
  return () => {
    clearTimeout(timer);
    view.dom.removeEventListener('mouseover', onOver);
    view.dom.removeEventListener('mouseout', onOut);
    view.dom.removeEventListener('mousedown', hide, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', hide, true);
    tip.remove();
  };
}
