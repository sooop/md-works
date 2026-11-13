import { describe, it, expect, beforeEach } from 'vitest';
import { buildTree, sortTree, reorderMany, type FlatDoc } from '../src/lib/docTree';
import { flattenVisible, moveTargets, moveTargetsMany } from '../src/lib/treeKeys';
import { pickedRoots, summarize, canMoveTo, movableTo, extendRange, dirOf } from '../src/lib/treeSelect';
import {
  tsel, isPicked, toggle, rangeTo, plainClick, clear, extendTo, selectAll, prune, setVisible, moveAnchor, reset,
} from '../src/lib/treeSelect.svelte';

const docs: FlatDoc[] = [
  { id: 'a', name: '가.md', folder: '', updated: 1 },
  { id: '주제/나.md', name: '나.md', folder: '주제', updated: 2 },
  { id: '주제/하위/다.md', name: '다.md', folder: '주제/하위', updated: 3 },
  { id: 'd', name: '라.md', folder: '', updated: 4 },
  { id: '다른/마.md', name: '마.md', folder: '다른', updated: 5 },
];
// 이름순: 다른, 빈, 주제(하위(다), 나), 가, 라
const tree = sortTree(buildTree(docs, ['주제/하위', '빈']), 'name', {});
const flatPaths = flattenVisible(tree, () => true).map((i) => i.path);

describe('pickedRoots (정규화)', () => {
  it('트리 순서로 늘어놓는다', () => {
    expect(pickedRoots(tree, ['d', 'a', '빈']).map((n) => n.path)).toEqual(['빈', 'a', 'd']);
  });
  it('폴더와 그 안의 항목을 함께 골랐으면 상위 폴더만 남긴다', () => {
    const r = pickedRoots(tree, ['주제', '주제/하위', '주제/하위/다.md', '주제/나.md', 'a']);
    expect(r.map((n) => n.path)).toEqual(['주제', 'a']);
  });
  it('안쪽만 골랐으면 그대로 둔다(서로 다른 폴더의 항목도)', () => {
    const r = pickedRoots(tree, ['주제/하위/다.md', '다른/마.md', '주제/나.md']);
    expect(r.map((n) => n.path)).toEqual(['다른/마.md', '주제/하위/다.md', '주제/나.md']);
  });
  it('트리에 없는 경로는 무시한다', () => {
    expect(pickedRoots(tree, ['없음'])).toEqual([]);
  });
});

describe('선택 요약', () => {
  it('글·폴더 개수와 폴더 안의 글 수를 센다', () => {
    const nodes = pickedRoots(tree, ['주제', 'a', 'd']);
    expect(summarize(nodes)).toEqual({ files: 2, dirs: 1, inner: 2 });
  });
  it('글만이면 폴더가 없다', () => {
    expect(summarize(pickedRoots(tree, ['a', 'd']))).toEqual({ files: 2, dirs: 0, inner: 0 });
  });
});

describe('이동 가능 판정', () => {
  const byPath = (p: string) => flattenVisible(tree, () => true).find((i) => i.path === p)!.node;
  it('이미 그 폴더에 있는 항목은 옮기지 않는다', () => {
    expect(canMoveTo(byPath('a'), '')).toBe(false);
    expect(canMoveTo(byPath('a'), '빈')).toBe(true);
    expect(dirOf(byPath('주제/나.md'))).toBe('주제');
  });
  it('폴더는 자기 자신·자기 하위로 옮길 수 없다', () => {
    expect(canMoveTo(byPath('주제'), '주제')).toBe(false);
    expect(canMoveTo(byPath('주제'), '주제/하위')).toBe(false);
    expect(canMoveTo(byPath('주제'), '다른')).toBe(true);
    expect(canMoveTo(byPath('주제/하위'), '')).toBe(true);
  });
  it('movableTo 는 옮길 것만 입력 순서대로 남긴다', () => {
    const nodes = [byPath('a'), byPath('주제/하위'), byPath('d')];
    expect(movableTo(nodes, '').map((n) => n.path)).toEqual(['주제/하위']);
    expect(movableTo(nodes, '빈').map((n) => n.path)).toEqual(['a', '주제/하위', 'd']);
    expect(movableTo(nodes, '주제/하위').map((n) => n.path)).toEqual(['a', 'd']);
    expect(movableTo([byPath('주제')], '주제/하위')).toEqual([]);
  });
});

describe('moveTargetsMany (이동 대상 목록)', () => {
  const byPath = (p: string) => flattenVisible(tree, () => true).find((i) => i.path === p)!.node;
  const state = (list: ReturnType<typeof moveTargetsMany>, p: string) => list.find((t) => t.path === p)!;
  it('선택한 폴더의 자기·하위는 비활성, 전부 이미 있는 폴더는 비활성', () => {
    const t = moveTargetsMany(tree, [byPath('주제'), byPath('a')]);
    expect(state(t, '주제')).toMatchObject({ disabled: true, note: '자기 하위' });
    expect(state(t, '주제/하위')).toMatchObject({ disabled: true, note: '자기 하위' });
    expect(state(t, '')).toMatchObject({ disabled: true, note: '현재 위치' }); // 주제·a 모두 최상위에 있다
    expect(state(t, '다른').disabled).toBe(false);
  });
  it('모든 항목이 같은 폴더에 있으면 그 폴더는 현재 위치로 비활성', () => {
    const t = moveTargetsMany(tree, [byPath('a'), byPath('d')]);
    expect(state(t, '')).toMatchObject({ disabled: true, note: '현재 위치' });
    expect(state(t, '빈').disabled).toBe(false);
  });
  it('일부만 그 폴더에 있으면 활성(나머지만 옮긴다)', () => {
    const t = moveTargetsMany(tree, [byPath('a'), byPath('주제/나.md')]);
    expect(state(t, '').disabled).toBe(false);
    expect(state(t, '주제').disabled).toBe(false);
  });
  it('하나일 때는 기존 moveTargets 와 같다', () => {
    const src = byPath('주제/하위');
    expect(moveTargetsMany(tree, [src])).toEqual(moveTargets(tree, src));
  });
});

