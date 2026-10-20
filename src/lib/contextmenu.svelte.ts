// 우클릭 메뉴: `openContextMenu(e, items)` 로 열고 ContextMenuHost 하나가 그린다.
export interface CtxItem { label: string; run: () => void | Promise<void>; danger?: boolean; sep?: boolean }
export const ctx = $state<{ open: boolean; x: number; y: number; items: CtxItem[] }>({ open: false, x: 0, y: 0, items: [] });

export function openContextMenu(e: MouseEvent, items: CtxItem[]) {
  if (!items.length) return;
  e.preventDefault();
  e.stopPropagation();
  Object.assign(ctx, { open: true, x: e.clientX, y: e.clientY, items });
}
export function closeContextMenu() { ctx.open = false; }
