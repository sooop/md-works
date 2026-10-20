import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate';
import { applyBundleWith, buildBundleWith } from '../../src/lib/bundle/core';
import { cleanSnippet, cleanOrders } from '../../src/lib/bundle/records';
import { detachSnippetsFrom } from '../../src/lib/bundle/docRemoval';
import { standaloneDevice, serverDevice } from './helpers';
import type { Snippet } from '../../src/lib/works/types';

const T = 1_700_000_000_000;
const snip = (id: string, over: Partial<Snippet> = {}): Snippet =>
  ({ id, body: `글감 ${id}`, color: 'yellow', createdAt: T, updatedAt: T, attachedDocs: [], ...over });
const build = async (d: { host: Parameters<typeof buildBundleWith>[0] }, now: number) => (await buildBundleWith(d.host, now)).bytes;

describe('records.cleanOrders', () => {
  it('유한 숫자 값·적당한 길이의 키만 남긴다', () => {
    expect(cleanOrders({ a: 1, b: '2', c: NaN, d: Infinity, e: null, [`${'k'.repeat(1001)}`]: 3, '': 4 })).toEqual({ a: 1 });
    expect(cleanOrders(['x'])).toBeUndefined();
    expect(cleanOrders({})).toBeUndefined();
    expect(cleanOrders('x')).toBeUndefined();
  });
  it('__proto__ 키도 평범한 속성으로 다룬다', () => {
    const o = cleanOrders(JSON.parse('{"__proto__": 3, "a": 1}'))!;
    expect(Object.getPrototypeOf(o)).toBe(Object.prototype);
    expect(Object.keys(o).sort()).toEqual(['__proto__', 'a']);
  });
  it('cleanSnippet: orders 없는 기존 레코드도 통과', () => {
    const s = cleanSnippet({ id: 'a', updatedAt: 1, body: 'x', attachedDocs: [] })!;
    expect(s.orders).toBeUndefined();
    expect(cleanSnippet({ id: 'a', updatedAt: 1, body: 'x', orders: { d: 2 } })!.orders).toEqual({ d: 2 });
  });
});

describe('번들 왕복·병합', () => {
  it('스탠드얼론 → 번들: orders 키가 글 이름이 되고, 다른 기기에서 그 기기의 docKey 로 풀린다', async () => {
    const A = standaloneDevice();
    const B = standaloneDevice();
    await A.putDoc('글.md', '본문', T);
    const ka = (await A.key('글.md'))!;
    await A.store.put('snippets', snip('s1', { attachedDocs: [ka], orders: { [ka]: 2.5, 'ghost-key': 9 } }));
    const bytes = await build(A, T + 1);
    const raw = JSON.parse(strFromU8(unzipSync(bytes)['.works/snippets/_/s1.json']));
    expect(raw.orders).toEqual({ '글.md': 2.5 }); // 알 수 없는 글의 키는 버림
    expect(raw.attachedDocs).toEqual(['글.md']);

    await applyBundleWith(B.host, bytes, {}, T + 2);
    const kb = (await B.key('글.md'))!;
    expect(kb).not.toBe(ka);
    expect((await B.store.get<Snippet>('snippets', 's1'))!.orders).toEqual({ [kb]: 2.5 });
  });
  it('서버 → 스탠드얼론: 경로 키 ↔ 이름', async () => {
    const S = await serverDevice();
    const B = standaloneDevice();
    await S.putDoc('글.md', '본문', T);
    const ks = (await S.key('글.md'))!;
    await S.store.put('snippets', snip('s1', { attachedDocs: [ks], orders: { [ks]: -3 } }));
    await applyBundleWith(B.host, await build(S, T + 1), {}, T + 2);
    const kb = (await B.key('글.md'))!;
    expect((await B.store.get<Snippet>('snippets', 's1'))!.orders).toEqual({ [kb]: -3 });
  });
  it('orders 없는 기존 번들도 정상 가져오기', async () => {
    const B = standaloneDevice();
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify({ schema: 'md-works-bundle', version: 1, createdAt: T, mode: 'standalone', app: 'md-works' })),
      '글.md': strToU8('본문'),
      '.works/docs.json': strToU8(JSON.stringify({ '글.md': { updatedAt: T } })),
      '.works/snippets/_/s1.json': strToU8(JSON.stringify(snip('s1', { attachedDocs: ['글.md'] }))),
    });
    const r = await applyBundleWith(B.host, zip, {}, T + 2);
    expect(r.snippets).toBe(1);
    const s = (await B.store.get<Snippet>('snippets', 's1'))!;
    expect(s.attachedDocs).toEqual([(await B.key('글.md'))!]);
    expect(s.orders).toBeUndefined();
  });
  it('두 기기에서 서로 다른 글감을 옮기면 각 글감은 updatedAt 최신 쪽 값을 갖는다', async () => {
    const A = standaloneDevice();
    const B = standaloneDevice();
    await A.putDoc('글.md', '본문', T);
    const ka = (await A.key('글.md'))!;
    for (const id of ['s1', 's2', 's3']) await A.store.put('snippets', snip(id, { attachedDocs: [ka], orders: { [ka]: ['s1', 's2', 's3'].indexOf(id) } }));
    await applyBundleWith(B.host, await build(A, T + 1), {}, T + 2);
    const kb = (await B.key('글.md'))!;

    // A 가 s1 을 옮김(T+100), B 가 s3 을 옮김(T+200). s2 는 양쪽 모두 그대로
    await A.store.put('snippets', snip('s1', { attachedDocs: [ka], orders: { [ka]: 10 }, updatedAt: T + 100 }));
    await B.store.put('snippets', snip('s3', { attachedDocs: [kb], orders: { [kb]: -5 }, updatedAt: T + 200 }));
    // 같은 글감을 양쪽에서 옮긴 경우: s2 는 B 쪽이 더 최근
    await A.store.put('snippets', snip('s2', { attachedDocs: [ka], orders: { [ka]: 50 }, updatedAt: T + 150 }));
    await B.store.put('snippets', snip('s2', { attachedDocs: [kb], orders: { [kb]: 60 }, updatedAt: T + 160 }));

    await applyBundleWith(B.host, await build(A, T + 300), {}, T + 301);
    const at = async (id: string) => (await B.store.get<Snippet>('snippets', id))!.orders![kb];
    expect(await at('s1')).toBe(10); // A 가 최신
    expect(await at('s2')).toBe(60); // B 가 최신 (그대로)
    expect(await at('s3')).toBe(-5); // B 만 바꿈 (A 의 옛 값에 덮이지 않음)
  });
  it('글 삭제(번들 docRemoval)는 orders 키도 지운다', async () => {
    const A = standaloneDevice();
    await A.store.put('snippets', snip('s1', { attachedDocs: ['k1', 'k2'], orders: { k1: 1, k2: 2 } }));
    await detachSnippetsFrom(A.store, 'k1');
    const s = (await A.store.get<Snippet>('snippets', 's1'))!;
    expect(s.attachedDocs).toEqual(['k2']);
    expect(s.orders).toEqual({ k2: 2 });
    await detachSnippetsFrom(A.store, 'k2');
    expect((await A.store.get<Snippet>('snippets', 's1'))!.orders).toBeUndefined();
  });
});
