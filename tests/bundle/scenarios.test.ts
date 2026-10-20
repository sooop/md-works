import { describe, it, expect, vi } from 'vitest';
import { applyBundleWith, buildBundleWith, previewBundleWith } from '../../src/lib/bundle/core';
import { standaloneDevice, serverDevice, ver } from './helpers';
import { useWorksStore } from '../../src/lib/works/store';
import { listSnippets, listTrashedSnippets, purgeSnippet, trashSnippet } from '../../src/lib/works/snippets';
import { deleteThread, listThreads } from '../../src/lib/comments/threads';
import { defaultDesign, serializeDesign } from '../../src/lib/design';
import type { Snippet, Thread } from '../../src/lib/works/types';

const T = 1_700_000_000_000;
const snip = (id: string, over: Partial<Snippet> = {}): Snippet =>
  ({ id, body: `글감 ${id}`, color: 'yellow', createdAt: T, updatedAt: T, attachedDocs: [], ...over });
const thread = (id: string, docKey: string, over: Partial<Thread> = {}): Thread => ({
  id, docKey, anchor: { quote: '인용', prefix: '', suffix: '' }, messages: [{ id: 'm' + id, text: '메시지', ts: T }],
  resolved: false, createdAt: T, updatedAt: T, ...over,
});
const build = async (d: { host: Parameters<typeof buildBundleWith>[0] }, now: number) => (await buildBundleWith(d.host, now)).bytes;
const preMerge = <T extends { name?: string }>(vs: T[]) => vs.filter((v) => v.name?.startsWith('병합 전('));

