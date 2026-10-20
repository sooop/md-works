import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { useWorksStore, worksStore } from '../../src/lib/works/store';
import { createIdbStore } from '../../src/lib/works/idbStore';
import {
  createSnippet, attachSnippet, detachSnippet, trashSnippet, restoreSnippet, reorderSnippets, setSnippetColors, trashSnippets,
  reattachDoc, reattachPrefix, listSnippets, listTrashedSnippets,
} from '../../src/lib/works/snippets';
import { topOrder, sortForDoc, moveBlock, shiftBlock, assignOrders, mapOrderKeys, MIN_GAP } from '../../src/lib/works/snippetOrder';
import { filterSnippets } from '../../src/lib/snippets/filter';
import { rangeIds, toggleId, addRange, pruneSelection, inListOrder } from '../../src/lib/snippets/selection';
import type { Snippet } from '../../src/lib/works/types';

let n = 0;
beforeEach(() => useWorksStore(createIdbStore(`snip-order-${n++}`)));

const sn = (id: string, over: Partial<Snippet> = {}): Snippet =>
  ({ id, body: id, color: 'yellow', createdAt: 1, updatedAt: 1, attachedDocs: [], ...over });
const get = async (id: string) => (await worksStore().get<Snippet>('snippets', id))!;

describe('순서 값 계산', () => {
  it('맨 위 삽입: 최소값 − 1, 값이 없으면 0', () => {
    expect(topOrder([], 'a')).toBe(0);
    expect(topOrder([sn('x', { orders: { a: 5 } }), sn('y', { orders: { a: -2, b: -9 } })], 'a')).toBe(-3);
  });
  it('sortForDoc: 값 없는 것이 맨 위(최근 수정 순), 그다음 오름차순', () => {
    const list = [
      sn('p', { orders: { d: 2 } }), sn('q', { orders: { d: 1 } }), sn('old', { updatedAt: 5 }), sn('new', { updatedAt: 9 }),
      sn('tie', { orders: { d: 2 }, updatedAt: 7 }),
    ];
    expect(sortForDoc(list, 'd').map((s) => s.id)).toEqual(['new', 'old', 'q', 'tie', 'p']);
  });
  it('새로 붙이면 그 글의 맨 위, 떼면 키가 지워진다', async () => {
    const a = await createSnippet({ body: 'a', attachTo: ['d.md'] });
    const b = await createSnippet({ body: 'b', attachTo: ['d.md'] });
    expect(a.orders).toEqual({ 'd.md': 0 });
    expect(b.orders).toEqual({ 'd.md': -1 });
    const c = await createSnippet({ body: 'c' });
    expect(c.orders).toBeUndefined();
    const c2 = await attachSnippet(c.id, 'd.md');
    expect(c2.orders).toEqual({ 'd.md': -2 });
    const c3 = await detachSnippet(c.id, 'd.md');
    expect(c3.orders).toBeUndefined();
    expect(c3.attachedDocs).toEqual([]);
  });
  it('휴지통에서도 orders 가 보존되고 복구하면 그대로 돌아온다', async () => {
    const a = await createSnippet({ body: 'a', attachTo: ['d.md'] });
    await trashSnippet(a.id);
    expect((await get(a.id)).orders).toEqual({ 'd.md': 0 });
    const r = await restoreSnippet(a.id);
    expect(r.orders).toEqual({ 'd.md': 0 });
    expect(r.attachedDocs).toEqual(['d.md']);
  });
});

