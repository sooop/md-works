import { Plugin, NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { exitCode } from '@milkdown/kit/prose/commands';
import { EditorView as CM } from '@codemirror/view';
import { $prose } from '@milkdown/kit/utils';
import { attachLatexToolbar, latexMenuOpen } from './latexToolbar';

// ───────── 수식 블록($$) : 코드 블록(언어 LaTeX) + KaTeX 미리보기 ─────────

const isLatex = (n: { type: { name: string }; attrs: Record<string, unknown> }) =>
  n.type.name === 'code_block' && String(n.attrs.language ?? '').toLowerCase() === 'latex';

const latexAt = (state: EditorView['state']) => {
  const { $from } = state.selection;
  const n = $from.parent;
  return isLatex(n) ? { pos: $from.before(), node: n } : null;
};

/** 편집 상자가 열려 있으면 미리보기 전용으로 접는다(미리보기가 없는 빈 수식은 그대로 둔다). */
function collapseToPreview(block: HTMLElement) {
  const host = block.querySelector<HTMLElement>('.codemirror-host');
  const toggle = block.querySelector<HTMLElement>('.preview-toggle-button');
  if (host && !host.classList.contains('hidden') && toggle) toggle.click();
}

/** 블록이 뷰포트(하단 도구줄 여유 포함) 밖에 있으면 가운데로 스크롤한다. 이미 충분히 보이면 건드리지 않는다. */
function ensureVisible(el: HTMLElement | null) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const margin = 80;
  if (r.top < margin || r.bottom > window.innerHeight - margin) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/** 편집 상자를 열고(미리보기 전용이면 전환) 입력 포커스를 끝에 둔다. CodeMirror 는 지연 생성되므로 잠시 재시도한다. */
function revealLatexEditor(getDom: () => HTMLElement | null, tries = 12) {
  const dom = getDom();
  const editor = dom?.querySelector<HTMLElement>('.cm-editor');
  const host = dom?.querySelector<HTMLElement>('.codemirror-host');
  if (!dom || !editor || !host) {
    if (tries > 0) setTimeout(() => revealLatexEditor(getDom, tries - 1), 40);
    return;
  }
  if (host.classList.contains('hidden')) {
    dom.querySelector<HTMLElement>('.preview-toggle-button')?.click();
    if (tries > 0) setTimeout(() => revealLatexEditor(getDom, tries - 1), 0);
    return;
  }
  const cm = CM.findFromDOM(dom);
  if (!cm) return;
  cm.focus();
  cm.dispatch({ selection: { anchor: cm.state.doc.length } });
  ensureVisible(dom);
}

/** `$$ ` 로 새 수식 블록을 만들면 편집 상자를 열고 포커스한다. 첫 글자가 들어가 미리보기가 생겨도 편집 상자가 닫히지 않게 한다.
 *  수식 블록에는 mo-latex-block 클래스를 달아 입력 필드·미리보기 스타일을 따로 준다. */
export const latexBlockFocus = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          const decos: Decoration[] = [];
          state.doc.descendants((n, pos) => {
            if (isLatex(n)) decos.push(Decoration.node(pos, pos + n.nodeSize, { class: 'mo-latex-block' }));
            return !n.isTextblock && n.type.name !== 'code_block';
          });
          return decos.length ? DecorationSet.create(state.doc, decos) : null;
        },
      },
      view: () => ({
        update(view, prev) {
          if (!view.editable) return;
          const cur = latexAt(view.state);
          if (!cur) {
            // 새로 열린 코드 블록이 뷰포트 밖이면 스크롤한다
            const { $from } = view.state.selection;
            const p = prev.selection.$from;
            if ($from.parent.type.name === 'code_block' && (p.parent !== $from.parent || p.before() !== $from.before()) && view.state.doc !== prev.doc) {
              const pos = $from.before();
              setTimeout(() => ensureVisible(view.nodeDOM(pos) as HTMLElement | null), 50);
            }
            return;
          }
          const was = latexAt(prev);
          const wasEmpty = !!was && was.node.content.size === 0;
          const created = cur.node.content.size === 0 && !wasEmpty;
          const typed = wasEmpty && cur.node.content.size > 0;
          if (created || typed) setTimeout(() => revealLatexEditor(() => view.nodeDOM(cur.pos) as HTMLElement | null), 0);
        },
      }),
    }),
);

// ───────── 키 처리: 완료(Ctrl/⌘+Enter)·취소(Esc) ─────────

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform);

/** 인라인 수식 편집을 끝낸다. apply=true 면 입력한 값을 적용하고, false 면 버린다. 어느 쪽이든 선택을 수식 뒤로 옮겨 팝오버를 닫는다. */
function closeInline(view: EditorView, apply: boolean): boolean {
  const sel = view.state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'math_inline') return false;
  const pos = sel.to;
  if (apply) {
    const btn = view.dom.parentElement?.querySelector('.milkdown-latex-inline-edit .container button');
    btn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  }
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos), 1)));
  view.focus();
  return true;
}

