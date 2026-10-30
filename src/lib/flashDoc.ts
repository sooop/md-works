// 문서 안에서 자동으로 바뀐 영역을 화면 좌표 사각형으로 재서 flash 를 띄우는 헬퍼(정책: 사용자 조작에 반응한 자동 변경 알림).
// 문서를 건드리지 않고 화면 위에 상자만 겹치므로 변경 자체를 지연시키지 않는다.
import type { Transaction } from '@milkdown/kit/prose/state';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { flash, animOn, type FlashAction } from './motion';

const union = (a: DOMRect | null, b: DOMRect): DOMRect => {
  if (!a) return b;
  const l = Math.min(a.left, b.left), t = Math.min(a.top, b.top);
  return new DOMRect(l, t, Math.max(a.right, b.right) - l, Math.max(a.bottom, b.bottom) - t);
};

/** 문서 범위 [from,to) 의 화면 사각형. 블록을 통째로 덮으면 블록 DOM 들의 합, 한 문단 안의 일부면 글자 좌표 */
export function rangeRect(view: EditorView, from: number, to: number): DOMRect | null {
  const size = view.state.doc.content.size;
  from = Math.max(0, Math.min(from, size));
  to = Math.max(from, Math.min(to, size));
  if (from === to) return null;
  const blocks: { pos: number; node: PMNode }[] = [];
  view.state.doc.forEach((node, pos) => { if (pos + node.nodeSize > from && pos < to) blocks.push({ pos, node }); });
  const whole = blocks.length > 1 || (blocks.length === 1 && !blocks[0].node.isTextblock) || (blocks.length === 1 && from <= blocks[0].pos && to >= blocks[0].pos + blocks[0].node.nodeSize);
  try {
    if (whole) {
      let r: DOMRect | null = null;
      for (const b of blocks) {
        const el = view.nodeDOM(b.pos);
        if (el instanceof Element) r = union(r, el.getBoundingClientRect());
      }
      if (r) return r;
    }
    const a = view.coordsAtPos(from), z = view.coordsAtPos(to);
    const sameLine = Math.abs(a.top - z.top) < 2;
    const host = view.dom.getBoundingClientRect();
    const left = sameLine ? Math.min(a.left, z.left) : host.left, right = sameLine ? Math.max(a.right, z.right) : host.right;
    return new DOMRect(left, Math.min(a.top, z.top), right - left, Math.max(a.bottom, z.bottom) - Math.min(a.top, z.top));
  } catch { return null; }
}

/** 변경이 반영된 뒤(다음 프레임) 범위를 재서 flash 한다 */
export function flashRange(view: EditorView, from: number, to: number, action: FlashAction) {
  if (!animOn()) return;
  requestAnimationFrame(() => { void flash(rangeRect(view, from, to), action); });
}

/** 트랜잭션이 바꾼 범위(최종 문서 기준) */
export function changedRange(tr: Transaction): { from: number; to: number } | null {
  let from = Infinity, to = -1;
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_os, _oe, ns, ne) => {
      from = Math.min(from, rest.map(ns, -1));
      to = Math.max(to, rest.map(ne, 1));
    });
  });
  return to > from ? { from, to } : null;
}

/** 트랜잭션을 적용하고 바뀐 범위에 flash 를 띄운다 */
export function dispatchFlash(view: EditorView, tr: Transaction, action: FlashAction) {
  view.dispatch(tr);
  const r = changedRange(tr);
  if (r) flashRange(view, r.from, r.to, action);
}

/** 트랜잭션을 모르는 명령(callCommand 등)을 실행하고, 실행 전후 문서 차이 범위에 flash 를 띄운다 */
export function flashAfter(view: EditorView, run: () => void, action: FlashAction) {
  const before = view.state.doc;
  run();
  const after = view.state.doc;
  if (before === after) return;
  const s = before.content.findDiffStart(after.content);
  const e = before.content.findDiffEnd(after.content);
  if (s !== null && e && e.b > s) flashRange(view, s, e.b, action);
}