describe('moveBlock', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  it('한 장을 앞/뒤로', () => {
    expect(moveBlock(ids, ['d'], 1)).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(moveBlock(ids, ['b'], 4)).toEqual(['a', 'c', 'd', 'b', 'e']);
    expect(moveBlock(ids, ['a'], 5)).toEqual(['b', 'c', 'd', 'e', 'a']);
    expect(moveBlock(ids, ['e'], 0)).toEqual(['e', 'a', 'b', 'c', 'd']);
  });
  it('불연속 여러 장은 현재 상대 순서를 유지한 채 함께 이동', () => {
    expect(moveBlock(ids, ['d', 'b'], 0)).toEqual(['b', 'd', 'a', 'c', 'e']);
    expect(moveBlock(ids, ['a', 'e'], 3)).toEqual(['b', 'c', 'a', 'e', 'd']);
  });
  it('같은 위치면 그대로', () => {
    expect(moveBlock(ids, ['c'], 2)).toEqual(ids);
    expect(moveBlock(ids, ['c'], 3)).toEqual(ids);
    expect(moveBlock(ids, ['b', 'c'], 1)).toEqual(ids);
  });
  it('shiftBlock: 각 카드를 한 칸씩, 끝이나 선택끼리는 그대로', () => {
    expect(shiftBlock(ids, ['c'], -1)).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(shiftBlock(ids, ['a'], -1)).toEqual(ids);
    expect(shiftBlock(ids, ['b', 'd'], 1)).toEqual(['a', 'c', 'b', 'e', 'd']);
    expect(shiftBlock(ids, ['b', 'c'], 1)).toEqual(['a', 'd', 'b', 'c', 'e']);
  });
});

describe('assignOrders', () => {
  const vals: Record<string, number | undefined> = { a: 1, b: 2, c: 3, d: 4 };
  const cur = (id: string) => vals[id];
  const apply = (ids: string[], ch: { id: string; order: number }[]) => {
    const m = new Map(ids.map((i) => [i, vals[i]]));
    for (const c of ch) m.set(c.id, c.order);
    return [...m].sort((x, y) => x[1]! - y[1]!).map(([i]) => i);
  };
  const old = ['a', 'b', 'c', 'd'];

  it('같은 위치면 변경 없음', () => {
    expect(assignOrders(old, old, ['b'], cur)).toEqual([]);
    expect(assignOrders(old, moveBlock(old, ['b'], 2), ['b'], cur)).toEqual([]);
  });
  it('옮긴 한 장만 바뀐다(중간값)', () => {
    const next = moveBlock(old, ['d'], 1);
    const ch = assignOrders(old, next, ['d'], cur);
    expect(ch).toEqual([{ id: 'd', order: 1.5 }]);
    expect(apply(old, ch)).toEqual(next);
  });
  it('맨 위/맨 아래로', () => {
    expect(assignOrders(old, ['c', 'a', 'b', 'd'], ['c'], cur)).toEqual([{ id: 'c', order: 0 }]);
    expect(assignOrders(old, ['b', 'c', 'd', 'a'], ['a'], cur)).toEqual([{ id: 'a', order: 5 }]);
  });
  it('불연속 여러 장: 옮긴 것만 바뀌고 결과 순서가 맞다', () => {
    const next = moveBlock(old, ['a', 'c'], 4);
    const ch = assignOrders(old, next, ['a', 'c'], cur);
    expect(ch.map((c) => c.id).sort()).toEqual(['a', 'c']);
    expect(apply(old, ch)).toEqual(next);
  });
  it('값이 없는 글감(맨 위)이 섞여 있어도 일관된 값을 준다', () => {
    const v2: Record<string, number | undefined> = { x: undefined, y: undefined, a: 10, b: 20 };
    const ids = ['x', 'y', 'a', 'b'];
    const next = moveBlock(ids, ['b'], 0);
    const ch = assignOrders(ids, next, ['b'], (i) => v2[i]);
    const m = new Map(Object.entries(v2));
    for (const c of ch) m.set(c.id, c.order);
    expect(next.map((i) => m.get(i))).toEqual([...next.map((i) => m.get(i))].sort((p, q) => p! - q!));
    expect(next.every((i) => m.get(i) !== undefined)).toBe(true);
  });
  it('간격이 1e-6 미만이면 1..n 으로 재번호', () => {
    const tight: Record<string, number> = { a: 1, b: 1 + MIN_GAP / 4, c: 2, d: 3 };
    const ids = ['a', 'b', 'c', 'd'];
    const ch = assignOrders(ids, ['a', 'd', 'b', 'c'], ['d'], (i) => tight[i]);
    // d 를 a 와 b 사이(간격 2.5e-7)에 넣어야 하므로 재번호
    const m = new Map(ids.map((i) => [i, tight[i]]));
    for (const c of ch) m.set(c.id, c.order);
    expect(['a', 'd', 'b', 'c'].map((i) => m.get(i))).toEqual([1, 2, 3, 4].map((x, k) => (k === 0 ? 1 : x)));
    expect(ch.find((c) => c.id === 'a')).toBeUndefined(); // 이미 1 인 것은 변경 목록에서 빠진다
  });
});

