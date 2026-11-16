import { EditorView as CM } from '@codemirror/view';

// ───────── 수식 블록($$) 입력 도움 툴바 ─────────
// 편집 상자 위에 "여러 줄 · 행렬 · 구조 · 간격" 메뉴를 붙인다. 합·분수·그리스 문자 같은 단순 입력은 넣지 않는다.
// 데스크톱은 그룹별 단추, 터치 기기는 "삽입" 단추 하나에 전체 목록을 담는다.

const CARET = '‸'; // 삽입 후 커서가 놓일 자리(선택 영역이 있으면 이 자리에 선택 글자를 넣는다)
const R = String.raw;

interface Snip { label: string; hint: string; text: string }
interface Group { name: string; items: Snip[] }

/** 환경 본문은 비워 두고 커서만 안쪽 빈 줄에 둔다(구분자 & · \ 는 직접 입력) */
const env = (head: string, tail: string) => head + '\n  ' + CARET + '\n' + tail;
const matrix = (name: string) => env(R`\begin{${name}}`, R`\end{${name}}`);

const GROUPS: Group[] = [
  {
    name: '여러 줄',
    items: [
      { label: '등호 정렬', hint: 'align*', text: env(R`\begin{align*}`, R`\end{align*}`) },
      { label: '가운데 정렬', hint: 'gather*', text: env(R`\begin{gather*}`, R`\end{gather*}`) },
      { label: '경우 나누기', hint: 'cases', text: env(R`\begin{cases}`, R`\end{cases}`) },
      { label: '연립방정식', hint: '{ aligned', text: env(R`\left\{\begin{aligned}`, R`\end{aligned}\right.`) },
    ],
  },
  {
    name: '행렬',
    items: [
      { label: '( ) 행렬', hint: 'pmatrix', text: matrix('pmatrix') },
      { label: '[ ] 행렬', hint: 'bmatrix', text: matrix('bmatrix') },
      { label: '| | 행렬식', hint: 'vmatrix', text: matrix('vmatrix') },
      { label: '배열 · 표', hint: 'array', text: env(R`\begin{array}{c|c}`, R`\end{array}`) },
    ],
  },
  {
    name: '구조',
    items: [
      { label: '큰 괄호 ( )', hint: R`\left( \right)`, text: R`\left( ${CARET} \right)` },
      { label: '큰 절댓값 | |', hint: R`\left| \right|`, text: R`\left| ${CARET} \right|` },
      { label: '텍스트', hint: R`\text{}`, text: R`\text{${CARET}}` },
      { label: '벡터', hint: R`\vec{}`, text: R`\vec{${CARET}}` },
      { label: '선분·위 줄', hint: R`\overline{}`, text: R`\overline{${CARET}}` },
      { label: '반직선·화살표 위', hint: R`\overrightarrow{}`, text: R`\overrightarrow{${CARET}}` },
      { label: 'n제곱근', hint: R`\sqrt[n]{}`, text: R`\sqrt[${CARET}]{}` },
      { label: '조합 · 이항계수', hint: R`\binom{}{}`, text: R`\binom{${CARET}}{}` },
      { label: '밑 괄호', hint: R`\underbrace{}_{}`, text: R`\underbrace{${CARET}}_{}` },
      { label: '도(°)', hint: R`^\circ`, text: R`^\circ${CARET}` },
    ],
  },
  {
    name: '간격',
    items: [
      { label: '줄바꿈', hint: R`\\`, text: R`\\` + '\n' },
      { label: '줄바꿈 + 0.3em', hint: R`\\[0.3em]`, text: R`\\[0.3em]` + '\n' },
      { label: '줄바꿈 + 0.6em', hint: R`\\[0.6em]`, text: R`\\[0.6em]` + '\n' },
      { label: '줄바꿈 + 1em', hint: R`\\[1em]`, text: R`\\[1em]` + '\n' },
      { label: '정렬 기호', hint: '&', text: '&' },
      { label: '가로 간격 (넓게)', hint: R`\quad`, text: R`\quad ` },
      { label: '가로 간격 (좁게)', hint: R`\,`, text: R`\, ` },
    ],
  },
];

