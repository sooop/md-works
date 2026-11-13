import { describe, it, expect } from 'vitest';
import { buildTree, sortTree, type FlatDoc } from '../src/lib/docTree';
import { flattenVisible, navigate, firstChild, parentItem, neighborAfterRemove, moveTargets, stepEnabled, edgeEnabled } from '../src/lib/treeKeys';

const docs: FlatDoc[] = [
  { id: 'a', name: '가.md', folder: '', updated: 1 },
  { id: 'b', name: '나.md', folder: '주제', updated: 2 },
  { id: 'c', name: '다.md', folder: '주제/하위', updated: 3 },
  { id: 'd', name: '라.md', folder: '', updated: 4 },
];
// 이름순: 주제(나, 하위(다)), 폴더가 먼저 → 주제, 주제/하위, 다, 나, 가, 라 순서가 아니라 아래 펼침 상태에 따라 달라진다
const tree = sortTree(buildTree(docs, ['주제/하위', '빈']), 'name', {});
const allOpen = () => true;
const collapsedSet = (...c: string[]) => (n: { path: string }) => !c.includes(n.path);

describe('flattenVisible', () => {
  it('모두 펼치면 폴더 먼저·이름순으로 위에서 아래로 늘어놓는다', () => {
    const flat = flattenVisible(tree, allOpen);
    expect(flat.map((i) => i.path)).toEqual(['빈', '주제', '주제/하위', 'c', 'b', 'a', 'd']);
    expect(flat.map((i) => i.depth)).toEqual([0, 0, 1, 2, 1, 0, 0]);
    expect(flat.find((i) => i.path === 'c')!.parent).toBe('주제/하위');
  });
  it('접힌 폴더의 자식은 빠진다', () => {
    const flat = flattenVisible(tree, collapsedSet('주제'));
    expect(flat.map((i) => i.path)).toEqual(['빈', '주제', 'a', 'd']);
    const flat2 = flattenVisible(tree, collapsedSet('주제/하위'));
    expect(flat2.map((i) => i.path)).toEqual(['빈', '주제', '주제/하위', 'b', 'a', 'd']);
  });
});

describe('navigate', () => {
  const flat = flattenVisible(tree, allOpen);
  it('↑↓ 는 보이는 항목을 한 칸씩 옮기고 끝에서는 멈춘다', () => {
    expect(navigate(flat, '주제', 'ArrowDown', allOpen)).toEqual({ focus: '주제/하위' });
    expect(navigate(flat, '주제', 'ArrowUp', allOpen)).toEqual({ focus: '빈' });
    expect(navigate(flat, '빈', 'ArrowUp', allOpen)).toBeNull();
    expect(navigate(flat, 'd', 'ArrowDown', allOpen)).toBeNull();
  });
  it('Home/End', () => {
    expect(navigate(flat, 'c', 'Home', allOpen)).toEqual({ focus: '빈' });
    expect(navigate(flat, 'c', 'End', allOpen)).toEqual({ focus: 'd' });
  });
  it('→ 는 접힌 폴더를 펼치고, 펼쳐진 폴더에서는 첫 자식으로 간다', () => {
    const open = collapsedSet('주제');
    const f = flattenVisible(tree, open);
    expect(navigate(f, '주제', 'ArrowRight', open)).toEqual({ expand: '주제' });
    expect(navigate(flat, '주제', 'ArrowRight', allOpen)).toEqual({ focus: '주제/하위' });
    expect(navigate(flat, 'a', 'ArrowRight', allOpen)).toBeNull();
    // 자식이 없는 펼친 폴더
    expect(navigate(flat, '빈', 'ArrowRight', allOpen)).toBeNull();
  });
  it('← 는 펼친 폴더를 접고, 접힌 폴더·파일에서는 부모로 간다', () => {
    expect(navigate(flat, '주제', 'ArrowLeft', allOpen)).toEqual({ collapse: '주제' });
    const open = collapsedSet('주제/하위');
    const f = flattenVisible(tree, open);
    expect(navigate(f, '주제/하위', 'ArrowLeft', open)).toEqual({ focus: '주제' });
    expect(navigate(flat, 'c', 'ArrowLeft', allOpen)).toEqual({ focus: '주제/하위' });
    expect(navigate(flat, 'a', 'ArrowLeft', allOpen)).toBeNull(); // 최상위 파일
  });
  it('toggleable=false(검색 중)에서는 접고 펼치는 대신 이동만 한다', () => {
    expect(navigate(flat, '주제', 'ArrowLeft', allOpen, false)).toBeNull();
    expect(navigate(flat, '주제/하위', 'ArrowLeft', allOpen, false)).toEqual({ focus: '주제' });
    expect(navigate(flat, '주제', 'ArrowRight', allOpen, false)).toEqual({ focus: '주제/하위' });
  });
  it('목록에 없는 경로·다른 키는 무시한다', () => {
    expect(navigate(flat, '없음', 'ArrowDown', allOpen)).toBeNull();
    expect(navigate(flat, 'a', 'x', allOpen)).toBeNull();
  });
  it('firstChild·parentItem', () => {
    expect(firstChild(flat, '주제')?.path).toBe('주제/하위');
    expect(firstChild(flat, '빈')).toBeNull();
    expect(parentItem(flat, 'c')?.path).toBe('주제/하위');
    expect(parentItem(flat, 'a')).toBeNull();
  });
});

