// 글 목록 트리 다중 선택의 화면 상태(저장하지 않는다). 셸 헤더의 '선택' 단추와 트리(DocTree·TreeNode)가 함께 쓴다.
// 규칙(토글·범위·정리)은 treeSelect.ts 의 순수 함수.
import { addRange, extendRange, pruneSelection, toggleId } from './treeSelect';

export const tsel = $state({
  picked: [] as string[], // 선택된 항목 경로(폴더 경로·글의 키)
  mode: false, // 체크박스 선택 모드(행 클릭이 토글)
  anchor: '', // Shift 범위의 기준 항목
  kbRange: [] as string[], // 마지막 Shift+↑/↓ 범위(다음 키 입력에서 줄이고 늘리는 기준)
});

/** 지금 화면에 보이는 항목 경로(위에서 아래 순서). DocTree 가 목록이 바뀔 때마다 채운다 */
let visible: string[] = [];
export const setVisible = (paths: string[]) => { visible = paths; };

// 행마다 includes 를 돌지 않도록 배열이 바뀔 때만 집합을 다시 만든다
let memo: { arr: string[]; set: Set<string> } = { arr: [], set: new Set() };
export function isPicked(path: string): boolean {
  const arr = tsel.picked;
  if (memo.arr !== arr) memo = { arr, set: new Set(arr) };
  return memo.set.has(path);
}

/** Ctrl/Cmd+클릭(또는 선택 모드의 클릭): 하나를 켜고 끈다 */
export function toggle(path: string) {
  tsel.picked = toggleId(tsel.picked, path);
  tsel.anchor = path;
  tsel.kbRange = [];
}
/** Shift+클릭: 기준 항목부터 이 항목까지 보이는 순서로 연속 범위를 더한다 */
export function rangeTo(path: string) {
  tsel.picked = addRange(tsel.picked, visible, tsel.anchor, path);
  tsel.anchor = path;
  tsel.kbRange = [];
}
/** 그냥 클릭: 선택을 풀고 범위 기준만 옮긴다 */
export function plainClick(path: string) {
  if (tsel.picked.length) tsel.picked = [];
  tsel.anchor = path;
  tsel.kbRange = [];
}
export function clear() {
  tsel.picked = [];
  tsel.anchor = '';
  tsel.kbRange = [];
}
export const setMode = (on: boolean) => { tsel.mode = on; };
/** 화살표 이동(Shift 없이)으로 포커스가 옮겨 가면 거기가 새 기준이 된다 */
export function moveAnchor(path: string) {
  tsel.anchor = path;
  tsel.kbRange = [];
}
/** Shift+↑/↓: 기준에서 target 까지로 범위를 늘리거나 줄인다. 기준이 없으면 from 이 기준 */
export function extendTo(from: string, target: string) {
  if (!tsel.anchor || !visible.includes(tsel.anchor)) tsel.anchor = from;
  const r = extendRange(tsel.picked, tsel.kbRange, visible, tsel.anchor, target);
  tsel.picked = r.selected;
  tsel.kbRange = r.range;
}
/** Ctrl+A: 보이는 항목 전체 */
export function selectAll() {
  tsel.picked = [...visible];
  tsel.kbRange = [];
}
/** 보이는 목록에서 사라진 항목(필터·접기·삭제·이동)을 선택에서 뺀다 */
export function prune(paths: string[]) {
  const next = pruneSelection(tsel.picked, paths);
  if (next !== tsel.picked) tsel.picked = next;
  if (tsel.anchor && !paths.includes(tsel.anchor)) tsel.anchor = '';
  if (tsel.kbRange.length) tsel.kbRange = [];
}
/** 트리가 사라질 때: 모든 상태를 처음으로 */
export function reset() {
  clear();
  tsel.mode = false;
  visible = [];
}
