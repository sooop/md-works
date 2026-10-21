// 표 ↔ CSV/TSV: 붙여넣기 변환(편집 모드) + 표 호버 툴바·우클릭 메뉴로 복사/파일 저장(읽기 모드 포함)
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Fragment } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { detectTable, toCsv, toTsv } from './tableCsv';
import { transposeRows } from './tableOps';
import { toHtml, toAscii, toMarkdown } from './tableFormats';
import { downloadBlob, writeClipboard, writeClipboardHtml } from './utils';

export interface TableToolsEnv {
  toast: (text: string, kind?: 'info' | 'error') => void;
  askChoose: (message: string, buttons: string[]) => Promise<number>;
  /** 내려받는 파일 이름의 바탕(문서 이름, 확장자 없음) */
  docName: () => string;
  /** 표를 확대해서 보는 모달을 연다 */
  openViewer: (t: TableData) => void;
  /** '복사' 단추의 기본 형식(설정) */
  defaultFmt?: () => Fmt;
}

/** 문서 안 표 하나 — 헤더 행을 분리해 둔다(헤더가 꺼진 표는 header 가 열 번호 이름). */
export interface TableData {
  /** 문서 안 몇 번째 표인가(1부터) */
  index: number;
  header: string[];
  rows: string[][];
  /** 확대 보기에서 만든 상태(필터·정렬·열 순서)를 문서의 표에 반영한다. 읽기 전용이면 없다. 표를 못 찾으면 false */
  apply?: (header: string[], rows: string[][]) => boolean;
}

const BLOCK_NO_PASTE = new Set(['code_block', 'table', 'table_cell', 'table_header']);

// ---- 붙여넣기 → 표 ----

function buildTable(view: EditorView, rows: string[][]): PMNode {
  const { schema } = view.state;
  const n = schema.nodes;
  const para = (s: string) => {
    const inline: PMNode[] = [];
    s.split('\n').forEach((part, i) => {
      if (i) inline.push(n.hardbreak.create());
      if (part) inline.push(schema.text(part));
    });
    return n.paragraph.create(null, inline);
  };
  const header = n.table_header_row.create(null, rows[0].map((s) => n.table_header.create(null, para(s))));
  const body = rows.slice(1).map((r) => n.table_row.create(null, r.map((s) => n.table_cell.create(null, para(s)))));
  return n.table.create(null, [header, ...body]);
}

function insertTable(view: EditorView, rows: string[][]) {
  view.dispatch(view.state.tr.replaceSelectionWith(buildTable(view, rows)).scrollIntoView());
  view.focus();
}

export const tablePaste = (env: TableToolsEnv) =>
  $prose(
    () =>
      new Plugin({
        props: {
          // handlePaste 는 Milkdown clipboard 플러그인이 먼저 받아 순수 텍스트(HTML 없음)를 마크다운으로 가로채므로, 그보다 앞서는 DOM 이벤트로 받는다
          handleDOMEvents: {
            paste(view, event: ClipboardEvent) {
            if (!view.editable) return false;
            const cd = event.clipboardData;
            if (!cd || cd.files.length) return false;
            if ((view as unknown as { input?: { shiftKey?: boolean } }).input?.shiftKey) return false; // Ctrl+Shift+V: 그대로 붙여넣기
            if (cd.getData('text/html').includes('data-pm-slice')) return false; // 이 에디터에서 복사한 조각
            const text = cd.getData('text/plain');
            const t = detectTable(text);
            if (!t) return false;
            const { $from } = view.state.selection;
            for (let d = $from.depth; d >= 0; d--) if (BLOCK_NO_PASTE.has($from.node(d).type.name)) return false;
            event.preventDefault(); // DOM 이벤트로 받으면 PM 이 막아주지 않으므로 브라우저 기본 붙여넣기를 직접 막는다
            if (t.kind !== 'csv') { insertTable(view, t.rows); return true; }
            const msg = `쉼표로 구분된 ${t.rows.length}행 × ${t.rows[0].length}열 데이터입니다. 표로 붙여넣을까요?`;
            void env.askChoose(msg, ['텍스트로 붙여넣기', '표로 붙여넣기']).then((b) => {
              if (b === 1) insertTable(view, t.rows);
              else if (b === 0) view.pasteText(text);
            });
            return true;
            },
          },
        },
      }),
  );

// ---- 표 → CSV/TSV ----

