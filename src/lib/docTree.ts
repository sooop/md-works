// 글 목록 트리의 순수 로직: 평평한 글 목록 → 폴더 트리, 정렬(이름·수정일·직접), 직접 순서 갱신.
// 서버 모드(경로 트리)와 단일 모드(folder 필드)가 같은 화면 컴포넌트를 쓰도록 노드 모양을 하나로 맞춘다.

export interface DocNode {
  name: string; // 이 항목의 이름(파일은 확장자 포함)
  path: string; // 폴더는 폴더 경로, 파일은 글의 키(서버: 경로, 단일: 문서 id)
  type: 'file' | 'dir';
  /** 부모 폴더 경로(루트는 ''). 서버는 경로에서 구할 수 있어 생략해도 된다 */
  dir?: string;
  mtime?: number;
  children?: DocNode[];
}

export interface FlatDoc { id: string; name: string; folder: string; updated: number }

export type SortMode = 'name' | 'mtime' | 'manual';
/** 폴더 경로('' = 루트) → 그 폴더 안 항목 이름의 순서 */
export type OrderMap = Record<string, string[]>;

const collator = new Intl.Collator('ko', { numeric: true });
export const byName = (a: string, b: string): number => collator.compare(a, b);

/** 폴더 경로 → 그 경로와 모든 상위 경로 ('a/b' → ['a','a/b']) */
export function withParents(folder: string): string[] {
  const segs = folder.split('/').filter(Boolean);
  return segs.map((_, i) => segs.slice(0, i + 1).join('/'));
}

/** 글 목록과(비어 있어도 있는) 폴더 목록으로 트리를 만든다. 정렬은 sortTree 가 따로 한다 */
export function buildTree(docs: FlatDoc[], folders: string[]): DocNode[] {
  const root: DocNode = { name: '', path: '', type: 'dir', children: [] };
  const dirs = new Map<string, DocNode>([['', root]]);
  const dirNode = (path: string): DocNode => {
    const have = dirs.get(path);
    if (have) return have;
    const i = path.lastIndexOf('/');
    const parent = dirNode(i < 0 ? '' : path.slice(0, i));
    const node: DocNode = { name: path.slice(i + 1), path, type: 'dir', dir: parent.path, children: [] };
    parent.children!.push(node);
    dirs.set(path, node);
    return node;
  };
  for (const f of folders) for (const p of withParents(f)) dirNode(p);
  for (const d of docs) {
    const parent = dirNode(d.folder);
    parent.children!.push({ name: d.name, path: d.id, type: 'file', dir: parent.path, mtime: d.updated });
  }
  return root.children!;
}

/** 폴더의 대표 수정 시각: 안의 글 중 가장 최근 */
export function latest(node: DocNode): number {
  if (node.type === 'file') return node.mtime ?? 0;
  return Math.max(0, ...(node.children ?? []).map(latest));
}

/** 같은 폴더 안의 항목을 정렬한다(폴더가 항상 먼저). 직접 순서에 없는 항목은 이름순으로 뒤에 붙는다 */
export function sortSiblings(nodes: DocNode[], mode: SortMode, order: string[] = []): DocNode[] {
  const rank = new Map(order.map((n, i) => [n, i]));
  const cmp = (a: DocNode, b: DocNode): number => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    if (mode === 'mtime') return latest(b) - latest(a) || byName(a.name, b.name);
    if (mode === 'manual') {
      const ra = rank.get(a.name);
      const rb = rank.get(b.name);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
    }
    return byName(a.name, b.name);
  };
  return [...nodes].sort(cmp);
}

/** 트리 전체에 정렬을 적용한 새 트리 */
export function sortTree(nodes: DocNode[], mode: SortMode, orders: OrderMap, dir = ''): DocNode[] {
  return sortSiblings(nodes, mode, orders[dir]).map((n) =>
    n.type === 'dir' ? { ...n, children: sortTree(n.children ?? [], mode, orders, n.path) } : n);
}

/** `name` 을 `before` 앞에 끼운 순서(before 가 없거나 못 찾으면 맨 뒤). current 는 지금 화면에 보이는 형제 이름 순서 */
export function reorder(current: string[], name: string, before?: string): string[] {
  const rest = current.filter((n) => n !== name);
  const at = before === undefined ? -1 : rest.indexOf(before);
  if (at < 0) rest.push(name);
  else rest.splice(at, 0, name);
  return rest;
}

const parentOf = (p: string) => (p.lastIndexOf('/') < 0 ? '' : p.slice(0, p.lastIndexOf('/')));
const leaf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** 항목 이름을 바꾸거나 옮길 때 직접 순서를 따라 바꾼다(하위 폴더의 키, 같은 부모 안의 이름, 옛 부모 목록에서 빼기) */
export function renameInOrders(orders: OrderMap, from: string, to: string): OrderMap {
  const out: OrderMap = {};
  for (const [k, v] of Object.entries(orders)) {
    const key = k === from || k.startsWith(from + '/') ? to + k.slice(from.length) : k;
    out[key] = v;
  }
  const oldParent = parentOf(from);
  const list = out[oldParent];
  if (list) {
    out[oldParent] = oldParent === parentOf(to)
      ? list.map((n) => (n === leaf(from) ? leaf(to) : n)) // 같은 폴더 안에서 이름만 바뀜
      : list.filter((n) => n !== leaf(from)); // 다른 폴더로 옮겨짐: 새 폴더에서는 맨 뒤에 놓인다
  }
  return out;
}

/** 글의 폴더·이름으로 전체 경로 */
export const fullPath = (folder: string, name: string): string => (folder ? `${folder}/${name}` : name);
/** 전체 경로를 폴더와 이름으로 */
export function splitPath(path: string): { folder: string; name: string } {
  return { folder: parentOf(path), name: leaf(path) };
}

/** 정렬된 트리의 지금 보이는 순서를 폴더별 직접 순서 값으로 옮긴다(이름순·수정일순을 직접 정렬의 출발점으로 삼을 때) */
export function ordersOf(nodes: DocNode[], dir = '', out: OrderMap = {}): OrderMap {
  out[dir] = nodes.map((n) => n.name);
  for (const n of nodes) if (n.type === 'dir') ordersOf(n.children ?? [], n.path, out);
  return out;
}
