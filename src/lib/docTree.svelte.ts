// 글 목록 트리의 화면 상태: 정렬 기준, 접힌 폴더, 폴더별 직접 순서. 이 브라우저에만 저장한다(번들에는 싣지 않는다).
// 서버 모드와 단일 모드는 같은 브라우저에서 번갈아 쓸 수 있어 저장 키를 모드별로 나눈다.
import { renameInOrders, reorder, withParents, type OrderMap, type SortMode } from './docTree';

export const SORT_LABEL: Record<SortMode, string> = { name: '이름순', mtime: '최근 수정순', manual: '직접 정렬' };

let scope = 'standalone';
const key = (k: string) => `works.tree.${scope}.${k}`;
const read = <T>(k: string, fallback: T): T => {
  try { const v = localStorage.getItem(key(k)); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
};
const write = (k: string, v: unknown) => { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch { /* 무시 */ } };

export const treeUi = $state<{ sort: SortMode; collapsed: string[]; orders: OrderMap }>({ sort: 'name', collapsed: [], orders: {} });

/** 모드가 정해지면 한 번 부른다: 그 모드의 저장값을 읽는다 */
export function initTreeUi(mode: 'server' | 'standalone') {
  scope = mode;
  const s = read<string>('sort', 'name');
  treeUi.sort = s === 'mtime' || s === 'manual' ? s : 'name';
  treeUi.collapsed = read<string[]>('collapsed', []);
  treeUi.orders = read<OrderMap>('orders', {});
}

export function setSort(mode: SortMode) { treeUi.sort = mode; write('sort', mode); }
/** 폴더별 직접 순서 값을 통째로 바꾼다 */
export function setOrders(orders: OrderMap) { treeUi.orders = orders; write('orders', orders); }

export const isCollapsed = (path: string): boolean => treeUi.collapsed.includes(path);
export function toggleFolder(path: string) {
  treeUi.collapsed = isCollapsed(path) ? treeUi.collapsed.filter((p) => p !== path) : [...treeUi.collapsed, path];
  write('collapsed', treeUi.collapsed);
}
/** 폴더가 접혀 있으면 펼친다(그 안으로 글을 옮기거나 만들었을 때) */
export function expandFolder(path: string) {
  if (path && isCollapsed(path)) toggleFolder(path);
}

/**
 * 트리를 어디로 스크롤할지에 대한 요청(저장하지 않는다).
 * pending: 스크롤할 항목 경로(폴더 경로 또는 글의 키). fromTree: 방금 트리에서 직접 클릭해 연 글의 키.
 */
export const treeNav = $state<{ pending: string | null; fromTree: string }>({ pending: null, fromTree: '' });

/** 폴더로 가기: 그 폴더와 상위 폴더를 펼치고 트리를 그 위치로 스크롤한다 */
export function revealFolder(dir: string) {
  for (const p of withParents(dir)) expandFolder(p);
  treeNav.pending = dir;
}

let seenActive: string | null = null;
/**
 * 열린 글이 바뀌면 트리를 따라가게 한다. 트리 밖(검색·링크·명령 팔레트 등)에서 열었을 때만 상위 폴더를 펼치고 스크롤한다.
 * 트리에서 직접 연 글은 사용자가 접어 둔 상태를 건드리지 않는다. 첫 호출(앱을 열 때 복원된 글)은 펼치지 않고 스크롤만 한다
 */
export function onActiveChange(path: string, dir: string) {
  if (!path || path === seenActive) return;
  const first = seenActive === null;
  seenActive = path;
  const fromTree = treeNav.fromTree === path;
  treeNav.fromTree = '';
  if (fromTree) return;
  if (!first) for (const p of withParents(dir)) expandFolder(p);
  treeNav.pending = path;
}

/** dir 폴더 안에서 name 을 before 앞으로 옮긴다. siblings 는 지금 화면에 보이는 형제 이름 순서 */
export function moveInOrder(dir: string, siblings: string[], name: string, before?: string) {
  treeUi.orders = { ...treeUi.orders, [dir]: reorder(siblings, name, before) };
  write('orders', treeUi.orders);
}
/** 항목 이름을 바꾸거나 옮겼을 때 저장된 순서·접힘 상태를 따라 바꾼다 (경로는 폴더 경로 또는 폴더/이름) */
export function followRename(from: string, to: string) {
  treeUi.orders = renameInOrders(treeUi.orders, from, to);
  write('orders', treeUi.orders);
  treeUi.collapsed = treeUi.collapsed.map((p) => (p === from || p.startsWith(from + '/') ? to + p.slice(from.length) : p));
  write('collapsed', treeUi.collapsed);
}
