// 검색 UI 의 공유 상태: 옵션, 사이드바 탭, 문서 내 검색 바
import type { Finder } from './pmSearch';

const OPTS_KEY = 'notes.searchOpts';

function loadOpts() {
  const base = { caseSensitive: false, regex: false };
  try { return { ...base, ...JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}') }; } catch { return base; }
}

// 문서 내 검색과 전체 검색이 같이 쓴다
export const searchOpts = $state(loadOpts());
export function persistSearchOpts() {
  try { localStorage.setItem(OPTS_KEY, JSON.stringify(searchOpts)); } catch { /* 무시 */ }
}

export const ui = $state({
  tab: 'files' as 'files' | 'search' | 'comments' | 'snippets',
  findOpen: false,
  findFocus: 0, // 바뀔 때마다 검색 바 입력창에 포커스
  globalFocus: 0, // 바뀔 때마다 전체 검색 입력창에 포커스
});

// 문서 내 검색 바 상태. ctl 은 현재 열린 에디터가 등록한다(이력 미리보기 제외).
export const finder = $state<{
  query: string;
  ctl: Finder | null;
  ctlPath: string; // ctl 이 붙은 문서(doc.path)
  total: number;
  current: number;
  error: string;
  jump: { id: string; nth: number } | null; // 전체 검색 결과에서 연 문서(id)가 이동할 n번째 일치
}>({ query: '', ctl: null, ctlPath: '', total: 0, current: -1, error: '', jump: null });

// 문서 화면에서 Ctrl+F, 어디서든 Ctrl+Shift+F. 처리했으면 'find' | 'global' 을 돌려준다.
export function searchShortcut(e: KeyboardEvent, hasDoc: boolean): 'find' | 'global' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'f') return null;
  const target = e.target instanceof Element ? e.target : null;
  if (e.shiftKey) {
    e.preventDefault();
    ui.tab = 'search';
    ui.globalFocus++;
    return 'global';
  }
  // 사이드바·대화상자 안에서는 브라우저 기본 찾기를 그대로 둔다
  if (!hasDoc || target?.closest('.sidebar, .overlay, .dialog')) return null;
  e.preventDefault();
  const sel = window.getSelection()?.toString() ?? '';
  if (sel && sel.length <= 100 && !sel.includes('\n')) finder.query = sel;
  ui.findOpen = true;
  ui.findFocus++;
  return 'find';
}

// 전체 검색 결과에서 문서를 열 때: 같은 검색어로 문서 내 검색 바를 열고 n번째 일치로 이동
export function prepareJump(query: string, id: string, nth: number) {
  finder.query = query;
  finder.jump = { id, nth };
  ui.findOpen = true;
}
