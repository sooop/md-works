// 표 키보드 행 추가: 마지막 셀에서 Tab → 새 행(엑셀식), Alt+Enter → 현재 행 아래에 새 행(같은 열로 이동), Alt+Shift+Enter → 현재 행 위에 새 행
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node as PMNode } from '@milkdown/kit/prose/model';

interface Cmds { addAfter: () => void; addBefore: () => void; next: () => void }

function cellInfo(view: EditorView): { colIndex: number; cols: number; last: boolean } | null {
  const $h = view.state.selection.$head;
  let cell = -1, row = -1, table = -1;
  for (let d = $h.depth; d > 0; d--) {
    const n = $h.node(d).type.name;
    if (cell < 0 && (n === 'table_cell' || n === 'table_header')) cell = d;
    else if (row < 0 && (n === 'table_row' || n === 'table_header_row')) row = d;
    else if (n === 'table') { table = d; break; }
  }
  if (cell < 0 || row < 0 || table < 0) return null;
  const rowNode = $h.node(row) as PMNode;
  const tableNode = $h.node(table) as PMNode;
  const colIndex = $h.index(row);
  return { colIndex, cols: rowNode.childCount, last: colIndex === rowNode.childCount - 1 && $h.index(table) === tableNode.childCount - 1 };
}

export function attachTableKeys(view: EditorView, cmds: Cmds): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing || !view.editable) return;
    const tab = e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
    const enter = e.key === 'Enter' && e.altKey && !e.ctrlKey && !e.metaKey;
    if (!tab && !enter) return;
    if (!view.dom.contains(e.target as Node)) return;
    const info = cellInfo(view);
    if (!info) return;
    if (tab) {
      if (!info.last) return; // 그 밖의 Tab 은 기본(다음 셀 이동)
      e.preventDefault(); e.stopPropagation();
      cmds.addAfter(); cmds.next();
      return;
    }
    e.preventDefault(); e.stopPropagation();
    if (e.shiftKey) { cmds.addBefore(); return; }
    cmds.addAfter();
    for (let i = 0; i < info.cols; i++) cmds.next(); // 새 행의 같은 열로
  };
  view.dom.addEventListener('keydown', onKey, true);
  return () => view.dom.removeEventListener('keydown', onKey, true);
}

// 행 핸들 메뉴(행 선택 시 뜨는 단추 묶음)에 'N행 위에 삽입 / N행 아래에 추가' 를 끼워 넣는다.
// Crepe 의 메뉴는 Vue 가 그리므로, 묶음이 나타날 때마다 DOM 으로 한 번만 덧붙인다.
export function attachRowMenu(view: EditorView, run: (cmd: 'before' | 'after', n: number) => void): () => void {
  const stop = (e: Event) => e.stopPropagation(); // 핸들의 클릭(행 선택 토글)·PM 의 마우스 처리에 섞이지 않게
  const inject = (group: HTMLElement) => {
    if (group.querySelector('.row-multi')) return;
    const box = document.createElement('div');
    box.className = 'row-multi';
    const mk = (label: string, title: string, cmd: 'before' | 'after') => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.title = title;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const n = Math.max(1, Math.min(100, parseInt(input.value, 10) || 1));
        run(cmd, n);
      });
      return b;
    };
    const input = document.createElement('input');
    input.type = 'number'; input.min = '1'; input.max = '100'; input.value = '1'; input.title = '추가할 행 수';
    box.append(mk('↑', '선택한 행 위에 N행 삽입', 'before'), input, mk('↓', '선택한 행 아래에 N행 추가', 'after'));
    for (const t of ['click', 'mousedown', 'pointerdown', 'keydown', 'keyup', 'beforeinput', 'input', 'focus', 'paste'])
      box.addEventListener(t, (e) => { if (e.target === input || t === 'click') stop(e); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run('after', Math.max(1, Math.min(100, parseInt(input.value, 10) || 1))); } });
    group.prepend(box);
  };
  const scan = () => view.dom.querySelectorAll<HTMLElement>('[data-role="row-drag-handle"] .button-group').forEach(inject);
  const mo = new MutationObserver(scan);
  mo.observe(view.dom, { childList: true, subtree: true });
  scan();
  return () => mo.disconnect();
}
