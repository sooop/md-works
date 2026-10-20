import { describe, it, expect } from 'vitest';
import { buildTree, sortTree, reorder, renameInOrders, withParents, splitPath, type FlatDoc } from '../src/lib/docTree';

const docs: FlatDoc[] = [
  { id: 'a', name: '가.md', folder: '', updated: 10 },
  { id: 'b', name: '나.md', folder: '주제', updated: 30 },
  { id: 'c', name: '다.md', folder: '주제/하위', updated: 20 },
  { id: 'd', name: '라.md', folder: '', updated: 40 },
];

describe('buildTree', () => {
  it('폴더 경로로 트리를 만들고 빈 폴더도 둔다', () => {
    const t = buildTree(docs, ['빈 폴더']);
    expect(t.map((n) => `${n.type}:${n.name}`).sort()).toEqual(['dir:빈 폴더', 'dir:주제', 'file:가.md', 'file:라.md']);
    const topic = t.find((n) => n.name === '주제')!;
    expect(topic.children!.map((n) => n.name).sort()).toEqual(['나.md', '하위']);
    expect(topic.children!.find((n) => n.name === '하위')!.children![0]).toMatchObject({ path: 'c', dir: '주제/하위', type: 'file' });
  });
});

describe('sortTree', () => {
  it('이름순: 폴더가 먼저, 숫자는 자연 정렬', () => {
    const t = sortTree(buildTree([{ id: '1', name: '글 10.md', folder: '', updated: 0 }, { id: '2', name: '글 2.md', folder: '', updated: 0 }], ['폴더']), 'name', {});
    expect(t.map((n) => n.name)).toEqual(['폴더', '글 2.md', '글 10.md']);
  });
  it('수정일순: 최근 것이 위', () => {
    const t = sortTree(buildTree(docs, []), 'mtime', {});
    expect(t.filter((n) => n.type === 'file').map((n) => n.name)).toEqual(['라.md', '가.md']);
  });
  it('직접 순서: 목록에 있는 이름이 먼저, 없는 것은 이름순으로 뒤에', () => {
    const t = sortTree(buildTree(docs, []), 'manual', { '': ['라.md'] });
    expect(t.filter((n) => n.type === 'file').map((n) => n.name)).toEqual(['라.md', '가.md']);
  });
});

describe('reorder', () => {
  it('앞에 끼운다', () => expect(reorder(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']));
  it('before 가 없으면 맨 뒤', () => expect(reorder(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']));
});

describe('renameInOrders', () => {
  it('같은 부모에서 이름만 바뀌면 목록의 이름을 바꾼다', () => {
    expect(renameInOrders({ '': ['x', 'y'] }, 'y', 'z')).toEqual({ '': ['x', 'z'] });
  });
  it('폴더 이름이 바뀌면 하위 키도 따라간다', () => {
    expect(renameInOrders({ a: ['1'], 'a/b': ['2'] }, 'a', 'c')).toEqual({ c: ['1'], 'c/b': ['2'] });
  });
  it('다른 폴더로 옮기면 옛 목록에서 뺀다', () => {
    expect(renameInOrders({ a: ['x', 'y'] }, 'a/x', 'b/x')).toEqual({ a: ['y'] });
  });
});

describe('경로 도우미', () => {
  it('withParents / splitPath', () => {
    expect(withParents('a/b')).toEqual(['a', 'a/b']);
    expect(splitPath('a/b/c.md')).toEqual({ folder: 'a/b', name: 'c.md' });
    expect(splitPath('c.md')).toEqual({ folder: '', name: 'c.md' });
  });
});

import { ordersOf } from '../src/lib/docTree';
describe('ordersOf', () => {
  it('정렬된 트리의 보이는 순서를 폴더별로 옮긴다', () => {
    const t = sortTree(buildTree(docs, []), 'mtime', {});
    expect(ordersOf(t)).toEqual({ '': ['주제', '라.md', '가.md'], '주제': ['하위', '나.md'], '주제/하위': ['다.md'] });
  });
});