/** 선택 영역을 스니펫으로 바꾼다. 선택 글자가 있으면 CARET 자리에 감싸 넣고, 없으면 CARET 자리에 커서를 둔다. */
export function insertSnippet(cm: CM, text: string) {
  const sel = cm.state.selection.main;
  const picked = cm.state.sliceDoc(sel.from, sel.to);
  const i = text.indexOf(CARET);
  const body = i < 0 ? text : text.slice(0, i) + picked + text.slice(i + 1);
  const line = cm.state.doc.lineAt(sel.from);
  // 환경(\begin)·경우 나누기는 줄 중간이면 새 줄에서 시작한다
  const needBreak = /^[^\n]*\\begin\{/.test(body.split('\n')[0]) && cm.state.sliceDoc(line.from, sel.from).trim() !== '';
  const out = (needBreak ? '\n' : '') + body;
  const caret = sel.from + (needBreak ? 1 : 0) + (i < 0 ? body.length : i + picked.length);
  cm.dispatch({ changes: { from: sel.from, to: sel.to, insert: out }, selection: { anchor: caret }, scrollIntoView: true });
  cm.focus();
}

// ───────── 메뉴 ─────────

let closeMenu: (() => void) | null = null;

const isTouch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function openMenu(anchor: HTMLElement, groups: Group[], cm: () => CM | null) {
  closeMenu?.();
  const menu = document.createElement('div');
  menu.className = 'mo-latex-menu';
  menu.setAttribute('role', 'menu');
  for (const g of groups) {
    if (groups.length > 1) {
      const h = document.createElement('div');
      h.className = 'mo-latex-menu-head';
      h.textContent = g.name;
      menu.append(h);
    }
    for (const it of g.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      const l = document.createElement('span');
      l.textContent = it.label;
      const c = document.createElement('code');
      c.textContent = it.hint;
      b.append(l, c);
      b.addEventListener('click', () => {
        const view = cm();
        close();
        if (view) insertSnippet(view, it.text);
      });
      menu.append(b);
    }
  }
  // 입력 포커스(와 모바일 키보드)를 빼앗지 않는다
  menu.addEventListener('pointerdown', (e) => e.preventDefault());
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  document.body.append(menu);

  const r = anchor.getBoundingClientRect();
  const mh = menu.offsetHeight;
  const below = window.innerHeight - r.bottom;
  const top = below >= Math.min(mh, 260) || below >= r.top ? r.bottom + 4 : Math.max(8, r.top - mh - 4);
  menu.style.top = `${top}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.maxHeight = `${Math.max(160, window.innerHeight - top - 12)}px`;

  const onDown = (e: Event) => {
    const t = e.target as Node;
    if (!menu.contains(t) && !anchor.contains(t)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); cm()?.focus(); }
  };
  const close = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (closeMenu === close) closeMenu = null;
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true); // 수식 편집 취소(Esc)보다 먼저 받아 메뉴만 닫는다
  window.addEventListener('resize', close);
  anchor.setAttribute('aria-expanded', 'true');
  closeMenu = close;
}

export const latexMenuOpen = () => !!document.querySelector('.mo-latex-menu');

function buildBar(block: HTMLElement): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'mo-latex-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', '수식 입력 도움');
  const getCm = () => CM.findFromDOM(block);
  const make = (text: string, groups: Group[]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mo-latex-btn';
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.textContent = text;
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-expanded') === 'true') closeMenu?.();
      else openMenu(b, groups, getCm);
    });
    return b;
  };
  const render = () => {
    bar.replaceChildren();
    if (isTouch()) bar.append(make('삽입 ▾', GROUPS));
    else for (const g of GROUPS) bar.append(make(`${g.name} ▾`, [g]));
  };
  render();
  return bar;
}

/** 편집 상자(.codemirror-host)에 툴바를 붙인다. CodeMirror 는 지연 생성되므로 DOM 변화 뒤에 다시 확인한다. */
export function attachLatexToolbar(root: HTMLElement): () => void {
  let raf = 0;
  const scan = () => {
    raf = 0;
    root.querySelectorAll<HTMLElement>('.mo-latex-block .codemirror-host').forEach((host) => {
      if (host.querySelector(':scope > .mo-latex-bar')) return;
      const block = host.closest<HTMLElement>('.mo-latex-block');
      if (block) host.prepend(buildBar(block));
    });
  };
  const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(scan); });
  mo.observe(root, { childList: true, subtree: true });
  scan();
  return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); closeMenu?.(); };
}
