import { describe, it, expect } from 'vitest';
import { renamedPaths, type TreeInfo } from '../src/lib/treeRename';

const m = (o: Record<string, TreeInfo>) => new Map(Object.entries(o));
const f = (parent: string, sig: string): TreeInfo => ({ type: 'file', parent, sig });
const d = (parent: string, sig: string): TreeInfo => ({ type: 'dir', parent, sig });

describe('renamedPaths', () => {
  it('같은 자리에서 이름만 바뀐 글은 옛·새 경로가 모두 조용하다', () => {
    const q = renamedPaths(m({ 'a.md': f('', '1'), 'z.md': f('', '9') }), m({ 'b.md': f('', '1'), 'z.md': f('', '9') }));
    expect([...q].sort()).toEqual(['a.md', 'b.md']);
  });
  it('폴더 이름 바꾸기는 하위 경로까지 포함', () => {
    const prev = m({ A: d('', 's'), 'A/x.md': f('A', '1') });
    const cur = m({ B: d('', 's'), 'B/x.md': f('B', '1') });
    expect([...renamedPaths(prev, cur)].sort()).toEqual(['A', 'A/x.md', 'B', 'B/x.md']);
  });
  it('후보가 둘 이상이면 이름 바꾸기로 보지 않는다', () => {
    const prev = m({ 'a.md': f('', '1'), 'b.md': f('', '1') });
    const cur = m({ 'c.md': f('', '1'), 'd.md': f('', '1') });
    expect(renamedPaths(prev, cur).size).toBe(0);
  });
  it('종류·부모·서명이 다르면 짝이 아니다', () => {
    expect(renamedPaths(m({ 'a.md': f('', '1') }), m({ 'b.md': f('', '2') })).size).toBe(0);
    expect(renamedPaths(m({ 'a.md': f('', '1') }), m({ 'b.md': d('', '1') })).size).toBe(0);
    expect(renamedPaths(m({ 'a.md': f('', '1') }), m({ 'x/b.md': f('x', '1') })).size).toBe(0);
  });
  it('접두만 같은 형제 경로는 하위로 보지 않는다', () => {
    const prev = m({ A: d('', 's'), 'AB.md': f('', '5') });
    const cur = m({ B: d('', 's'), 'AB.md': f('', '5') });
    expect([...renamedPaths(prev, cur)].sort()).toEqual(['A', 'B']);
  });
  it('수천 항목도 선형 시간에 끝난다', () => {
    const prev = new Map<string, TreeInfo>(), cur = new Map<string, TreeInfo>();
    for (let i = 0; i < 5000; i++) { prev.set(`o${i}.md`, f('', String(i))); cur.set(`n${i}.md`, f('', String(i))); }
    const t = performance.now();
    expect(renamedPaths(prev, cur).size).toBe(10000);
    expect(performance.now() - t).toBeLessThan(500);
  });
});
