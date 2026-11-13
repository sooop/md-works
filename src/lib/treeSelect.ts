// 글 목록 트리 다중 선택의 순수 로직(화면 상태는 treeSelect.svelte.ts). 선택은 항목 경로(폴더 경로·글의 키)의 배열이다.
// 토글·범위·정리는 글감함과 같은 규칙이라 snippets/selection.ts 를 그대로 쓴다.
import { splitPath, type DocNode } from './docTree';
import { rangeIds } from './snippets/selection';

export { rangeIds, toggleId, addRange, pruneSelection, inListOrder } from './snippets/selection';

/** 항목이 든 폴더 경로('' = 최상위) */
export const dirOf = (n: DocNode): string => n.dir ?? splitPath(n.path).folder;

/**
 * 일괄 동작의 대상: 선택된 경로를 트리 순서로 늘어놓되, 폴더와 그 안의 항목을 함께 골랐으면 상위 폴더만 남긴다.
 * tree 는 접힘·필터와 무관한 전체 트리(정렬된 것)를 넘긴다 — 폴더의 children 이 온전해야 한다
 */
export function pickedRoots(tree: DocNode[], picked: readonly string[]): DocNode[] {
  const want = new Set(picked);
  const out: DocNode[] = [];
  const walk = (list: DocNode[]) => {
    for (const n of list) {
      if (want.has(n.path)) out.push(n); // 이 폴더를 골랐으면 그 안은 더 보지 않는다(상위만 대상)
      else if (n.type === 'dir' && n.children?.length) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** 대상의 글·폴더 개수. inner 는 선택한 폴더들 안에 든 글의 수 */
export function summarize(nodes: DocNode[]): { files: number; dirs: number; inner: number } {
  const count = (list: DocNode[]): number => list.reduce((s, n) => s + (n.type === 'file' ? 1 : count(n.children ?? [])), 0);
  let files = 0, dirs = 0, inner = 0;
  for (const n of nodes) {
    if (n.type === 'file') files++;
    else { dirs++; inner += count(n.children ?? []); }
  }
  return { files, dirs, inner };
}

/** node 를 destDir 로 옮길 수 있는가: 이미 그 폴더에 있거나 자기 자신·자기 하위 폴더로는 옮기지 않는다 */
export const canMoveTo = (node: DocNode, destDir: string): boolean =>
  dirOf(node) !== destDir && !(node.type === 'dir' && (destDir === node.path || destDir.startsWith(node.path + '/')));

/** 대상 중 destDir 로 실제 옮길 항목만(입력 순서 유지) */
export const movableTo = (nodes: DocNode[], destDir: string): DocNode[] => nodes.filter((n) => canMoveTo(n, destDir));

/**
 * Shift+↑/↓ 로 범위를 늘리고 줄인다. anchor 부터 target 까지가 키보드 범위이고, 직전 키보드 범위(prevRange)는 걷어 낸 뒤 새로 더한다
 * (Ctrl+클릭으로 따로 고른 항목은 그대로 둔다). 돌려주는 range 를 다음 호출에 prevRange 로 넘긴다
 */
export function extendRange(selected: string[], prevRange: string[], visible: string[], anchor: string, target: string): { selected: string[]; range: string[] } {
  const range = rangeIds(visible, anchor, target);
  const drop = new Set(prevRange);
  const keep = selected.filter((x) => !drop.has(x));
  const have = new Set(keep);
  return { selected: [...keep, ...range.filter((x) => !have.has(x))], range };
}