/** 인라인 수식 팝오버에 안내 줄·단추를 붙인다(Crepe 가 그리는 .container 는 건드리지 않고 형제로 덧붙인다). */
function decoratePopover(view: EditorView) {
  const pop = view.dom.parentElement?.querySelector<HTMLElement>('.milkdown-latex-inline-edit');
  if (!pop || pop.querySelector('.mo-latex-foot')) return;
  const foot = document.createElement('div');
  foot.className = 'mo-latex-foot';
  const mod = isMac ? '⌘' : 'Ctrl';
  foot.innerHTML =
    `<span class="hint"><kbd>${mod}</kbd><kbd>Enter</kbd> 적용 · <kbd>Esc</kbd> 취소</span>` +
    `<button type="button" class="mo-cancel">취소</button><button type="button" class="mo-apply">적용</button>`;
  // 포커스를 뺏지 않도록 pointerdown 에서 처리한다
  const act = (cls: string, apply: boolean) =>
    foot.querySelector(cls)!.addEventListener('pointerdown', (e) => { e.preventDefault(); closeInline(view, apply); });
  act('.mo-apply', true);
  act('.mo-cancel', false);
  pop.append(foot);
  watchGhost(pop);
}

/** 팝오버가 닫히면 Crepe 가 입력 필드(내부 에디터)를 즉시 없애 제목·단추만 남아 보인다.
 *  열려 있는 동안 사본을 갱신해 두었다가, 닫히는 순간 그 사본을 제자리에 띄워 통째로 사라지게 한다. */
function watchGhost(pop: HTMLElement) {
  let snap: HTMLElement | null = null;
  const take = () => {
    if (pop.dataset.show !== 'true') return;
    snap = pop.cloneNode(true) as HTMLElement;
  };
  const fadeOut = () => {
    const c = snap;
    snap = null;
    if (!c || !pop.parentElement) return;
    const off = document.documentElement.dataset.anim === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    c.removeAttribute('data-show');
    c.classList.add('mo-latex-ghost');
    c.setAttribute('aria-hidden', 'true');
    pop.parentElement.append(c);
    const anim = c.animate(
      off
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ opacity: 1, translate: '0 0', scale: 1 }, { opacity: 0, translate: '0 3px', scale: 0.96 }],
      { duration: off ? 90 : 130, easing: 'cubic-bezier(0.32, 0, 0.67, 0)', fill: 'forwards' },
    );
    anim.onfinish = anim.oncancel = () => c.remove();
  };
  let shown = pop.dataset.show === 'true';
  new MutationObserver(() => {
    const now = pop.dataset.show === 'true';
    if (shown && !now) fadeOut();
    shown = now;
    take();
  }).observe(pop, { attributes: true, childList: true, subtree: true, characterData: true });
}

/** 수식 편집 키: 인라인(팝오버)·블록($$) 공통으로 Ctrl/⌘+Enter 완료, Esc 취소. 인라인은 Enter 도 적용. */
export function attachLatexKeys(view: EditorView): () => void {
  const origin = new WeakMap<HTMLElement, string>(); // 블록 편집을 시작할 때의 원문(Esc 로 되돌리기)

  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const t = e.target as HTMLElement | null;
    const enter = e.key === 'Enter';
    const esc = e.key === 'Escape';
    if (!enter && !esc) return;
    // 줄바꿈 간격 추천이 열려 있으면 Esc 는 추천 닫기만 한다(수식 편집 취소로 번지지 않게)
    if (esc && latexMenuOpen()) return; // 삽입 메뉴가 열려 있으면 메뉴만 닫는다
    if (esc && t?.closest?.('.mo-latex-block') && document.querySelector('.cm-tooltip-autocomplete')) return;

    if (t?.closest?.('.milkdown-latex-inline-edit')) {
      if (enter && e.shiftKey) return;
      if (closeInline(view, enter)) { e.preventDefault(); e.stopPropagation(); }
      return;
    }

    const block = t?.closest?.<HTMLElement>('.mo-latex-block');
    if (!block || !t?.closest('.cm-editor')) return;
    if (enter && !(e.ctrlKey || e.metaKey)) return;
    const cm = CM.findFromDOM(block);
    if (!cm) return;
    e.preventDefault();
    e.stopPropagation();
    if (esc) {
      const orig = origin.get(block);
      const cur = cm.state.doc.toString();
      if (orig !== undefined && orig !== cur) cm.dispatch({ changes: { from: 0, to: cur.length, insert: orig } });
    }
    origin.delete(block);
    exitCode(view.state, view.dispatch);
    view.focus();
    collapseToPreview(block);
  };

  const onFocusIn = (e: FocusEvent) => {
    const el = e.target as HTMLElement | null;
    const block = el?.closest?.<HTMLElement>('.mo-latex-block');
    if (!block || !el?.closest('.cm-editor')) return;
    if (e.relatedTarget instanceof Node && block.contains(e.relatedTarget)) return;
    const cm = CM.findFromDOM(block);
    if (cm) origin.set(block, cm.state.doc.toString());
  };

  // 미리보기를 더블 클릭하면 편집 상자를 연다
  const onDbl = (e: MouseEvent) => {
    if (!view.editable) return;
    const el = e.target as HTMLElement | null;
    const block = el?.closest?.<HTMLElement>('.mo-latex-block');
    if (!block || !el?.closest('.preview-panel')) return;
    revealLatexEditor(() => block);
  };

  const detachBar = attachLatexToolbar(view.dom as HTMLElement);
  decoratePopover(view);
  const parent = view.dom.parentElement;
  const mo = parent ? new MutationObserver(() => decoratePopover(view)) : null;
  if (parent) mo!.observe(parent, { childList: true });

  document.addEventListener('keydown', onKey, true);
  document.addEventListener('focusin', onFocusIn, true);
  view.dom.addEventListener('dblclick', onDbl);
  return () => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('focusin', onFocusIn, true);
    view.dom.removeEventListener('dblclick', onDbl);
    mo?.disconnect();
    detachBar();
  };
}
