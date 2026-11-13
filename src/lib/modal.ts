// 모달 공통 동작: 오버레이 요소에 `use:modal={{ onClose }}` 를 붙이면 아래가 한꺼번에 적용된다.
//  - 모달 스택: Esc 는 최상단 모달만 처리한다(한글 조합 중·이미 누가 처리한 Esc 는 건너뜀)
//  - 포커스 트랩: Tab/Shift+Tab 이 최상단 모달 안에서만 돈다
//  - 포커스 복귀: 닫히면 열기 직전에 포커스가 있던 요소로 돌아간다(사라졌거나 그사이 다른 곳이 가져갔으면 그대로 둔다)
//  - 배경 비활성화: 최상단 모달 밖(아래 모달 포함)을 inert 로 만든다. 토스트·툴팁·컨텍스트 메뉴·팝오버는 제외(MODAL_SAFE_SELECTOR)
//  - 백드롭 닫기: pointerdown 과 click 이 둘 다 백드롭에서 일어났을 때만
// 순수 로직은 modalCore.ts(단위 테스트 대상).
import { askConfirm } from './store.svelte';
import { ModalStack, trapTarget, createBackdropGuard, shouldRestoreFocus, FOCUSABLE_SELECTOR, MODAL_SAFE_SELECTOR } from './modalCore';

export interface ModalOptions {
  /** Esc·백드롭으로 닫으려 할 때 부른다. 실제로 닫을지는 여기서 정한다(입력 유실 확인 등) */
  onClose: () => void;
  /** Esc 만 따로 처리할 때(예: 선택부터 풀고 그다음에 닫기). 생략하면 onClose */
  onEscape?: () => void;
  /** false 를 돌려주면 Esc·백드롭을 무시한다(작업 중 등) */
  canClose?: () => boolean;
  /** 백드롭으로 볼 클릭 대상. 기본은 오버레이 요소 자신 */
  isBackdrop?: (target: EventTarget | null) => boolean;
  /** false 면 백드롭 클릭으로 닫지 않는다 */
  backdrop?: boolean;
  /** 열릴 때 포커스를 줄 요소(선택자 또는 함수). 모달이 이미 포커스를 가져갔으면 쓰지 않는다. 생략하면 첫 포커스 가능 요소 */
  focus?: string | (() => HTMLElement | null | undefined);
}

interface Entry {
  node: HTMLElement;
  opts: ModalOptions;
  opener: HTMLElement | null;
}

const stack = new ModalStack<Entry>();
/** 우리가 inert 로 만든 요소(원래부터 inert 였던 것은 건드리지 않는다) */
const inerted = new Set<HTMLElement>();
let listening = false;

/** 이 요소가 지금 최상단 모달인가(모달 안의 window 단축키가 위에 뜬 다른 모달·확인창과 겹치지 않게) */
export function isTopModal(node: Element | null | undefined): boolean {
  return !!node && stack.top?.node === node;
}
/** 열려 있는 모달 수 */
export const modalCount = () => stack.size;

/** 입력한 내용을 버리고 닫을지 묻는다(PasteModal·목록→표 변환 등 긴 글을 넣는 모달용) */
export const confirmDiscard = () => askConfirm('입력한 내용을 버리고 닫을까요?', '버리기', true);

const visible = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

/** 모달 안에서 Tab 으로 갈 수 있는 요소(보이고 inert 가 아닌 것) */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((el) => visible(el) && !el.closest('[inert]'));
}

function applyInert() {
  for (const el of inerted) el.inert = false;
  inerted.clear();
  const top = stack.top;
  if (!top) return;
  let cur: HTMLElement = top.node;
  // 최상단 모달에서 body 까지 올라가며 각 단계의 형제를 막는다(조상 자체에는 걸지 않아 모달이 그대로 동작한다)
  while (cur.parentElement && cur !== document.body) {
    const parent: HTMLElement = cur.parentElement;
    for (const sib of Array.from(parent.children)) {
      if (sib === cur || !(sib instanceof HTMLElement) || sib.inert) continue;
      if (/^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(sib.tagName) || sib.matches(MODAL_SAFE_SELECTOR)) continue;
      sib.inert = true;
      inerted.add(sib);
    }
    cur = parent;
  }
}

