// 사이드바 팝오버(peek)의 호버 동작: 가장자리에 마우스를 대면 열고, 패널에서 벗어나면 잠시 뒤 닫는다.

// 끌기(HTML5 drag) 중에는 마우스 이벤트가 끊겨 패널을 벗어난 것처럼 보이므로 닫지 않는다
let dragging = false;
if (typeof window !== 'undefined') {
  window.addEventListener('dragstart', () => { dragging = true; }, true);
  const end = () => { dragging = false; };
  window.addEventListener('dragend', end, true);
  window.addEventListener('drop', end, true);
}

const OPEN_DELAY = 300;
const CLOSE_DELAY = 600;
const ZONE = 28; // 가장자리 감지 폭(px). 요소가 아니라 창 좌표로 재서 스크롤바 같은 것을 가리지 않는다

/** 마우스가 창의 왼쪽/오른쪽 가장자리 ZONE 안에 OPEN_DELAY 동안 머무르면 fn 을 부른다(스쳐 지나가는 것은 무시). node 의 data-side 로 쪽을 정한다 */
export function edgeHover(node: HTMLElement, fn: () => void) {
  const side = node.dataset.side === 'right' ? 'right' : 'left';
  let t: ReturnType<typeof setTimeout> | undefined;
  const inZone = (x: number) => (side === 'left' ? x <= ZONE : x >= innerWidth - ZONE);
  const move = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (inZone(e.clientX)) { if (!t) t = setTimeout(fn, OPEN_DELAY); }
    else if (t) { clearTimeout(t); t = undefined; }
  };
  window.addEventListener('pointermove', move, { passive: true });
  return { destroy() { clearTimeout(t); window.removeEventListener('pointermove', move); } };
}

/** 팝오버로 떠 있는 패널: 마우스가 벗어나 CLOSE_DELAY 가 지나면 close. 패널 안에서 글을 입력하는 중이면 닫지 않는다 */
export function peekPanel(node: HTMLElement, opts: { active: () => boolean; close: () => void }) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const enter = () => clearTimeout(t);
  const leave = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || !opts.active() || dragging || e.buttons) return;
    clearTimeout(t);
    t = setTimeout(() => {
      if (dragging) return;
      const a = document.activeElement;
      if (a && node.contains(a) && a.matches('input, textarea, [contenteditable="true"]')) return;
      if (node.querySelector('[role="menu"], [role="listbox"], .popover, .pop-panel')) return; // 안에서 메뉴·팝오버를 연 채로 벗어난 경우
      if (document.querySelector('.ctx-menu, .overlay')) return; // 우클릭 메뉴·대화상자(이름·삭제 확인 등)를 쓰는 중
      if (opts.active()) opts.close();
    }, CLOSE_DELAY);
  };
  node.addEventListener('pointerenter', enter);
  node.addEventListener('pointerleave', leave);
  return { destroy() { clearTimeout(t); node.removeEventListener('pointerenter', enter); node.removeEventListener('pointerleave', leave); } };
}
