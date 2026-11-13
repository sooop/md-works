import { untrack } from 'svelte';

// 앱 공용 툴팁: 네이티브 title 대신 `use:tip={...}` 로 붙인다. 표시는 TooltipHost 하나가 맡는다.
// 터치 입력에는 띄우지 않고(길게 눌러도 가려질 뿐), 키보드 포커스는 :focus-visible 일 때만 보여 준다.

/**
 * delay: 표시까지의 지연(ms, 기본 380). warm: false 이면 직전 툴팁을 닫은 직후에도 지연 없이 띄우지 않는다
 * (행이 촘촘한 목록에서 마우스가 지나가는 행마다 연달아 뜨는 것을 막는다). quiet: true 를 돌려주는 동안에는 띄우지 않는다
 */
export type TipContent = string | { title: string; lines?: string[]; kbd?: string; delay?: number; warm?: boolean; quiet?: () => boolean } | null | undefined;
type TipBody = { title: string; lines: string[]; kbd: string };

export const tipState = $state<{ body: TipBody | null; rect: { x: number; y: number; w: number; h: number } | null }>({ body: null, rect: null });

const SHOW_DELAY = 380;
const WARM_MS = 400; // 직전 툴팁을 닫은 뒤 이 시간 안에 다른 곳을 가리키면 지연 없이 바로 보여 준다
let timer: ReturnType<typeof setTimeout> | undefined;
let lastHide = 0;
// 끌기(HTML5 drag)를 하는 동안에는 툴팁을 띄우지 않는다: 끌기 시작 때 이미 예약된 것도 거둔다
let dragging = false;
if (typeof window !== 'undefined') {
  window.addEventListener('dragstart', () => { dragging = true; hideTip(); }, true);
  const end = () => { dragging = false; };
  window.addEventListener('dragend', end, true);
  window.addEventListener('drop', end, true);
}

function normalize(c: TipContent): TipBody | null {
  if (!c) return null;
  if (typeof c === 'string') return { title: c, lines: [], kbd: '' };
  return { title: c.title, lines: c.lines ?? [], kbd: c.kbd ?? '' };
}

// 지금 툴팁을 띄운 요소. tipState 를 읽지 않고 이 변수로 판단한다(action 의 update 는 효과 안에서 불려, 거기서 tipState 를 읽고 쓰면 스스로를 다시 실행시키는 무한 루프가 된다)
let shownFor: HTMLElement | null = null;

export function hideTip() {
  clearTimeout(timer);
  if (shownFor) lastHide = Date.now();
  shownFor = null;
  tipState.body = null;
  tipState.rect = null;
}

export function tip(node: HTMLElement, initial: TipContent) {
  let content = initial;
  node.removeAttribute('title'); // 네이티브 툴팁과 겹치지 않게

  function show() {
    const body = normalize(content);
    if (!body || dragging) return;
    const r = node.getBoundingClientRect();
    shownFor = node;
    tipState.body = body;
    tipState.rect = { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  function schedule() {
    clearTimeout(timer);
    if (!normalize(content) || dragging) return;
    const o = typeof content === 'object' && content ? content : null;
    if (o?.quiet?.()) return;
    if (o?.warm !== false && Date.now() - lastHide < WARM_MS) show();
    else timer = setTimeout(show, o?.delay ?? SHOW_DELAY);
  }
  // Ctrl/Shift 를 누른 채 들어오면 여러 개를 고르는 중이므로 띄우지 않는다
  const enter = (e: PointerEvent) => { if (e.pointerType !== 'touch' && !e.ctrlKey && !e.shiftKey && !e.metaKey) schedule(); };
  const focus = () => { if (node.matches(':focus-visible')) schedule(); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hideTip(); };
  // 포커스를 가진 요소가 지워질 때의 blur 는 Svelte 가 DOM 을 정리하는 도중에 동기로 불려 상태를 바꿀 수 없다(state_unsafe_mutation).
  // 그때는 다음 틱에, 그사이 다른 요소의 툴팁이 뜨지 않았을 때만 치운다
  const blur = () => {
    try { hideTip(); } catch { queueMicrotask(() => { if (!shownFor) { tipState.body = null; tipState.rect = null; } }); }
  };

  node.addEventListener('pointerenter', enter);
  node.addEventListener('pointerleave', hideTip);
  node.addEventListener('pointerdown', hideTip);
  node.addEventListener('focus', focus);
  node.addEventListener('blur', blur);
  node.addEventListener('keydown', key);
  return {
    // 내용이 바뀌었을 때: 이 요소의 툴팁이 떠 있는 경우에만 갱신한다(다른 요소의 툴팁을 가로채지 않게, 반응 추적 없이)
    update(next: TipContent) { content = next; if (shownFor === node) untrack(show); },
    destroy() {
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', hideTip);
      node.removeEventListener('pointerdown', hideTip);
      node.removeEventListener('focus', focus);
      node.removeEventListener('blur', blur);
      node.removeEventListener('keydown', key);
      if (shownFor === node) hideTip();
    },
  };
}
