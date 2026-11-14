// 헤더 없는 표 표시: 마크다운 표는 헤더 행이 필수라 '첫 행을 헤더로' 를 끄면 모든 셀이 빈 헤더 행이 남는다.
// 그 행에 클래스(tbl-headless)를 붙여 CSS 가 얇은 줄로 줄이게 하고, 커서/선택이 그 행에 있으면 tbl-headless-active 를 더해 다시 펼친다(편집 접근 보장).
// 행 자체는 DOM 에 남아 있어 호버 툴바의 '첫 행을 헤더로' 토글과 셀 선택이 그대로 동작한다.
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

// 모든 셀에 글자도 이미지 같은 인라인 원자 노드도 없는 행인가
function isBlankRow(row: PMNode): boolean {
  if (row.textContent !== '') return false;
  let blank = true;
  row.descendants((n) => {
    if (n.isLeaf && !n.isText && n.type.name !== 'hardbreak') blank = false;
    return blank;
  });
  return blank;
}

interface HeaderRow { start: number; end: number }
interface HeaderlessState { rows: HeaderRow[]; active: string; set: DecorationSet | null }

function scanRows(doc: PMNode): HeaderRow[] {
  const rows: HeaderRow[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true;
    const row = node.firstChild;
    if (row && row.type.name === 'table_header_row' && isBlankRow(row)) {
      const start = pos + 1;
      rows.push({ start, end: start + row.nodeSize });
    }
    return false; // 표 안은 보지 않는다(중첩 표 없음)
  });
  return rows;
}

function build(doc: PMNode, rows: HeaderRow[], from: number, to: number): HeaderlessState {
  const flags: string[] = [];
  const decos = rows.map((r) => {
    const active = from <= r.end && to >= r.start;
    flags.push(active ? '1' : '0');
    return Decoration.node(r.start, r.end, { class: active ? 'tbl-headless tbl-headless-active' : 'tbl-headless' });
  });
  return { rows, active: flags.join(''), set: decos.length ? DecorationSet.create(doc, decos) : null };
}

const headlessKey = new PluginKey<HeaderlessState>('tableHeaderless');

// 전체 문서 순회는 문서가 바뀔 때만 한다. 선택만 움직이면 캐시한 행 위치로 활성 여부만 보고, 달라진 게 없으면 이전 DecorationSet 을 그대로 쓴다
export function createTableHeaderlessPlugin() {
  return new Plugin<HeaderlessState>({
    key: headlessKey,
    state: {
      init: (_c, state) => build(state.doc, scanRows(state.doc), state.selection.from, state.selection.to),
      apply(tr, prev, _old, state) {
        if (!tr.docChanged && !tr.selectionSet) return prev;
        const rows = tr.docChanged ? scanRows(state.doc) : prev.rows;
        const { from, to } = state.selection;
        if (!tr.docChanged) {
          const flags = rows.map((r) => (from <= r.end && to >= r.start ? '1' : '0')).join('');
          if (flags === prev.active) return prev;
        }
        return build(state.doc, rows, from, to);
      },
    },
    props: {
      decorations: (state) => headlessKey.getState(state)?.set ?? null,
    },
  });
}

export const tableHeaderless = $prose(() => createTableHeaderlessPlugin());