const cellText = (c: PMNode) =>
  c.textBetween(0, c.content.size, '\n', (leaf) => (leaf.type.name === 'hardbreak' ? '\n' : ((leaf.attrs.alt as string) ?? ''))).replace(/\n+$/, '');

function tableRows(table: PMNode): string[][] {
  const rows: string[][] = [];
  table.forEach((r) => {
    const cells: string[] = [];
    r.forEach((c) => cells.push(cellText(c)));
    rows.push(cells);
  });
  return rows;
}

/** 표 노드 → 헤더/본문. 첫 행 헤더가 꺼진(빈 헤더 행) 표는 `열 N` 이름을 붙이고 빈 행은 버린다. */
function toTableData(node: PMNode, index: number): TableData {
  const all = tableRows(node);
  if (isHeaderOn(node)) return { index, header: all[0], rows: all.slice(1) };
  return { index, header: all[0].map((_, i) => `열 ${i + 1}`), rows: all.slice(1) };
}

function findTable(view: EditorView, block: HTMLElement): { node: PMNode; pos: number; index: number } | null {
  const inner = block.querySelector('tbody') ?? block;
  let $pos;
  try { $pos = view.state.doc.resolve(view.posAtDOM(inner, 0)); } catch { return null; }
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name !== 'table') continue;
    const pos = $pos.before(d);
    let index = 0;
    view.state.doc.nodesBetween(0, pos, (n) => { if (n.type.name === 'table') index++; return true; });
    return { node, pos, index: index + 1 };
  }
  return null;
}

// 첫 행 헤더 토글. GFM 표는 헤더 행이 필수라 '끄기' = 빈 헤더 행을 맨 위에 넣고, '켜기' = 빈 헤더 행을 없애고 첫 본문 행을 헤더로 올린다.
const isHeaderOn = (table: PMNode) => !tableRows(table)[0].every((c) => c === '');

function toggleHeader(view: EditorView, table: PMNode, pos: number, env: TableToolsEnv) {
  const n = view.state.schema.nodes;
  const retype = (row: PMNode, rowType: typeof n.table_row, cellType: typeof n.table_cell) => {
    const cells: PMNode[] = [];
    row.forEach((c) => cells.push(cellType.create(c.attrs, c.content, c.marks)));
    return rowType.create(row.attrs, cells);
  };
  const rows: PMNode[] = [];
  table.forEach((r) => rows.push(r));
  let next: PMNode[];
  if (isHeaderOn(table)) {
    const blank: PMNode[] = [];
    rows[0].forEach((c) => blank.push(n.table_header.create(c.attrs, n.paragraph.create())));
    next = [n.table_header_row.create(rows[0].attrs, blank), retype(rows[0], n.table_row, n.table_cell), ...rows.slice(1)];
  } else {
    if (rows.length < 2) { env.toast('본문 행이 없어 첫 행 헤더를 켤 수 없습니다', 'error'); return; }
    next = [retype(rows[1], n.table_header_row, n.table_header), ...rows.slice(2)];
  }
  view.dispatch(view.state.tr.replaceWith(pos, pos + table.nodeSize, table.type.create(table.attrs, Fragment.from(next))));
}

/** 행·열 바꾸기. 열 정렬(좌/중/우)과 셀 서식은 사라진다 */
function transposeTable(view: EditorView, table: PMNode, pos: number, env: TableToolsEnv) {
  const rows = tableRows(table);
  const next = transposeRows(rows, isHeaderOn(table));
  if (next.length < 1 || next[0].length < 1 || (next.length < 2 && !isHeaderOn(table))) { env.toast('바꿀 내용이 없습니다', 'error'); return; }
  view.dispatch(view.state.tr.replaceWith(pos, pos + table.nodeSize, buildTable(view, next)));
}

export type Fmt = 'tsv' | 'csv';
const serialize = (rows: string[][], fmt: Fmt) => (fmt === 'tsv' ? toTsv(rows) : toCsv(rows));

