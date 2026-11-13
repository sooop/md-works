// 모달 공통 동작의 순수 로직(DOM·Svelte 에 의존하지 않아 단위 테스트가 된다). DOM 에 붙이는 부분은 modal.ts.

/** 열린 모달의 스택. 맨 끝이 최상단이고, Esc·포커스 트랩·배경 비활성화는 최상단만 다룬다 */
export class ModalStack<T> {
  private items: T[] = [];

  get size(): number { return this.items.length; }
  /** 최상단. 비었으면 undefined */
  get top(): T | undefined { return this.items[this.items.length - 1]; }
  has(item: T): boolean { return this.items.includes(item); }
  isTop(item: T): boolean { return this.top === item && this.items.length > 0; }
  /** 이미 있으면 무시한다(같은 모달을 두 번 올리지 않게) */
  push(item: T): void { if (!this.has(item)) this.items.push(item); }
  /** 스택 중간에서도 뺄 수 있다(아래 모달이 먼저 닫히는 경우). 있었으면 true */
  remove(item: T): boolean {
    const i = this.items.indexOf(item);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }
  /** 아래→위 순서의 복사본 */
  list(): T[] { return [...this.items]; }
}

/**
 * Tab/Shift+Tab 이 모달 밖으로 나가지 않게 가장자리에서만 되돌린다.
 * count: 모달 안의 포커스 가능 요소 수, active: 지금 포커스가 있는 요소의 순번(모달 안이 아니거나 컨테이너 자신이면 -1).
 * 반환: 포커스를 옮길 순번 / -1 이면 포커스 가능 요소가 없으니 컨테이너에 머물게(기본 동작만 막는다) / null 이면 기본 동작에 맡긴다.
 */
export function trapTarget(count: number, active: number, shift: boolean): number | null {
  if (count <= 0) return -1;
  if (active < 0 || active >= count) return shift ? count - 1 : 0;
  if (!shift && active === count - 1) return 0;
  if (shift && active === 0) return count - 1;
  return null;
}

/**
 * 백드롭 닫기 판정. pointerdown 과 click 이 **둘 다** 백드롭 자신에서 일어났을 때만 닫는다.
 * 입력창에서 글자를 끌다가 모달 밖에서 놓으면 click 의 대상이 백드롭이 되는데, 그때 pointerdown 은 모달 안이었으므로 닫지 않는다.
 */
export function createBackdropGuard() {
  let downOnBackdrop = false;
  return {
    down(onBackdrop: boolean): void { downOnBackdrop = onBackdrop; },
    /** click 시점에 호출. 닫아야 하면 true. 판정 뒤 상태를 비운다 */
    click(onBackdrop: boolean): boolean {
      const ok = downOnBackdrop && onBackdrop;
      downOnBackdrop = false;
      return ok;
    },
    reset(): void { downOnBackdrop = false; },
  };
}

/**
 * 닫힌 모달이 열기 직전의 포커스 요소로 돌려보낼지.
 * 아래에 있던 모달이 닫히는 경우(wasTop=false)나, 그사이 다른 곳(명령이 연 입력창 등)이 포커스를 가져간 경우는 건드리지 않는다.
 * 모달이 닫히는 순간 모달은 inert 가 되어 포커스가 body 로 떨어지므로 '없음'과 '닫힌 모달 안'을 같은 취급으로 본다.
 */
export function shouldRestoreFocus(s: { wasTop: boolean; focusNowhere: boolean; focusInsideClosed: boolean; openerAlive: boolean }): boolean {
  return s.wasTop && s.openerAlive && (s.focusNowhere || s.focusInsideClosed);
}

/** 포커스 가능 요소를 고르는 선택자(보이는지·inert 인지는 modal.ts 가 따로 거른다) */
export const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])', 'textarea:not([disabled])',
  '[contenteditable=""]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])', 'summary',
].join(',');

/** 모달이 떠 있어도 비활성화하지 않을 요소(토스트·툴팁·컨텍스트 메뉴·팝오버). 모달 밖 조상 형제를 inert 로 만들 때 건너뛴다 */
export const MODAL_SAFE_SELECTOR = '.toasts, .status, .tip, .ctx-menu, .pop-backdrop, .pop-panel, [data-modal-safe]';
