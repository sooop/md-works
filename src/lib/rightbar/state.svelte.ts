// 오른쪽 사이드바(글감·코멘트)의 열림·탭 상태. 왼쪽 사이드바(파일·검색)와 분리해 본문 옆에 두고 쓰는 자료를 모은다.
import { isMobile, writing } from '../writing/state.svelte';
import { rightPeek } from '../sidebar/state.svelte';

const KEY = 'works.right';
export type RightTab = 'snippets' | 'comments';

export const RIGHT_W = { min: 260, max: 720, def: 320 };
/** 폭을 허용 범위(그리고 창 폭의 60%)로 맞춘다 */
export const clampRightWidth = (w: number, win = typeof innerWidth === 'number' ? innerWidth : 1280): number =>
  Math.round(Math.max(RIGHT_W.min, Math.min(w, RIGHT_W.max, Math.max(RIGHT_W.min, win * 0.6))));

function load(): { open: boolean; tab: RightTab; width: number } {
  let open = false; // 처음에는 닫아 둔다(이후는 저장된 고정 여부를 따른다)
  let tab: RightTab = 'snippets';
  let width = RIGHT_W.def;
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (typeof j.open === 'boolean') open = j.open;
    if (j.tab === 'comments' || j.tab === 'snippets') tab = j.tab;
    if (typeof j.width === 'number' && Number.isFinite(j.width)) width = clampRightWidth(j.width);
  } catch { /* 저장소를 못 쓰는 환경 */ }
  if (typeof innerWidth === 'number' && innerWidth <= 720) open = false; // 모바일은 하단 시트라 시작할 때 항상 닫는다
  return { open, tab, width };
}

export const right = $state(load());

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify({ open: right.open, tab: right.tab, width: right.width })); } catch { /* 무시 */ }
}

/** 모바일에서 오른쪽 시트를 열 때 왼쪽 시트를 닫기 위해 셸이 등록한다 */
export const leftSheet: { close: (() => void) | null } = { close: null };

/** 패널을 보여 준다. 데스크톱에서 고정(right.open)이 아니면 팝오버로 잠깐 띄우고(밖을 누르거나 마우스가 벗어나면 닫힌다), 모바일은 시트로 연다 */
export function openRight(tab?: RightTab) {
  if (tab) right.tab = tab;
  if (isMobile()) {
    right.open = true;
    leftSheet.close?.(); // 모바일은 시트가 하나만 열린다
    persist();
    return;
  }
  if (!right.open || writing.focus) rightPeek.open = true;
  persist();
}
/** 팝오버로 열려 있는 패널을 본문 옆에 고정한다 */
export function pinRight() { right.open = true; rightPeek.open = false; persist(); }
export function closeRight() { right.open = false; persist(); }
/** 메뉴의 '글감·코멘트 패널': 본문 옆에 고정하거나 풀어 숨긴다(모바일은 시트를 여닫는다) */
export function toggleRight() { if (right.open) closeRight(); else if (isMobile()) openRight(); else pinRight(); }
export function setRightTab(tab: RightTab) { right.tab = tab; persist(); }
export function setRightWidth(w: number, save = true) { right.width = clampRightWidth(w); if (save) persist(); }
/** 왼쪽 사이드바를 열 때(모바일) 오른쪽을 닫는다 */
export function closeRightOnMobile() { if (isMobile() && right.open) closeRight(); }