describe('두 기기 시나리오', () => {
  it('A 에서 만든 글·글감·이력을 B 에 병합하고, B 에서 수정한 것을 A 에 역병합한다', async () => {
    const A = standaloneDevice();
    const B = standaloneDevice();
    // A: 글 하나 + 글감 + 스레드 + 이력
    const ka = (await A.putDoc('글.md', '첫 판', T), (await A.key('글.md'))!);
    await A.store.put('versions', ver('va1', ka, '첫 판', T), ka);
    await A.store.put('threads', thread('t1', ka), ka);
    await A.store.put('snippets', snip('s1', { attachedDocs: [ka] }));
    const r1 = await applyBundleWith(B.host, await build(A, T + 1), {}, T + 2);
    expect(r1).toMatchObject({ docsAdded: 1, snippets: 1, threads: 1, versions: 1 });
    const kb = (await B.key('글.md'))!;
    expect(kb).not.toBe(ka); // 기기마다 id 가 다르다
    expect((await B.store.get<Snippet>('snippets', 's1'))!.attachedDocs).toEqual([kb]);

    // B: 수정(시각이 더 나중) + 새 글감 + 기존 글감 수정 + 새 스레드 + 새 이력
    await B.putDoc('글.md', '둘째 판', T + 100);
    await B.store.put('snippets', snip('s1', { body: '수정된 글감', updatedAt: T + 50, attachedDocs: [kb] }));
    await B.store.put('snippets', snip('s3', { updatedAt: T + 60, attachedDocs: [kb] }));
    await B.store.put('threads', thread('t2', kb, { updatedAt: T + 70 }), kb);
    await B.store.put('versions', ver('vb1', kb, '둘째 판', T + 100), kb);
    const bundleB = await build(B, T + 200);

    // 미리보기는 아무것도 바꾸지 않는다
    const pre = await previewBundleWith(A.host, bundleB, T + 300);
    expect(pre.docs).toEqual([{ name: '글.md', action: 'update' }]);
    expect(pre.snippets).toEqual({ add: 1, update: 1, same: 0, keepLocal: 0 });
    expect(pre.threads).toEqual({ add: 1, update: 0, same: 1, keepLocal: 0 });
    expect(pre.versions).toEqual({ add: 1, same: 1 }); // vb1 만 새것, va1 은 이미 있다
    expect(await A.doc('글.md')).toBe('첫 판');

    const r2 = await applyBundleWith(A.host, bundleB, {}, T + 300);
    expect(r2).toMatchObject({ docsAdded: 0, docsUpdated: 1, conflicts: [], snippets: 2, threads: 1 });
    expect(await A.doc('글.md')).toBe('둘째 판');
    expect((await A.store.get<Snippet>('snippets', 's1'))!.body).toBe('수정된 글감');
    expect((await A.store.get<Snippet>('snippets', 's3'))!.attachedDocs).toEqual([ka]); // B 의 id 가 아니라 A 의 id
    expect((await A.store.list<Thread>('threads', ka)).map((t) => t.id).sort()).toEqual(['t1', 't2']);
    // 진 쪽(A 의 옛 본문)은 '병합 전' 이력으로 남는다. 이미 같은 내용의 이력(va1)이 있으면 그 버전에 이름만 붙는다
    const vs = await A.versions('글.md');
    expect(preMerge(vs)).toHaveLength(1);
    expect(preMerge(vs)[0].text).toBe('첫 판');
    expect(preMerge(vs)[0].id).toBe('va1');
    expect(vs.map((v) => v.id)).toContain('vb1');
    expect(vs.some((v) => v.text === '둘째 판')).toBe(true);

    // 두 기기가 같은 상태로 수렴한다: 서로의 번들을 다시 가져오면 바뀌는 것이 없다
    const again = await previewBundleWith(A.host, bundleB, T + 400);
    expect(again.docs.every((d) => d.action === 'same')).toBe(true);
    expect(again.snippets).toMatchObject({ add: 0, update: 0 });
    const back = await previewBundleWith(B.host, await build(A, T + 500), T + 600);
    expect(back.docs.every((d) => d.action === 'same')).toBe(true);
    expect(back.snippets).toMatchObject({ add: 0, update: 0 });
    expect(back.threads).toMatchObject({ add: 0, update: 0 });
    expect(back.versions.add).toBe(0);
  });

  it('로컬이 더 최신이면 keep-local: 로컬을 지키고 번들(옛) 내용은 병합 전 버전으로 남는다 — 되풀이해도 늘지 않는다', async () => {
    const A = standaloneDevice();
    const B = standaloneDevice();
    await A.putDoc('글.md', '옛 본문', T);
    await B.putDoc('글.md', '새 본문', T + 100);
    const bundleA = await build(A, T + 200);
    const pre = await previewBundleWith(B.host, bundleA, T + 300);
    expect(pre.docs).toEqual([{ name: '글.md', action: 'keep-local' }]);
    const res = await applyBundleWith(B.host, bundleA, {}, T + 300);
    expect(res).toMatchObject({ docsAdded: 0, docsUpdated: 0, conflicts: [] });
    expect(await B.doc('글.md')).toBe('새 본문');
    const vs = await B.versions('글.md');
    expect(preMerge(vs).map((v) => v.text)).toEqual(['옛 본문']);
    expect(preMerge(vs)[0].ts).toBe(T); // 그 내용이 마지막으로 바뀐 시각
    await applyBundleWith(B.host, bundleA, {}, T + 400);
    expect(preMerge(await B.versions('글.md'))).toHaveLength(1);
  });

  it('번들이 더 최신이면 update: 로컬의 옛 본문이 병합 전 버전으로 남는다(이력에 없던 내용도)', async () => {
    const A = standaloneDevice();
    const B = standaloneDevice();
    await A.putDoc('글.md', '새 본문', T + 100);
    await B.putDoc('글.md', '로컬 본문', T);
    const res = await applyBundleWith(B.host, await build(A, T + 200), {}, T + 300);
    expect(res).toMatchObject({ docsUpdated: 1, conflicts: [] });
    expect(await B.doc('글.md')).toBe('새 본문');
    expect(preMerge(await B.versions('글.md')).map((v) => v.text)).toEqual(['로컬 본문']);
    // 수정 시각은 번들의 것을 이어받는다 → 다음 비교에서 로컬이 더 최신으로 오인되지 않는다
    expect((await B.host.listDocs())[0].updatedAt).toBe(T + 100);
  });
});

