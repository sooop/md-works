// 우클릭 메뉴: `openContextMenu(e, items)` 로 열고 ContextMenuHost 하나가 그린다.
// 키보드(Shift+F10·메뉴 키)·터치(길게 누르기)·버튼으로 열 때는 openContextMenuAt 을 쓴다.
export interface CtxItem { label: string; run: () => void | Promise<void>; danger?: boolean; sep?: boolean }
export const ctx = $state<{ open: boolean; x: number; y: number; items: CtxItem[] }>({ open: false, x: 0, y: 0, items: [] });

/** 메뉴를 연 요소: Esc 로 닫으면 포커스를 되돌린다 */
let opener: HTMLElement | null = null;
/** 직접 연 시각. 키보드·터치로 열면 브라우저가 뒤이어 contextmenu 이벤트를 또 보내므로 그 중복을 걸러 낸다 */
let openedAt = -Infinity;
const DUP_MS = 600;

function focused(): HTMLElement | null {
  const a = document.activeElement;
  return a instanceof HTMLElement && a !== document.body ? a : null;
}

export function openContextMenu(e: MouseEvent, items: CtxItem[]) {
  if (!items.length) return;
  e.preventDefault();
  e.stopPropagation();
  if (performance.now() - openedAt < DUP_MS) return; // 방금 키보드·터치로 열었다 — 뒤따른 네이티브 이벤트는 무시
  Object.assign(ctx, { open: true, x: e.clientX, y: e.clientY, items });
  opener = focused();
}

/** 좌표를 직접 주어 연다(키보드·터치·⋯ 버튼). from 은 닫을 때 포커스를 돌려줄 요소(없으면 지금 포커스된 요소) */
export function openContextMenuAt(x: number, y: number, items: CtxItem[], from?: HTMLElement | null) {
  if (!items.length) return;
  openedAt = performance.now();
  Object.assign(ctx, { open: true, x, y, items });
  opener = from ?? focused();
}

/** restore: Esc 처럼 아무것도 고르지 않고 닫을 때 true — 메뉴를 연 요소로 포커스를 돌려보낸다 */
export function closeContextMenu(restore = false) {
  const wasOpen = ctx.open;
  ctx.open = false;
  if (restore && wasOpen) opener?.focus();
  opener = null;
}

/**
 * 터치로 길게 누르면(약 500ms, 손가락이 움직이면 취소) 같은 메뉴를 연다. 마우스·펜은 건드리지 않는다.
 * 길게 누른 뒤 손가락을 뗄 때 생기는 클릭은 삼키고, 막 시작되려는 끌기는 막는다.
 * 안드로이드는 길게 누르면 contextmenu 이벤트를 보내기도 하는데, openContextMenu 가 중복을 걸러 낸다.
 */
export function longPress(node: HTMLElement, getItems: () => CtxItem[]) {
  const MS = 500;
  const SLOP = 10; // px — 이 이상 움직이면 스크롤·끌기로 본다
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sx = 0, sy = 0;
  let fired = false;
  const cancel = () => { clearTimeout(timer); timer = undefined; };

  function down(e: PointerEvent) {
    fired = false;
    cancel();
    if (e.pointerType !== 'touch' || !e.isPrimary) return;
    if ((e.target as HTMLElement).closest('input, textarea, .ops')) return; // 이름 입력·행 단추는 제외
    sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => {
      timer = undefined;
      const items = getItems();
      if (!items.length) return;
      fired = true;
      navigator.vibrate?.(8);
      openContextMenuAt(sx, sy, items, (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]'));
    }, MS);
  }
  function move(e: PointerEvent) {
    if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > SLOP) cancel();
  }
  function click(e: MouseEvent) {
    if (!fired) return;
    fired = false;
    e.preventDefault();
    e.stopPropagation();
  }
  function dragstart(e: DragEvent) {
    cancel();
    if (fired) e.preventDefault();
  }

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('click', click, true);
  node.addEventListener('dragstart', dragstart);
  return {
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('pointerleave', cancel);
      node.removeEventListener('click', click, true);
      node.removeEventListener('dragstart', dragstart);
    },
  };
}