describe('extendRange (Shift+↑/↓)', () => {
  const vis = ['a', 'b', 'c', 'd', 'e'];
  it('기준에서 한 칸씩 늘리고 줄인다', () => {
    let r = extendRange([], [], vis, 'b', 'c');
    expect(r.selected).toEqual(['b', 'c']);
    r = extendRange(r.selected, r.range, vis, 'b', 'd');
    expect(r.selected).toEqual(['b', 'c', 'd']);
    r = extendRange(r.selected, r.range, vis, 'b', 'c'); // 되돌아가면 줄어든다
    expect(r.selected).toEqual(['b', 'c']);
    r = extendRange(r.selected, r.range, vis, 'b', 'a'); // 기준을 지나 반대쪽으로
    expect(r.selected).toEqual(['a', 'b']);
  });
  it('따로 고른 항목은 건드리지 않는다', () => {
    const r1 = extendRange(['e'], [], vis, 'a', 'b');
    expect(r1.selected).toEqual(['e', 'a', 'b']);
    const r2 = extendRange(r1.selected, r1.range, vis, 'a', 'a');
    expect(r2.selected).toEqual(['e', 'a']);
  });
});

describe('reorderMany (직접 정렬에서 여러 개 끼우기)', () => {
  it('상대 순서를 유지한 채 before 앞에 한 덩어리로 끼운다', () => {
    expect(reorderMany(['a', 'b', 'c', 'd', 'e'], ['e', 'b'], 'd')).toEqual(['a', 'c', 'b', 'e', 'd']);
  });
  it('before 가 없으면 맨 뒤, current 에 없는 이름은 무시', () => {
    expect(reorderMany(['a', 'b', 'c'], ['a', 'x'], undefined)).toEqual(['b', 'c', 'a']);
  });
  it('덩어리 안의 이름이 before 면 맨 뒤로 간다', () => {
    expect(reorderMany(['a', 'b', 'c'], ['b'], 'b')).toEqual(['a', 'c', 'b']);
  });
});

describe('선택 상태(tsel)', () => {
  beforeEach(() => { reset(); setVisible(['a', 'b', 'c', 'd', 'e']); });

  it('Ctrl+클릭 토글과 기준 이동', () => {
    toggle('b');
    toggle('d');
    expect(tsel.picked).toEqual(['b', 'd']);
    expect(tsel.anchor).toBe('d');
    expect(isPicked('b')).toBe(true);
    toggle('b');
    expect(isPicked('b')).toBe(false);
  });
  it('Shift+클릭은 기준부터 보이는 순서로 범위를 더한다', () => {
    toggle('b');
    rangeTo('d');
    expect(tsel.picked).toEqual(['b', 'c', 'd']);
    rangeTo('a'); // 기준이 d 로 옮겨졌다 — a~d
    expect(tsel.picked.sort()).toEqual(['a', 'b', 'c', 'd']);
  });
  it('그냥 클릭은 선택을 풀고 기준만 옮긴다', () => {
    toggle('b');
    toggle('c');
    plainClick('e');
    expect(tsel.picked).toEqual([]);
    expect(tsel.anchor).toBe('e');
    rangeTo('c');
    expect(new Set(tsel.picked)).toEqual(new Set(['c', 'd', 'e']));
  });
  it('Shift+화살표 키보드 범위', () => {
    moveAnchor('b');
    extendTo('b', 'c');
    extendTo('b', 'd');
    expect(tsel.picked).toEqual(['b', 'c', 'd']);
    extendTo('b', 'c');
    expect(tsel.picked).toEqual(['b', 'c']);
  });
  it('Ctrl+A 는 보이는 항목 전체', () => {
    selectAll();
    expect(tsel.picked).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('보이는 목록에서 사라진 항목은 선택에서 빠지고, 같으면 배열이 그대로다', () => {
    selectAll();
    const before = tsel.picked;
    prune(['a', 'b', 'c', 'd', 'e']);
    expect(tsel.picked).toBe(before);
    toggle('e');
    prune(['a', 'b']);
    expect(tsel.picked).toEqual(['a', 'b']);
    expect(tsel.anchor).toBe(''); // 기준 항목이 사라졌다
  });
  it('해제하면 기준도 비운다', () => {
    toggle('c');
    clear();
    expect(tsel.picked).toEqual([]);
    expect(tsel.anchor).toBe('');
  });
});

describe('트리 평탄화와의 정합', () => {
  it('Ctrl+A 대상(보이는 항목)에서 정규화하면 최상위 뿌리만 남는다', () => {
    const roots = pickedRoots(tree, flatPaths);
    expect(roots.map((n) => n.path)).toEqual(['다른', '빈', '주제', 'a', 'd']);
  });
});