describe('충돌 분류와 병합 전 버전', () => {
  it('같은 시각에 다르게 바뀐 글은 conflict: 로컬을 지키고 번들 내용을 병합 전 버전에 보존한다', async () => {
    const A = standaloneDevice();
    const B = standaloneDevice();
    await A.putDoc('글.md', 'A 쪽 본문', T);
    await B.putDoc('글.md', 'B 쪽 본문', T);
    await A.putDoc('같음.md', '동일', T);
    await B.putDoc('같음.md', '동일', T + 5);
    const bundleA = await build(A, T + 1);
    const pre = await previewBundleWith(B.host, bundleA, T + 2);
    expect(pre.docs).toEqual([{ name: '같음.md', action: 'same' }, { name: '글.md', action: 'conflict' }]);
    const res = await applyBundleWith(B.host, bundleA, {}, new Date(2026, 9, 5, 12).getTime());
    expect(res.conflicts).toEqual(['글.md']);
    expect(res.docsUpdated).toBe(0);
    expect(await B.doc('글.md')).toBe('B 쪽 본문');
    const vs = await B.versions('글.md');
    expect(preMerge(vs)).toHaveLength(1);
    expect(preMerge(vs)[0]).toMatchObject({ text: 'A 쪽 본문', name: '병합 전(2026-10-05)' });
    expect(await B.versions('같음.md')).toEqual([]); // 같은 글에는 버전을 만들지 않는다
  });

  it('번들에 수정 시각이 없으면(서버 폴더를 그냥 압축한 경우 등) conflict', async () => {
    const A = standaloneDevice();
    await A.putDoc('글.md', '번들 본문', T);
    const bytes = await build(A, T);
    const { unzipSync, zipSync } = await import('fflate');
    const f = unzipSync(bytes);
    delete f['.works/docs.json'];
    const B = standaloneDevice();
    await B.putDoc('글.md', '로컬 본문', T + 1);
    const pre = await previewBundleWith(B.host, zipSync(f), T + 2);
    expect(pre.docs).toEqual([{ name: '글.md', action: 'conflict' }]);
  });

  it('로컬에서 이미 이름 붙인 버전과 같은 내용이면 그대로 둔다(사용자가 붙인 이름을 덮지 않는다)', async () => {
    const A = standaloneDevice();
    const B = standaloneDevice();
    await A.putDoc('글.md', '옛 본문', T);
    await B.putDoc('글.md', '새 본문', T + 100);
    const kb = (await B.key('글.md'))!;
    await B.store.put('versions', ver('mine', kb, '옛 본문', T, { name: '내가 붙인 이름' }), kb);
    await applyBundleWith(B.host, await build(A, T + 1), {}, T + 2);
    const vs = await B.versions('글.md');
    expect(vs.map((v) => [v.id, v.name])).toEqual([['mine', '내가 붙인 이름']]);
  });

  it('병합 후 이력에 솎아내기를 다시 돌려도 병합 전 버전은 영구 보존된다', async () => {
    const A = standaloneDevice();
    const B = standaloneDevice();
    const now = T + 30 * 24 * 3600_000;
    await A.putDoc('글.md', '번들 본문', now);
    await B.putDoc('글.md', '로컬 본문', now - 1000);
    const kb = (await B.key('글.md'))!;
    // 오래된 같은 날의 일반 버전들 — 솎아내기 대상
    const ka = (await A.key('글.md'))!;
    await A.store.put('versions', ver('ra', ka, '번들 이력', now - 5000), ka); // 이력 파티션이 번들에 있어야 합쳐진 이력을 다시 솎아낸다
    await B.store.putMany('versions', [ver('o1', kb, 'a', T + 1000), ver('o2', kb, 'b', T + 2000), ver('o3', kb, 'c', T + 3000)], kb);
    await applyBundleWith(B.host, await build(A, now), {}, now + 10);
    const vs = await B.versions('글.md');
    expect(preMerge(vs)).toHaveLength(1);
    expect(vs.filter((v) => v.id.startsWith('o')).length).toBe(1); // 일당 1개만 남는다
  });
});

