// 글감 보관함 모달의 순수 로직: 상태 모양, 기본 보기, 목록 계산. UI 상태(state.svelte.ts)와 분리해 단위 테스트한다.
// 사이드바(sn)와 모달(lib)의 보기·색·검색은 서로 다른 상태다 — 모달에서 거른다고 사이드바 목록이 바뀌지 않는다.
import { filterSnippets, type SnippetView } from './filter';
import type { Snippet, SnippetColor } from '../works/types';

/** 사이드바와 모달 모두 '모든 글감'으로 시작한다 */
export const DEFAULT_VIEW: SnippetView = 'all';

export interface LibraryState {
  open: boolean;
  view: SnippetView;
  color: SnippetColor | '';
  query: string;
  /** 오른쪽에 보이는 글감 */
  selectedId: string;
}

export const newLibraryState = (): LibraryState => ({ open: false, view: DEFAULT_VIEW, color: '', query: '', selectedId: '' });

/** 모달의 왼쪽 목록: 모달 자신의 보기·색·검색어로 거른다 */
export const libraryList = (active: Snippet[], trashed: Snippet[], l: Pick<LibraryState, 'view' | 'color' | 'query'>, docKey: string): Snippet[] =>
  filterSnippets(active, trashed, { view: l.view, docKey, color: l.color, query: l.query });

/** 정렬 값을 바꿀 수 있는가(사이드바 기준): '이 글에 꽂힌 글감' 보기이고 문구 찾기·검색어·색 필터가 없을 때 */
export const canReorderIn = (side: { view: SnippetView; phrase: string; query: string; color: string }, docKey: string): boolean =>
  side.view === 'doc' && !!docKey && !side.phrase.trim() && !side.query.trim() && !side.color;

/** 선택한 id 의 글감(없으면 undefined) */
export const findSelected = (list: Snippet[], id: string): Snippet | undefined => list.find((s) => s.id === id);

/** 선택한 글감이 목록에서 사라졌을 때(휴지통·필터 변경) 대신 보일 글감: 같은 자리의 이웃, 없으면 빈 id */
export function neighborId(before: Snippet[], after: Snippet[], id: string): string {
  if (after.some((s) => s.id === id)) return id;
  const at = before.findIndex((s) => s.id === id);
  const ids = new Set(after.map((s) => s.id));
  for (let i = at + 1; i < before.length; i++) if (ids.has(before[i].id)) return before[i].id;
  for (let i = at - 1; i >= 0; i--) if (ids.has(before[i].id)) return before[i].id;
  return after[0]?.id ?? '';
}
