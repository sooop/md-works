// 글 목록 트리의 키보드 이동·'이동…' 대상 계산(순수 함수). 화면 상태에는 기대지 않는다.
import { splitPath, type DocNode } from './docTree';

/** 지금 화면에 보이는 항목 하나(트리를 위에서 아래 순서로 평탄화한 것) */
export interface FlatItem {
  path: string;
  node: DocNode;
  /** 0 = 최상위 */
  depth: number;
  /** 부모 폴더 항목의 path('' = 최상위) */
  parent: string;
}

/** 보이는 항목을 위에서 아래 순서로 평탄화한다. 접힌 폴더의 자식은 넣지 않는다 */
export function flattenVisible(nodes: DocNode[], isOpen: (node: DocNode) => boolean, depth = 0, parent = '', out: FlatItem[] = []): FlatItem[] {
  for (const node of nodes) {
    out.push({ path: node.path, node, depth, parent });
    if (node.type === 'dir' && node.children?.length && isOpen(node)) flattenVisible(node.children, isOpen, depth + 1, node.path, out);
  }
  return out;
}

export type NavKey = 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End';
export const NAV_KEYS: ReadonlySet<string> = new Set<NavKey>(['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End']);

/** 키를 눌렀을 때 할 일: 포커스를 옮기거나, 폴더를 펼치거나 접는다. 할 일이 없으면 null */
export type NavResult = { focus: string } | { expand: string } | { collapse: string } | null;

export const indexOfPath = (list: FlatItem[], path: string): number => list.findIndex((i) => i.path === path);

/** 현재 항목의 첫 자식(펼쳐져 있어 보일 때만). 없으면 null */
export function firstChild(list: FlatItem[], path: string): FlatItem | null {
  const i = indexOfPath(list, path);
  const next = i >= 0 ? list[i + 1] : undefined;
  return next && next.parent === path ? next : null;
}

/** 부모 폴더 항목. 최상위이거나 목록에 없으면 null */
export function parentItem(list: FlatItem[], path: string): FlatItem | null {
  const i = indexOfPath(list, path);
  if (i < 0 || list[i].parent === '') return null;
  return list.find((x) => x.path === list[i].parent) ?? null;
}

/**
 * WAI-ARIA tree 키 규칙. isOpen 은 폴더가 펼쳐져 있는지, toggleable 이 false 면(파일명 검색 중처럼 항상 펼쳐진 상태) 접고 펼치지 않고 이동만 한다.
 * → 펼쳐져 있으면 첫 자식, ← 접혀 있거나 파일이면 부모, 펼쳐져 있으면 접기
 */
export function navigate(list: FlatItem[], path: string, key: string, isOpen: (node: DocNode) => boolean, toggleable = true): NavResult {
  const i = indexOfPath(list, path);
  if (i < 0 || !list.length) return null;
  const cur = list[i];
  switch (key) {
    case 'ArrowDown': return i + 1 < list.length ? { focus: list[i + 1].path } : null;
    case 'ArrowUp': return i > 0 ? { focus: list[i - 1].path } : null;
    case 'Home': return { focus: list[0].path };
    case 'End': return { focus: list[list.length - 1].path };
    case 'ArrowRight': {
      if (cur.node.type !== 'dir') return null;
      const open = isOpen(cur.node);
      if (!open) return toggleable ? { expand: cur.path } : null;
      const kid = firstChild(list, cur.path);
      return kid ? { focus: kid.path } : null;
    }
    case 'ArrowLeft': {
      if (cur.node.type === 'dir' && isOpen(cur.node) && toggleable) return { collapse: cur.path };
      const p = parentItem(list, cur.path);
      return p ? { focus: p.path } : null;
    }
    default: return null;
  }
}

/** 항목을 지운 뒤 포커스를 둘 곳: 지운 항목의 하위를 건너뛴 다음 항목, 없으면 바로 위 항목. 아무것도 없으면 '' */
export function neighborAfterRemove(list: FlatItem[], path: string): string {
  const i = indexOfPath(list, path);
  if (i < 0) return '';
  const depth = list[i].depth;
  let j = i + 1;
  while (j < list.length && list[j].depth > depth) j++;
  if (j < list.length) return list[j].path;
  return i > 0 ? list[i - 1].path : '';
}

/** '이동…' 대상 한 줄 */
export interface MoveTarget {
  /** 옮겨 갈 폴더 경로('' = 최상위) */
  path: string;
  label: string;
  /** 들여쓰기 단계(최상위 0, 최상위 폴더 1 …) */
  depth: number;
  disabled: boolean;
  /** 비활성인 이유(현재 위치 등) */
  note: string;
}

/**
 * 옮길 항목들(srcs)의 대상 목록: 최상위 + 모든 폴더. 항목 중 하나라도 폴더이고 그 자신·하위 폴더가 대상이면 비활성('자기 하위'),
 * 모든 항목이 이미 그 폴더에 있으면 비활성('현재 위치'). 일부만 그 폴더에 있으면 활성(나머지만 옮긴다)
 */
export function moveTargetsMany(nodes: DocNode[], srcs: DocNode[], rootLabel = '최상위'): MoveTarget[] {
  const make = (path: string, label: string, depth: number): MoveTarget => {
    const inside = srcs.some((s) => s.type === 'dir' && (path === s.path || path.startsWith(s.path + '/')));
    const here = srcs.length > 0 && srcs.every((s) => (s.dir ?? splitPath(s.path).folder) === path);
    return { path, label, depth, disabled: inside || here, note: here ? '현재 위치' : inside ? '자기 하위' : '' };
  };
  const out: MoveTarget[] = [make('', rootLabel, 0)];
  const walk = (list: DocNode[], depth: number) => {
    for (const n of list) {
      if (n.type !== 'dir') continue;
      out.push(make(n.path, n.name, depth));
      walk(n.children ?? [], depth + 1);
    }
  };
  walk(nodes, 1);
  return out;
}

/** 옮길 항목 src 의 대상 목록(하나). 자기 자신·자기 하위 폴더·현재 부모는 비활성으로 두고 이유를 적는다 */
export const moveTargets = (nodes: DocNode[], src: DocNode, rootLabel = '최상위'): MoveTarget[] => moveTargetsMany(nodes, [src], rootLabel);

/** 비활성 줄을 건너뛰어 from 에서 delta(+1/-1) 만큼 간 다음 활성 줄의 위치(맨 끝에서는 반대편으로 돈다). 활성 줄이 없으면 -1 */
export function stepEnabled(targets: { disabled: boolean }[], from: number, delta: 1 | -1): number {
  const n = targets.length;
  for (let k = 1; k <= n; k++) {
    const j = (((from + delta * k) % n) + n) % n;
    if (!targets[j].disabled) return j;
  }
  return -1;
}

/** 첫(또는 마지막) 활성 줄의 위치. 없으면 -1 */
export function edgeEnabled(targets: { disabled: boolean }[], last = false): number {
  if (last) { for (let i = targets.length - 1; i >= 0; i--) if (!targets[i].disabled) return i; return -1; }
  return targets.findIndex((t) => !t.disabled);
}