describe('삭제 전파: 묘비로 되살아남 방지', () => {
  it('완전 삭제한 글감(purged 묘비)은 다른 기기의 옛 번들을 가져와도 되살아나지 않는다', async () => {
    const A = standaloneDevice();
    const B = standaloneDevice();
    await A.store.put('snippets', snip('s1'));
    await A.store.put('snippets', snip('s2'));
    // B 가 A 의 상태를 받는다
    await applyBundleWith(B.host, await build(A, T + 1), {}, T + 2);
    const oldBundleB = await build(B, T + 3); // s1 이 살아 있는 B 의 번들
    // A 에서 s1 을 휴지통 → 완전 삭제
    useWorksStore(A.store);
    await trashSnippet('s1');
    await purgeSnippet('s1');
    expect(await listSnippets()).toHaveLength(1);
    expect(await listTrashedSnippets()).toHaveLength(0);
    // 다른 기기(B)의 옛 번들을 A 에 가져와도 묘비가 이긴다
    const res = await applyBundleWith(A.host, oldBundleB, {}, Date.now());
    expect(res.snippets).toBe(0);
    expect(await listSnippets()).toHaveLength(1);
    expect(await listTrashedSnippets()).toHaveLength(0);
    // 묘비를 담은 A 의 번들을 B 에 가져오면 B 에서도 사라진다(되살아나지 않고 지워진다)
    const res2 = await applyBundleWith(B.host, await build(A, Date.now() + 1), {}, Date.now() + 2);
    expect(res2.snippets).toBe(1);
    useWorksStore(B.store);
    expect((await listSnippets()).map((s) => s.id)).toEqual(['s2']);
    expect(await listTrashedSnippets()).toHaveLength(0);
    expect(await B.store.get<Snippet>('snippets', 's1')).toMatchObject({ purged: true, body: '' });
  });

  it('휴지통에 있는 글감은 휴지통 상태로 전달되고, 다른 기기에서 복구한 쪽이 최신이면 복구가 이긴다', async () => {
    const A = standaloneDevice();
    const B = standaloneDevice();
    await A.store.put('snippets', snip('s1', { deletedAt: T + 10, updatedAt: T + 10, trashedFrom: [] }));
    await applyBundleWith(B.host, await build(A, T + 20), {}, T + 21);
    useWorksStore(B.store);
    expect((await listTrashedSnippets()).map((s) => s.id)).toEqual(['s1']);
    await B.store.put('snippets', snip('s1', { updatedAt: T + 50 })); // B 에서 복구(더 나중)
    await applyBundleWith(B.host, await build(A, T + 60), {}, T + 61);
    expect((await listSnippets()).map((s) => s.id)).toEqual(['s1']);
  });

  it('소프트 삭제한 스레드의 삭제가 전파된다', async () => {
    const A = standaloneDevice();
    const B = standaloneDevice();
    const ka = (await A.putDoc('글.md', '본문', T), (await A.key('글.md'))!);
    await A.store.put('threads', thread('t1', ka), ka);
    await applyBundleWith(B.host, await build(A, T + 1), {}, T + 2);
    const kb = (await B.key('글.md'))!;
    useWorksStore(A.store);
    await deleteThread({ id: 't1', docKey: ka });
    // B 의 옛 번들은 삭제를 되돌리지 못한다
    await applyBundleWith(A.host, await build(B, T + 3), {}, T + 4);
    expect(await listThreads(ka)).toEqual([]);
    // A 의 번들이 삭제를 B 에 전한다
    const res = await applyBundleWith(B.host, await build(A, Date.now() + 10), {}, Date.now() + 11);
    expect(res.threads).toBe(1);
    useWorksStore(B.store);
    expect(await listThreads(kb)).toEqual([]);
    expect((await B.store.get<Thread>('threads', 't1', kb))!.deletedAt).toBeGreaterThan(0);
  });

  it('글 삭제는 전파하지 않는다 — 번들에 없는 로컬 글은 그대로 남는다', async () => {
    const A = standaloneDevice();
    const B = standaloneDevice();
    await A.putDoc('둘다.md', 'x', T);
    await B.putDoc('둘다.md', 'x', T);
    await B.putDoc('B만.md', 'y', T);
    const res = await applyBundleWith(B.host, await build(A, T + 1), {}, T + 2);
    expect(res.docsAdded + res.docsUpdated).toBe(0);
    expect(await B.names()).toEqual(['B만.md', '둘다.md']);
  });
});

