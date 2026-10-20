// 글감 다중 선택의 순수 로직(UI 상태는 state.svelte.ts). 보이는 목록의 id 배열을 기준으로 계산한다.

/** anchor 와 target 사이(양끝 포함)의 연속 범위. anchor 가 목록에 없으면 target 하나 */
export function rangeIds(visibleIds: string[], anchor: string, target: string): string[] {
  const b = visibleIds.indexOf(target);
  if (b < 0) return [];
  const a = visibleIds.indexOf(anchor);
  if (a < 0) return [target];
  return visibleIds.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** Ctrl/Cmd+클릭: 하나를 켜고 끈다 */
export const toggleId = (selected: string[], id: string): string[] =>
  selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];

/** Shift+클릭: 범위를 기존 선택에 더한다 */
export function addRange(selected: string[], visibleIds: string[], anchor: string, target: string): string[] {
  const add = rangeIds(visibleIds, anchor, target);
  return [...selected, ...add.filter((x) => !selected.includes(x))];
}

/** 목록에서 사라진 카드를 선택에서 뺀다. 바뀐 것이 없으면 같은 배열을 돌려준다 */
export function pruneSelection(selected: string[], visibleIds: string[]): string[] {
  const vis = new Set(visibleIds);
  return selected.every((x) => vis.has(x)) ? selected : selected.filter((x) => vis.has(x));
}

/** 선택된 카드를 목록 순서대로 */
export const inListOrder = (selected: string[], visibleIds: string[]): string[] => {
  const s = new Set(selected);
  return visibleIds.filter((x) => s.has(x));
};