describe('저장: reorderSnippets·일괄 작업', () => {
  it('바뀐 글감만 updatedAt 을 갱신한다', async () => {
    const a = await createSnippet({ body: 'a', attachTo: ['d.md'] });
    const b = await createSnippet({ body: 'b', attachTo: ['d.md'] });
    const before = await get(a.id);
    await new Promise((r) => setTimeout(r, 5));
    expect(await reorderSnippets('d.md', [{ id: b.id, order: 7 }])).toBe(1);
    expect((await get(b.id)).orders).toEqual({ 'd.md': 7 });
    expect((await get(b.id)).updatedAt).toBeGreaterThan(b.updatedAt);
    expect((await get(a.id)).updatedAt).toBe(before.updatedAt);
  });
  it('다른 글의 순서 값은 건드리지 않는다', async () => {
    const a = await createSnippet({ body: 'a', attachTo: ['d.md', 'e.md'] });
    await reorderSnippets('d.md', [{ id: a.id, order: 9 }]);
    expect((await get(a.id)).orders).toEqual({ 'd.md': 9, 'e.md': 0 });
  });
  it('보기: 글별 순서로 나온다', async () => {
    const a = await createSnippet({ body: 'a', attachTo: ['d.md'] });
    const b = await createSnippet({ body: 'b', attachTo: ['d.md'] }); // b 가 위
    const f = (docKey: string) => filterSnippets([a, b].map((s) => ({ ...s })), [], { view: 'doc', docKey, color: '', query: '' }).map((s) => s.id);
    expect(f('d.md')).toEqual([b.id, a.id]);
    await reorderSnippets('d.md', [{ id: b.id, order: 5 }]);
    const list = await listSnippets();
    expect(filterSnippets(list, [], { view: 'doc', docKey: 'd.md', color: 'yellow', query: '' }).map((s) => s.id)).toEqual([a.id, b.id]);
  });
  it('일괄 색 변경: 한 번에 모두 바꾸고 휴지통 글감은 건너뛴다', async () => {
    const a = await createSnippet({ body: 'a' });
    const b = await createSnippet({ body: 'b' });
    const c = await createSnippet({ body: 'c' });
    await trashSnippet(c.id);
    expect(await setSnippetColors([a.id, b.id, c.id], 'blue')).toBe(2);
    expect((await get(a.id)).color).toBe('blue');
    expect((await get(b.id)).color).toBe('blue');
    expect((await get(c.id)).color).toBe('yellow');
  });
  it('일괄 휴지통: putMany 한 번, 복구 시 붙은 글·순서 보존', async () => {
    const a = await createSnippet({ body: 'a', attachTo: ['d.md'] });
    const b = await createSnippet({ body: 'b', attachTo: ['d.md'] });
    const store = worksStore();
    let calls = 0;
    const orig = store.putMany.bind(store);
    store.putMany = (async (...args: Parameters<typeof orig>) => { calls++; return orig(...args); }) as typeof orig;
    expect(await trashSnippets([a.id, b.id, 'nope'])).toBe(2);
    store.putMany = orig;
    expect(calls).toBe(1);
    expect((await listSnippets()).length).toBe(0);
    expect((await listTrashedSnippets()).length).toBe(2);
    const r = await restoreSnippet(a.id);
    expect(r.attachedDocs).toEqual(['d.md']);
    expect(r.orders).toEqual({ 'd.md': 0 });
  });
});