describe('스탠드얼론 id ↔ 이름', () => {
  it('없는 글의 이력·스레드·글감 연결은 글을 새로 만든 뒤 새 id 로 매핑된다', async () => {
    const srv = await serverDevice();
    await srv.putDoc('a/글.md', '본문', T);
    await srv.store.put('versions', ver('v1', 'a/글.md', '이력', T), 'a/글.md');
    await srv.store.put('threads', thread('t1', 'a/글.md'), 'a/글.md');
    await srv.store.put('snippets', snip('s1', { attachedDocs: ['a/글.md', '없는글.md'], trashedFrom: ['a/글.md'] }));
    // 사이드카만 있고 글이 없는 파티션
    await srv.store.put('versions', ver('v9', '고아.md', '고아 이력', T), '고아.md');
    const S = standaloneDevice();
    await applyBundleWith(S.host, await build(srv, T + 1), {}, T + 2);
    expect(await S.names()).toEqual(['a/글.md']); // 폴더는 그대로 유지되고, 글 없는 사이드카는 글을 만들지 않는다
    const k = (await S.key('a/글.md'))!;
    expect((await S.store.list('versions', k)).map((v) => v.id)).toEqual(['v1']);
    expect((await S.store.list<Thread>('threads', k)).map((t) => t.docKey)).toEqual([k]);
    const s1 = (await S.store.get<Snippet>('snippets', 's1'))!;
    expect(s1.attachedDocs).toEqual([k]); // 이 보관소에 없는 글('없는글.md')의 연결은 뗀다
    expect(s1.trashedFrom).toEqual([k]);
    expect(await S.store.parts('versions')).toEqual([k]);
  });

  it('대소문자만 다른 이름은 기존 글에 합쳐진다', async () => {
    const A = standaloneDevice();
    const B = standaloneDevice();
    await A.putDoc('Note.md', '새 본문', T + 10);
    await B.putDoc('note.md', '옛 본문', T);
    await applyBundleWith(B.host, await build(A, T + 20), {}, T + 21);
    expect(await B.names()).toEqual(['note.md']);
    expect(await B.doc('note.md')).toBe('새 본문');
  });
});

describe('디자인', () => {
  const custom = (() => { const d = defaultDesign(); d.typography = { ...d.typography, fontSize: 21 }; return serializeDesign(d); })();
  it('applyDesign 일 때만 적용하고, 미리보기는 달라졌는지만 알린다', async () => {
    const apply = vi.fn();
    const A = standaloneDevice({ design: { current: () => custom, apply: () => {} } });
    await A.putDoc('a.md', 'x', T);
    const bytes = await build(A, T + 1);
    const B = standaloneDevice({ design: { current: () => serializeDesign(defaultDesign()), apply } });
    expect((await previewBundleWith(B.host, bytes, T + 2)).designDiffers).toBe(true);
    expect((await applyBundleWith(B.host, bytes, {}, T + 3)).designApplied).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    const res = await applyBundleWith(B.host, bytes, { applyDesign: true }, T + 4);
    expect(res.designApplied).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0].typography.fontSize).toBe(21);
    // 같은 디자인이면 달라지지 않은 것
    const C = standaloneDevice({ design: { current: () => custom, apply: () => {} } });
    expect((await previewBundleWith(C.host, bytes, T + 5)).designDiffers).toBe(false);
  });
});

describe('부분 적용 최소화', () => {
  it('글 쓰기가 중간에 실패하면 이후의 사이드카(글감·스레드)는 쓰지 않고, 쓴 것이 있으면 화면 갱신(afterApply)은 부른다', async () => {
    const A = standaloneDevice();
    await A.putDoc('1.md', 'a', T);
    await A.putDoc('2.md', 'b', T);
    await A.store.put('snippets', snip('s1'));
    const bytes = await build(A, T + 1);
    const B = standaloneDevice();
    let n = 0;
    const flaky = {
      ...B.host,
      beginImport: (assets: ReadonlyMap<string, Uint8Array>) => {
        const s = B.host.beginImport(assets);
        return { ...s, putDoc: async (...a: Parameters<typeof s.putDoc>) => { if (++n === 2) throw new Error('디스크 오류'); return s.putDoc(...a); } };
      },
    };
    Object.defineProperty(flaky, 'store', { get: () => B.store });
    await expect(applyBundleWith(flaky, bytes, {}, T + 2)).rejects.toThrow('디스크 오류');
    expect(await B.names()).toEqual(['1.md']);
    expect(await B.store.list('snippets')).toEqual([]);
    expect(B.applied).toBe(1);
    // 다시 가져오면 이어서 완성된다
    const res = await applyBundleWith(B.host, bytes, {}, T + 3);
    expect(res).toMatchObject({ docsAdded: 1, snippets: 1 });
    expect(await B.names()).toEqual(['1.md', '2.md']);
  });
});
