// 헤더 없는 표 표시: 마크다운 표는 헤더 행이 필수라 '첫 행을 헤더로' 를 끄면 모든 셀이 빈 헤더 행이 남는다.
// 그 행에 클래스(tbl-headless)를 붙여 CSS 가 얇은 줄로 줄이게 하고, 커서/선택이 그 행에 있으면 tbl-headless-active 를 더해 다시 펼친다(편집 접근 보장).
// 행 자체는 DOM 에 남아 있어 호버 툴바의 '첫 행을 헤더로' 토글과 셀 선택이 그대로 동작한다.
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
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

export const tableHeaderless = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          const decos: Decoration[] = [];
          const { from, to } = state.selection;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'table') return true;
            const row = node.firstChild;
            if (row && row.type.name === 'table_header_row' && isBlankRow(row)) {
              const start = pos + 1;
              const end = start + row.nodeSize;
              const active = from <= end && to >= start;
              decos.push(Decoration.node(start, end, { class: active ? 'tbl-headless tbl-headless-active' : 'tbl-headless' }));
            }
            return false; // 표 안은 보지 않는다(중첩 표 없음)
          });
          return decos.length ? DecorationSet.create(state.doc, decos) : null;
        },
      },
    }),
);