describe('글 이름 변경·삭제 시 orders 키', () => {
  it('reattachDoc: 이름 변경이면 키를 옮기고, 삭제면 지운다', async () => {
    const a = await createSnippet({ body: 'a', attachTo: ['old.md', 'k.md'] });
    await reattachDoc('old.md', 'new.md');
    let s = await get(a.id);
    expect(s.attachedDocs).toEqual(['new.md', 'k.md']);
    expect(s.orders).toEqual({ 'new.md': 0, 'k.md': 0 });
    await reattachDoc('new.md');
    s = await get(a.id);
    expect(s.attachedDocs).toEqual(['k.md']);
    expect(s.orders).toEqual({ 'k.md': 0 });
  });
  it('휴지통의 글감도 키가 따라간다', async () => {
    const a = await createSnippet({ body: 'a', attachTo: ['old.md'] });
    await trashSnippet(a.id);
    await reattachDoc('old.md', 'new.md');
    const s = await get(a.id);
    expect(s.trashedFrom).toEqual(['new.md']);
    expect(s.orders).toEqual({ 'new.md': 0 });
  });
  it('reattachPrefix: 폴더 이름 변경', async () => {
    const a = await createSnippet({ body: 'a', attachTo: ['dir/a.md', 'dir2/b.md'] });
    await reattachPrefix('dir', 'moved');
    expect((await get(a.id)).orders).toEqual({ 'moved/a.md': 0, 'dir2/b.md': 0 });
    await reattachPrefix('moved');
    expect((await get(a.id)).orders).toEqual({ 'dir2/b.md': 0 });
  });
  it('mapOrderKeys: 버림·충돌·빈 결과', () => {
    expect(mapOrderKeys({ a: 1, b: 2 }, (k) => (k === 'a' ? 'x' : undefined))).toEqual({ x: 1 });
    expect(mapOrderKeys({ a: 1, b: 2 }, () => undefined)).toBeUndefined();
    expect(mapOrderKeys({ a: 1, b: 2 }, () => 'same')).toEqual({ same: 1 });
    expect(mapOrderKeys(undefined, (k) => k)).toBeUndefined();
  });
});

describe('선택 범위 계산', () => {
  const vis = ['a', 'b', 'c', 'd', 'e'];
  it('Shift 범위: 방향 무관, 기준이 없으면 한 장', () => {
    expect(rangeIds(vis, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(vis, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(vis, '', 'c')).toEqual(['c']);
    expect(rangeIds(vis, 'a', 'zz')).toEqual([]);
  });
  it('Shift 범위는 기존 선택에 더한다', () => {
    expect(addRange(['e'], vis, 'a', 'b')).toEqual(['e', 'a', 'b']);
  });
  it('Ctrl 토글', () => {
    expect(toggleId(['a'], 'c')).toEqual(['a', 'c']);
    expect(toggleId(['a', 'c'], 'a')).toEqual(['c']);
  });
  it('목록이 바뀌면 사라진 카드를 정리(바뀐 것이 없으면 같은 배열)', () => {
    const sel = ['a', 'c'];
    expect(pruneSelection(sel, vis)).toBe(sel);
    expect(pruneSelection(sel, ['c', 'x'])).toEqual(['c']);
    expect(pruneSelection(sel, [])).toEqual([]);
  });
  it('선택을 목록 순서로', () => {
    expect(inListOrder(['d', 'a', 'zz'], vis)).toEqual(['a', 'd']);
  });
});