export type CopyKind = 'tsv' | 'csv' | 'html' | 'htmlsrc' | 'ascii' | 'markdown';
/** 복사 형식 목록(메뉴 순서). desc 는 메뉴의 보조 설명 */
export const COPY_KINDS: { kind: CopyKind; label: string; desc: string }[] = [
  { kind: 'tsv', label: 'TSV 로 복사', desc: '탭 구분 — 엑셀·구글 시트에 그대로 붙여넣기' },
  { kind: 'csv', label: 'CSV 로 복사', desc: '쉼표 구분' },
  { kind: 'html', label: 'HTML 서식으로 복사', desc: '워드·메일 등에 표로 붙여넣기' },
  { kind: 'htmlsrc', label: 'HTML 소스로 복사', desc: '<table> 태그 글자' },
  { kind: 'ascii', label: '아스키 표로 복사', desc: '+---+ 로 그린 고정폭 글자 표' },
  { kind: 'markdown', label: '마크다운 표로 복사', desc: '| a | b | 형식' },
];
const DONE: Record<CopyKind, string> = {
  tsv: 'TSV 로', csv: 'CSV 로', html: 'HTML 서식으로', htmlsrc: 'HTML 소스로', ascii: '아스키 표로', markdown: '마크다운 표로',
};

export function copyAs(rows: string[][], kind: CopyKind, env: Pick<TableToolsEnv, 'toast'>) {
  const job = kind === 'tsv' || kind === 'csv' ? writeClipboard(serialize(rows, kind))
    : kind === 'html' ? writeClipboardHtml(toHtml(rows), toTsv(rows))
    : writeClipboard(kind === 'htmlsrc' ? toHtml(rows) : kind === 'ascii' ? toAscii(rows) : toMarkdown(rows));
  job.then(
    () => env.toast(`표를 ${DONE[kind]} 복사했습니다`),
    (e) => env.toast(e instanceof Error ? e.message : String(e), 'error'),
  );
}

export function copyTable(rows: string[][], fmt: Fmt, env: Pick<TableToolsEnv, 'toast'>) {
  copyAs(rows, fmt, env);
}

export function saveTable(rows: string[][], fmt: Fmt, index: number, env: Pick<TableToolsEnv, 'toast' | 'docName'>) {
  // CSV 는 UTF-8 BOM 을 붙여야 엑셀이 한글을 깨뜨리지 않는다
  const body = (fmt === 'csv' ? '﻿' : '') + serialize(rows, fmt);
  const base = env.docName() || '표';
  downloadBlob(`${base}-표${index}.${fmt}`, new Blob([body], { type: `text/${fmt === 'csv' ? 'csv' : 'tab-separated-values'};charset=utf-8` }));
  env.toast(`${fmt.toUpperCase()} 파일을 내려받았습니다`);
}

/** 확대 보기에서 만든 머리글·본문 행을 문서의 표로 바꾼다(셀 서식은 일반 글자가 된다). 첫 행 헤더가 꺼진 표는 빈 헤더 행을 유지한다 */
function applyRows(view: EditorView, block: HTMLElement, header: string[], rows: string[][]): boolean {
  const t = findTable(view, block);
  if (!t || !view.editable) return false;
  const head = isHeaderOn(t.node) ? header : header.map(() => '');
  const next = buildTable(view, [head, ...rows]);
  view.dispatch(view.state.tr.replaceWith(t.pos, t.pos + t.node.nodeSize, next));
  return true;
}

// ---- 호버 툴바 / 우클릭 메뉴 ----