function onKey(e: KeyboardEvent) {
  const top = stack.top;
  if (!top || e.defaultPrevented) return;
  if (e.key === 'Escape') {
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    if (top.opts.canClose && !top.opts.canClose()) return;
    (top.opts.onEscape ?? top.opts.onClose)();
  } else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing) {
    const list = focusables(top.node);
    const a = document.activeElement;
    let idx = a ? list.indexOf(a as HTMLElement) : -1;
    if (idx < 0 && a && top.node.contains(a)) idx = list.findIndex((el) => el.contains(a)); // 포커스 가능 요소의 자손(contenteditable 안쪽 등)
    const to = trapTarget(list.length, idx, e.shiftKey);
    if (to === null) return;
    e.preventDefault();
    (to < 0 ? top.node : list[to]).focus();
  }
}

function release(entry: Entry) {
  if (!stack.has(entry)) return;
  const wasTop = stack.isTop(entry);
  stack.remove(entry);
  if (!stack.size && listening) { window.removeEventListener('keydown', onKey); listening = false; }
  applyInert(); // 포커스를 돌려주기 전에 배경부터 되살린다
  const a = document.activeElement;
  const op = entry.opener;
  if (op && shouldRestoreFocus({
    wasTop,
    focusNowhere: !a || a === document.body || a === document.documentElement,
    focusInsideClosed: !!a && entry.node.contains(a),
    openerAlive: op.isConnected && !op.closest('[inert]'),
  })) op.focus({ preventScroll: true });
}

function focusInitial(entry: Entry) {
  const { node, opts } = entry;
  const a = document.activeElement;
  if (a && a !== node && node.contains(a)) return; // 모달이 이미 포커스를 정했다(입력창 등)
  const custom = typeof opts.focus === 'function' ? opts.focus() : opts.focus ? node.querySelector<HTMLElement>(opts.focus) : null;
  const target = custom ?? focusables(node).find((el) => !el.hasAttribute('data-modal-x')) ?? null;
  (target ?? node).focus({ preventScroll: true });
}

export function modal(node: HTMLElement, initial: ModalOptions) {
  let opts = initial;
  const guard = createBackdropGuard();
  const isBackdrop = (t: EventTarget | null) => (opts.isBackdrop ? opts.isBackdrop(t) : t === node);

  const active = document.activeElement;
  const entry: Entry = {
    node,
    get opts() { return opts; },
    opener: active instanceof HTMLElement && active !== document.body ? active : null,
  };

  // 컨테이너 자신이 포커스를 받을 수 있게(빈 곳을 눌러도 포커스가 모달 안에 남고, 포커스 가능 요소가 없어도 Tab 이 갇힌다)
  if (!node.hasAttribute('tabindex')) node.tabIndex = -1;
  node.style.outline = 'none';

  const onDown = (e: PointerEvent) => guard.down(isBackdrop(e.target));
  const onClick = (e: MouseEvent) => {
    if (!guard.click(isBackdrop(e.target)) || opts.backdrop === false) return;
    if (opts.canClose && !opts.canClose()) return;
    opts.onClose();
  };
  node.addEventListener('pointerdown', onDown);
  node.addEventListener('click', onClick);

  function acquire() {
    if (stack.has(entry)) return;
    stack.push(entry);
    if (!listening) { window.addEventListener('keydown', onKey); listening = true; }
    applyInert();
  }
  // 닫힘을 최대한 일찍 알아챈다. Svelte 가 사라지는 전환을 시작하면 요소를 바로 inert 로 만든다(우리가 막은 게 아닐 때만).
  // 전환 도중 다시 열리면(inert 해제) 스택에 되돌린다. outrostart 와 destroy 는 보조(전환이 없거나 감지를 놓친 경우)이고 release 는 여러 번 불려도 안전하다
  const mo = new MutationObserver(() => {
    if (node.inert) { if (!inerted.has(node)) release(entry); }
    else if (node.isConnected) acquire();
  });
  mo.observe(node, { attributes: true, attributeFilter: ['inert'] });
  const onOut = () => release(entry);
  node.addEventListener('outrostart', onOut);

  acquire();
  setTimeout(() => { if (stack.has(entry)) focusInitial(entry); }, 0);

  return {
    update(next: ModalOptions) { opts = next; },
    destroy() {
      release(entry);
      mo.disconnect();
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('click', onClick);
      node.removeEventListener('outrostart', onOut);
    },
  };
}
