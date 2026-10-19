// 집필 UI 공용 상태 (집중 모드·글자 수 기준·선택 글자 수)

const SPACES_KEY = 'works.countSpaces';

function loadSpaces(): boolean {
  try { return localStorage.getItem(SPACES_KEY) !== '0'; } catch { return true; }
}

export const writing = $state({
  focus: false, // 집중 모드
  spaces: loadSpaces(), // 글자 수에 공백 포함
  selection: 0, // 선택 영역 글자 수 (없으면 0)
});

export function setSpaces(v: boolean) {
  writing.spaces = v;
  try { localStorage.setItem(SPACES_KEY, v ? '1' : '0'); } catch { /* 무시 */ }
}

export function toggleFocus(on = !writing.focus) {
  writing.focus = on;
}

/** 좁은 화면(≤720px) 여부 — app.css 의 좁은 화면 기준과 같다 */
export const MOBILE_QUERY = '(max-width: 720px)';
export function isMobile(): boolean {
  return typeof matchMedia === 'function' && matchMedia(MOBILE_QUERY).matches;
}