export function attachTableTools(view: EditorView, env: TableToolsEnv): () => void {
  const bar = document.createElement('div');
  bar.className = 'tbl-tools';
  bar.hidden = true;
  const menu = document.createElement('div');
  menu.className = 'tbl-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  document.body.append(bar, menu);

  let block: HTMLElement | null = null;
  let hideTimer: number | undefined;

  const btn = (label: string, run: () => void, cls = '', title = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('mousedown', (e) => e.preventDefault()); // 에디터 선택·포커스 유지
    b.addEventListener('click', () => run());
    return b;
  };

  const withTable = (fn: (t: NonNullable<ReturnType<typeof findTable>>) => void) => () => {
    const t = block && findTable(view, block);
    if (t) fn(t);
  };
  const defaultFmt = (): Fmt => env.defaultFmt?.() ?? 'tsv';

  const openZoom = withTable((t) => {
    const data = toTableData(t.node, t.index);
    const b = block!;
    if (view.editable) data.apply = (header, rows) => applyRows(view, b, header, rows);
    env.openViewer(data);
  });

  type Item = { label: string; run?: () => void; kind?: 'sep' | 'head' | 'check'; checked?: boolean; hint?: string };
  /** ⋯ 메뉴와 우클릭 메뉴가 같은 항목을 쓴다 */
  const items = (): Item[] => {
    const t = block && findTable(view, block);
    const list: Item[] = [
      { label: '확대 보기', run: openZoom, hint: '필터·정렬·열 이동·통계' },
      { label: '', kind: 'sep' },
      { label: '복사', kind: 'head' },
      ...COPY_KINDS.map((k): Item => ({ label: k.label, hint: k.kind === defaultFmt() ? '기본' : '', run: withTable((tt) => copyAs(tableRows(tt.node), k.kind, env)) })),
      { label: '', kind: 'sep' },
      { label: 'CSV 파일로 저장', run: withTable((tt) => saveTable(tableRows(tt.node), 'csv', tt.index, env)) },
      { label: 'TSV 파일로 저장', run: withTable((tt) => saveTable(tableRows(tt.node), 'tsv', tt.index, env)) },
    ];
    if (view.editable && t) {
      list.push({ label: '', kind: 'sep' }, {
        label: '행·열 바꾸기', hint: '전치',
        run: () => { const cur = block && findTable(view, block); if (cur) transposeTable(view, cur.node, cur.pos, env); },
      }, {
        label: '첫 행을 헤더로', kind: 'check', checked: isHeaderOn(t.node),
        run: () => { const cur = block && findTable(view, block); if (cur) toggleHeader(view, cur.node, cur.pos, env); },
      });
    }
    return list;
  };

  function showMenu(x: number, y: number) {
    menu.replaceChildren(...items().map((it) => {
      if (it.kind === 'sep') { const hr = document.createElement('hr'); return hr; }
      if (it.kind === 'head') { const s = document.createElement('span'); s.className = 'tbl-menu-head'; s.textContent = it.label; return s; }
      const b = btn(it.label, () => { hideMenu(); it.run?.(); });
      if (it.kind === 'check') b.textContent = `${it.checked ? '✓ ' : '　'}${it.label}`;
      if (it.hint) { const h = document.createElement('small'); h.textContent = it.hint; b.append(h); }
      b.setAttribute('role', 'menuitem');
      return b;
    }));
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
  }

  function position() {
    if (!block || bar.hidden) return;
    const r = block.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) { bar.hidden = true; return; }
    const w = bar.offsetWidth, h = bar.offsetHeight;
    bar.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
    bar.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - h - 8))}px`;
  }

  function showBar(b: HTMLElement) {
    clearTimeout(hideTimer);
    if (block === b && !bar.hidden) { position(); return; }
    const t = findTable(view, b);
    if (!t) return;
    block = b;
    bar.replaceChildren();
    // 버튼은 셋뿐: 확대 · 복사(기본 형식) · ⋯(나머지 형식·저장·헤더 설정)
    const more = btn('⋯', () => {
      const r = more.getBoundingClientRect();
      if (menu.hidden) showMenu(r.left, r.bottom + 4); else hideMenu();
    }, 'tbl-more', '더 보기: 다른 형식으로 복사 · 파일로 저장 · 헤더');
    bar.append(
      btn('확대', openZoom, '', '확대 보기 (필터·정렬·통계)'),
      btn('복사', withTable((tt) => copyAs(tableRows(tt.node), defaultFmt(), env)), '', `${defaultFmt().toUpperCase()} 로 복사`),
      more,
    );
    bar.hidden = false;
    position();
  }

  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => { bar.hidden = true; if (menu.hidden) block = null; }, 250);
  };
  function hideMenu() { menu.hidden = true; }

  const onOver = (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.milkdown-table-block');
    if (b) showBar(b);
  };
  const onContext = (e: MouseEvent) => {
    if (e.shiftKey) return; // Shift+우클릭: 브라우저 기본 메뉴
    const b = (e.target as HTMLElement).closest<HTMLElement>('.milkdown-table-block');
    if (!b) return;
    e.preventDefault();
    block = b;
    showMenu(e.clientX, e.clientY);
  };
  const onDocDown = (e: Event) => { if (!menu.hidden && !menu.contains(e.target as Node) && !bar.contains(e.target as Node)) hideMenu(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hideMenu(); };
  const onScroll = () => { hideMenu(); position(); };

  view.dom.addEventListener('mouseover', onOver);
  view.dom.addEventListener('mouseleave', scheduleHide);
  view.dom.addEventListener('contextmenu', onContext);
  bar.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  bar.addEventListener('mouseleave', scheduleHide);
  document.addEventListener('mousedown', onDocDown, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);

  return () => {
    clearTimeout(hideTimer);
    view.dom.removeEventListener('mouseover', onOver);
    view.dom.removeEventListener('mouseleave', scheduleHide);
    view.dom.removeEventListener('contextmenu', onContext);
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
    bar.remove();
    menu.remove();
  };
}
