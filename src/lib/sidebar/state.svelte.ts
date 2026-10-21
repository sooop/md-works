// 왼쪽 사이드바(파일·검색)의 표시 방식: 핀 고정이면 본문 옆에 붙어 있고, 아니면 숨겨 두었다가 가장자리 호버·버튼·단축키로 겹쳐서(팝오버) 연다.
// 모바일(≤720px)은 하단 시트라 `open` 만 쓰고 핀·폭은 무시한다.
import { isMobile, MOBILE_QUERY } from '../writing/state.svelte';

const KEY = 'works.left';
export const LEFT_W = { min: 200, max: 480, def: 270 };
export const clampLeftWidth = (w: number): number => Math.round(Math.max(LEFT_W.min, Math.min(w, LEFT_W.max)));

function load(): { pinned: boolean; width: number } {
  let pinned = true; // 처음 쓸 때는 왼쪽 패널만 본문 옆에 열어 둔다(이후는 저장된 고정 여부를 따른다)
  let width = LEFT_W.def;
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (typeof j.pinned === 'boolean') pinned = j.pinned;
    if (typeof j.width === 'number' && Number.isFinite(j.width)) width = clampLeftWidth(j.width);
  } catch { /* 저장소를 못 쓰는 환경 */ }
  return { pinned, width };
}

export const left = $state({ ...load(), open: false });

/** 모바일 여부(반응형) — 레이아웃 분기를 CSS 가 아니라 마크업에서 해야 할 때 쓴다 */
export const viewport = $state({ mobile: isMobile() });
if (typeof matchMedia === 'function') {
  const mq = matchMedia(MOBILE_QUERY);
  mq.addEventListener('change', () => { viewport.mobile = mq.matches; });
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify({ pinned: left.pinned, width: left.width })); } catch { /* 무시 */ }
}

export function setLeftWidth(w: number, save = true) { left.width = clampLeftWidth(w); if (save) persist(); }
export function togglePin() { left.pinned = !left.pinned; left.open = false; persist(); }
export function openLeft() { left.open = true; }
export function closeLeft() { left.open = false; }
/** 상단 버튼: 눌러서 연 것은 팝오버가 아니라 본문 옆 패널(고정)이다. 고정 상태에서 누르면 숨긴다(모바일은 시트를 여닫는다) */
export function toggleLeft() {
  if (viewport.mobile) { left.open = !left.open; return; }
  left.pinned = !left.pinned;
  left.open = false;
  persist();
}
/** 본문 옆에 붙어 있는가(핀 고정일 때만). 아니면 팝오버로 겹쳐 뜬다 */
export const isDocked = (): boolean => !viewport.mobile && left.pinned;

/** 집중 모드에서 오른쪽 가장자리 호버로 잠깐 여는 오른쪽 패널 */
export const rightPeek = $state({ open: false });
