// 글감함 UI 상태와 동작. 저장은 works/snippets.ts → worksStore() 를 거친다.
import { doc, toast, errMsg, askConfirm } from '../store.svelte';
import { ui } from '../search/state.svelte';
import {
  createSnippet, listSnippets, listTrashedSnippets, updateSnippet, attachSnippet, detachSnippet, trashSnippet, restoreSnippet, purgeSnippet,
} from '../works/snippets';
import type { Snippet, SnippetColor, SnippetSource } from '../works/types';
import { filterSnippets, findByPhrase, type SnippetView } from './filter';

export const sn = $state({
  active: [] as Snippet[],
  trashed: [] as Snippet[],
  loaded: false,
  view: 'doc' as SnippetView,
  color: '' as SnippetColor | '',
  query: '',
  phrase: '', // '문구로 글감 찾기' 입력
  openId: '', // 펼친 카드 (비슷한 글감을 보여 준다)
  focusInput: 0, // 바뀔 때마다 빠른 입력창에 포커스
  focusPhrase: 0, // 바뀔 때마다 문구 입력창에 포커스
});

export async function reload() {
  try {
    [sn.active, sn.trashed] = await Promise.all([listSnippets(), listTrashedSnippets()]);
    sn.loaded = true;
  } catch (e) {
    toast(`글감을 읽지 못했습니다: ${errMsg(e)}`, 'error');
  }
}

/** 현재 화면에 보일 글감: 문구 검색이 있으면 관련도 순, 없으면 보기·색·검색어 필터 */
export const visible = (): Snippet[] =>
  sn.phrase.trim() ? findByPhrase(sn.phrase, sn.active) : filterSnippets(sn.active, sn.trashed, { view: sn.view, docKey: doc.path, color: sn.color, query: sn.query });

async function run<T>(fn: () => Promise<T>, fail: string): Promise<T | undefined> {
  try {
    const r = await fn();
    await reload();
    return r;
  } catch (e) {
    toast(`${fail}: ${errMsg(e)}`, 'error');
    return undefined;
  }
}

export const addSnippet = (body: string, source?: SnippetSource, attach = true) =>
  run(() => createSnippet({ body, ...(source ? { source } : {}), ...(attach && doc.path ? { attachTo: [doc.path] } : {}) }), '글감을 추가하지 못했습니다');
export const editSnippet = (id: string, patch: Partial<Pick<Snippet, 'body' | 'source' | 'color'>>) => run(() => updateSnippet(id, patch), '글감을 고치지 못했습니다');
export const attachHere = (id: string) => doc.path ? run(() => attachSnippet(id, doc.path), '붙이지 못했습니다') : Promise.resolve(undefined);
export const detachHere = (id: string) => doc.path ? run(() => detachSnippet(id, doc.path), '떼지 못했습니다') : Promise.resolve(undefined);
export const discardSnippet = (id: string) => run(() => trashSnippet(id), '휴지통으로 옮기지 못했습니다');
export const recoverSnippet = (id: string) => run(() => restoreSnippet(id), '복구하지 못했습니다');
export async function deleteForever(id: string) {
  if (!(await askConfirm('이 글감을 완전히 삭제할까요? 되돌릴 수 없습니다.', '삭제'))) return;
  await run(() => purgeSnippet(id), '삭제하지 못했습니다');
}

// ---- 에디터 선택 텍스트 (코멘트·검색과 같이 DOM 선택을 쓴다: 사이드바를 눌러도 마지막 선택을 기억) ----
const last = { text: '', para: '' };
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th';

function onSelChange() {
  const s = window.getSelection();
  const n = s?.anchorNode;
  const el = n instanceof Element ? n : n?.parentElement;
  const pm = el?.closest('.editor-wrap .ProseMirror');
  if (!s || !el || !pm) return;
  last.text = s.isCollapsed ? '' : s.toString().trim();
  last.para = el.closest(BLOCK)?.textContent?.trim() ?? '';
}
/** 선택 변화 추적을 시작한다. 돌려주는 함수로 해제 */
export function trackEditorSelection(): () => void {
  document.addEventListener('selectionchange', onSelChange);
  return () => document.removeEventListener('selectionchange', onSelChange);
}
/** 선택한 텍스트, 없으면 커서가 놓인 문단 */
export const editorText = (): { text: string; selected: boolean } =>
  last.text ? { text: last.text, selected: true } : { text: last.para, selected: false };

/** 본문 선택 → 새 글감 (원전 없음, 현재 글에 붙임) */
export async function sendSelection() {
  if (!doc.path) { toast('문서를 먼저 여세요'); return; }
  const { text, selected } = editorText();
  if (!selected) { toast('글감으로 보낼 본문을 먼저 선택하세요'); return; }
  if (await addSnippet(text)) toast('글감으로 보냈습니다');
}

/** 에디터 선택(없으면 문단)을 문구 칸에 채워 관련 글감을 보여 준다 */
export function findByEditorText() {
  ui.tab = 'snippets';
  const { text } = editorText();
  if (text) sn.phrase = text.slice(0, 500);
  sn.focusPhrase++;
}