describe('neighborAfterRemove', () => {
  const flat = flattenVisible(tree, allOpen);
  it('폴더를 지우면 그 하위를 건너뛴 다음 항목으로', () => {
    expect(neighborAfterRemove(flat, '주제')).toBe('a');
    expect(neighborAfterRemove(flat, '주제/하위')).toBe('b');
  });
  it('맨 끝이면 바로 위 항목, 없으면 빈 문자열', () => {
    expect(neighborAfterRemove(flat, 'd')).toBe('a');
    expect(neighborAfterRemove(flatten1(), 'x')).toBe('');
  });
  function flatten1() { return flattenVisible([{ name: 'x', path: 'x', type: 'file' }], allOpen); }
});

describe('moveTargets', () => {
  const byPath = (t: ReturnType<typeof moveTargets>) => Object.fromEntries(t.map((x) => [x.path, x]));
  it('최상위와 모든 폴더를 들여쓰기 단계와 함께 나열한다', () => {
    const file = tree.find((n) => n.path === 'a')!;
    const t = moveTargets(tree, file);
    expect(t.map((x) => [x.path, x.depth])).toEqual([['', 0], ['빈', 1], ['주제', 1], ['주제/하위', 2]]);
    expect(t[0].label).toBe('최상위');
  });
  it('현재 부모는 비활성(현재 위치)', () => {
    const file = tree.find((n) => n.path === 'a')!; // 최상위 글
    const t = byPath(moveTargets(tree, file));
    expect(t[''].disabled).toBe(true);
    expect(t[''].note).toBe('현재 위치');
    expect(t['주제'].disabled).toBe(false);
  });
  it('폴더는 자기 자신·하위 폴더·현재 부모를 비활성으로 둔다', () => {
    const dir = tree.find((n) => n.path === '주제')!;
    const t = byPath(moveTargets(tree, dir));
    expect(t['주제'].disabled).toBe(true);
    expect(t['주제/하위'].disabled).toBe(true);
    expect(t[''].disabled).toBe(true); // 이미 최상위
    expect(t['빈'].disabled).toBe(false);
  });
  it('중첩 폴더의 글은 그 폴더만 비활성', () => {
    const file = tree.find((n) => n.path === '주제')!.children!.find((n) => n.path === 'b')!;
    const t = byPath(moveTargets(tree, file));
    expect(t['주제'].disabled).toBe(true);
    expect(t['주제/하위'].disabled).toBe(false);
    expect(t[''].disabled).toBe(false);
  });
  it('이름이 비슷한 폴더는 하위로 오인하지 않는다', () => {
    const nodes = sortTree(buildTree([], ['a', 'ab', 'a/x']), 'name', {});
    const dir = nodes.find((n) => n.path === 'a')!;
    const t = byPath(moveTargets(nodes, dir));
    expect(t['ab'].disabled).toBe(false);
    expect(t['a/x'].disabled).toBe(true);
  });
});

describe('stepEnabled·edgeEnabled', () => {
  const t = [{ disabled: true }, { disabled: false }, { disabled: true }, { disabled: false }];
  it('비활성 줄을 건너뛰고 끝에서 돈다', () => {
    expect(stepEnabled(t, 1, 1)).toBe(3);
    expect(stepEnabled(t, 3, 1)).toBe(1);
    expect(stepEnabled(t, 1, -1)).toBe(3);
    expect(stepEnabled(t, -1, 1)).toBe(1);
  });
  it('활성 줄이 없으면 -1', () => {
    expect(stepEnabled([{ disabled: true }], 0, 1)).toBe(-1);
    expect(edgeEnabled([{ disabled: true }])).toBe(-1);
  });
  it('첫·마지막 활성 줄', () => {
    expect(edgeEnabled(t)).toBe(1);
    expect(edgeEnabled(t, true)).toBe(3);
  });
});
