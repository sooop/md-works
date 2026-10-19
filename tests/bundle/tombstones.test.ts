import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { applyBundleWith, buildBundleWith, previewBundleWith, MAX_KEPT_DELETED_CHARS } from '../../src/lib/bundle/core';
import { mergeTombstones } from '../../src/lib/bundle/merge';
import { parseBundle } from '../../src/lib/bundle/parse';
import { clearDocGone, listTombstones, recordDocGone, recordDocsGone, tombId } from '../../src/lib/bundle/tombstones';
import { standaloneDevice, serverDevice, ver, type Device } from './helpers';
import { createIdbStore } from '../../src/lib/works/idbStore';
import { ID_RE } from '../../src/lib/bundle/records';
import type { Snippet, Thread } from '../../src/lib/works/types';

const T = 1_700_000_000_000;
const build = async (d: Device, now: number) => (await buildBundleWith(d.host, now)).bytes;
/** 앱이 글을 지울 때와 같은 일: 호스트로 지우고 묘비를 기록한다 */
const remove = async (d: Device, name: string, t: number) => { await d.host.deleteDoc(name); await recordDocGone(name, t, d.store); };
const deletedSnippets = async (d: Device) => (await d.store.list<Snippet>('snippets')).filter((s) => s.body.includes('삭제 전('));
const thread = (id: string, docKey: string): Thread => ({
  id, docKey, anchor: { quote: '인용', prefix: '', suffix: '' }, messages: [{ id: 'm' + id, text: '메시지', ts: T }],
  resolved: false, createdAt: T, updatedAt: T,
});

describe('묘비 기록', () => {
  it('삭제·이름 변경(옛 이름)·재생성', async () => {
    const store = createIdbStore('tomb-rec-1');
    await recordDocGone('a.md', T, store);
    await recordDocsGone(['dir/b.md', 'dir/c.md'], T + 1, store);
    expect((await listTombstones(store)).map((t) => t.name).sort()).toEqual(['a.md', 'dir/b.md', 'dir/c.md']);
    const t = (await store.get('tombstones', tombId('a.md')))!;
    expect(t).toMatchObject({ name: 'a.md', deletedAt: T, updatedAt: T });
    expect(ID_RE.test(t.id)).toBe(true);
    // 대소문자만 다른 이름은 같은 묘비, 더 늦은 시각만 남는다
    await recordDocGone('A.md', T + 5, store);
    await recordDocGone('a.md', T + 2, store);
    expect((await listTombstones(store)).filter((x) => x.name.toLowerCase() === 'a.md')).toEqual([expect.objectContaining({ name: 'A.md', deletedAt: T + 5 })]);
    // 같은 이름으로 다시 만들면 묘비를 지운다
    await clearDocGone('a.md', store);
    expect((await listTombstones(store)).map((x) => x.name).sort()).toEqual(['dir/b.md', 'dir/c.md']);
  });
});

describe('묘비 병합 규칙(순수 함수)', () => {
  const base = { bundle: [], local: [], localDocs: [], bundleDocs: [] };
  it('번들 묘비 + 로컬 글: 같거나 오래됐으면 삭제 후보', () => {
    const r = mergeTombstones({ ...base, bundle: [{ name: 'a.md', deletedAt: 100 }], localDocs: [{ name: 'a.md', updatedAt: 100 }] });
    expect(r.deletions).toEqual([{ name: 'a.md', action: 'delete', deletedAt: 100 }]);
    expect(r.put).toEqual([]);
  });
  it('번들 묘비 + 로컬 글이 더 최신: keep-local', () => {
    const r = mergeTombstones({ ...base, bundle: [{ name: 'a.md', deletedAt: 100 }], localDocs: [{ name: 'a.md', updatedAt: 101 }] });
    expect(r.deletions).toEqual([{ name: 'a.md', action: 'keep-local', deletedAt: 100 }]);
  });
  it('로컬 묘비 + 번들 글이 같거나 오래됨: 되살리지 않음', () => {
    const r = mergeTombstones({ ...base, local: [{ name: 'a.md', deletedAt: 100 }], bundleDocs: [{ name: 'a.md', updatedAt: 100 }] });
    expect(r.skippedDeleted).toEqual(['a.md']);
    expect(r.clear).toEqual([]);
  });
  it('로컬 묘비 + 번들 글이 더 최신(나중에 다시 만든 글): 추가하고 묘비 제거', () => {
    const r = mergeTombstones({ ...base, local: [{ name: 'a.md', deletedAt: 100 }], bundleDocs: [{ name: 'a.md', updatedAt: 101 }] });
    expect(r.skippedDeleted).toEqual([]);
    expect(r.clear).toEqual(['a.md']);
  });
  it('묘비끼리는 큰 쪽, 번들에 같은 이름의 글이 있으면 글이 이긴다', () => {
    const r = mergeTombstones({ ...base, bundle: [{ name: 'a.md', deletedAt: 200 }, { name: 'b.md', deletedAt: 5 }], local: [{ name: 'a.md', deletedAt: 100 }, { name: 'b.md', deletedAt: 9 }] });
    expect(r.put).toEqual([{ name: 'a.md', deletedAt: 200 }]);
    const w = mergeTombstones({ ...base, bundle: [{ name: 'a.md', deletedAt: 200 }], bundleDocs: [{ name: 'a.md', updatedAt: 300 }], localDocs: [{ name: 'a.md', updatedAt: 1 }] });
    expect(w.deletions).toEqual([]);
  });
});

describe.each([['스탠드얼론', standaloneDevice], ['서버', serverDevice]] as const)('글 삭제 전파 — %s 호스트', (_label, make) => {
  it('내보내기에 묘비를 싣고, 같은 이름의 글이 있으면 싣지 않는다', async () => {
    const A = await make();
    await A.putDoc('글.md', '본문', T);
    await A.putDoc('옛.md', '옛 본문', T);
    await remove(A, '옛.md', T + 10);
    await recordDocGone('글.md', T + 5, A.store); // 낡은 묘비: 같은 이름의 글이 살아 있다
    const parsed = parseBundle(await build(A, T + 20));
    expect(parsed.tombstones.docs).toEqual({ '옛.md': T + 10 });
  });

  it('두 기기: A 삭제 → B 가져오기(미삭제) → 옵션 적용(삭제·글감 보존) → B 번들을 A 에 가져와도 되살아나지 않는다', async () => {
    const A = await make();
    const B = await make();
    const ka = (await A.putDoc('글.md', '지울 본문\n둘째 줄', T), (await A.key('글.md'))!);
    await A.putDoc('남는.md', '남는 본문', T);
    await A.store.put('versions', ver('va1', ka, '지울 본문', T), ka);
    await A.store.put('threads', thread('t1', ka), ka);
    await applyBundleWith(B.host, await build(A, T + 1), {}, T + 2);
    expect(await B.names()).toEqual(['글.md', '남는.md']);
    const kb = (await B.key('글.md'))!;
    expect(await B.versions('글.md')).toHaveLength(1);
    const bundleBefore = await build(A, T + 3); // 지우기 전 A 의 번들(되살리기 시도용)

    await remove(A, '글.md', T + 100);
    const bundleA = await build(A, T + 101);

    // 미리보기: 지운 글이 목록에 오른다. 아무것도 쓰지 않는다
    const pre = await previewBundleWith(B.host, bundleA, T + 102);
    expect(pre.deletions).toEqual([{ name: '글.md', action: 'delete' }]);
    expect(pre.skippedDeleted).toEqual([]);
    expect(await B.names()).toEqual(['글.md', '남는.md']);

    // 기본 설정: 아무것도 지우지 않는다
    const r0 = await applyBundleWith(B.host, bundleA, {}, T + 103);
    expect(r0.docsDeleted).toBe(0);
    expect(await B.names()).toEqual(['글.md', '남는.md']);
    expect(await deletedSnippets(B)).toHaveLength(0);
    expect(await listTombstones(B.store)).toEqual([]); // 살아 있는 글을 둔 채 묘비를 저장하지 않는다

    // 옵션 적용: 글이 지워지고 내용은 '삭제 전(날짜)' 글감(회색, 붙임 없음)으로 남는다
    const r1 = await applyBundleWith(B.host, bundleA, { applyDeletions: true }, T + 104);
    expect(r1.docsDeleted).toBe(1);
    expect(await B.names()).toEqual(['남는.md']);
    const kept = await deletedSnippets(B);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ color: 'gray', attachedDocs: [] });
    expect(kept[0].body).toMatch(/^\*\*삭제 전\(\d{4}-\d{2}-\d{2}\)\*\* · 글\.md\n\n지울 본문\n둘째 줄$/);
    expect(await B.store.list('versions', kb)).toEqual([]); // 이력·스레드는 삭제 경로가 정리한다
    expect(await B.store.list('threads', kb)).toEqual([]);
    expect((await listTombstones(B.store)).map((t) => [t.name, t.deletedAt])).toEqual([['글.md', T + 100]]);

    // B 의 번들(묘비 포함)을 A 에 가져와도, 옛 번들(글 포함)을 가져와도 되살아나지 않는다
    const back = await previewBundleWith(A.host, await build(B, T + 105), T + 106);
    expect(back.docs.map((d) => d.name)).toEqual(['남는.md']);
    const old = await previewBundleWith(A.host, bundleBefore, T + 107);
    expect(old.skippedDeleted).toEqual(['글.md']);
    expect(old.docs.map((d) => d.name)).toEqual(['남는.md']);
    await applyBundleWith(A.host, bundleBefore, { applyDeletions: true }, T + 108);
    expect(await A.names()).toEqual(['남는.md']);
    expect(await A.versions('글.md')).toEqual([]);
  });

  it('로컬이 더 최신이면 keep-local 이라 옵션을 켜도 지우지 않는다', async () => {
    const A = await make();
    const B = await make();
    await A.putDoc('글.md', '첫 판', T);
    await applyBundleWith(B.host, await build(A, T + 1), {}, T + 2);
    await remove(A, '글.md', T + 100);
    await B.putDoc('글.md', '더 나중에 고침', T + 200);
    const bundleA = await build(A, T + 101);
    expect((await previewBundleWith(B.host, bundleA, T + 102)).deletions).toEqual([{ name: '글.md', action: 'keep-local' }]);
    const r = await applyBundleWith(B.host, bundleA, { applyDeletions: true }, T + 103);
    expect(r.docsDeleted).toBe(0);
    expect(await B.doc('글.md')).toBe('더 나중에 고침');
  });

  it('지운 뒤 같은 이름으로 다시 만든 글(번들이 더 최신)은 정상 추가되고 로컬 묘비가 지워진다', async () => {
    const A = await make();
    const B = await make();
    await A.putDoc('글.md', '첫 판', T);
    await remove(A, '글.md', T + 100);
    await B.putDoc('글.md', '다시 만든 글', T + 200);
    const bundleB = await build(B, T + 201);
    const pre = await previewBundleWith(A.host, bundleB, T + 202);
    expect(pre.docs).toEqual([{ name: '글.md', action: 'add' }]);
    expect(pre.skippedDeleted).toEqual([]);
    await applyBundleWith(A.host, bundleB, {}, T + 203);
    expect(await A.doc('글.md')).toBe('다시 만든 글');
    expect(await listTombstones(A.store)).toEqual([]);
  });

  it('구 번들(tombstones.json 이 없거나 비어 있음)도 정상으로 가져온다', async () => {
    const A = await make();
    const B = await make();
    await A.putDoc('글.md', '본문', T);
    const files = unzipSync(await build(A, T + 1));
    const noTomb = { ...files }; delete noTomb['.works/tombstones.json'];
    const empty = { ...files, '.works/tombstones.json': strToU8('{}') };
    for (const bytes of [zipSync(noTomb), zipSync(empty)]) {
      const pre = await previewBundleWith(B.host, bytes, T + 2);
      expect(pre.docs).toEqual([{ name: '글.md', action: 'add' }]);
      expect(pre.deletions).toEqual([]);
      expect(pre.skippedDeleted).toEqual([]);
    }
    await applyBundleWith(B.host, zipSync(noTomb), { applyDeletions: true }, T + 3);
    expect(await B.names()).toEqual(['글.md']);
  });

  it('너무 큰 글은 앞 200KB 만 글감으로 보존하고 잘렸다고 적는다', async () => {
    const A = await make();
    const B = await make();
    const big = 'ㄱ'.repeat(MAX_KEPT_DELETED_CHARS + 50);
    await A.putDoc('큰.md', 'x', T);
    await applyBundleWith(B.host, await build(A, T + 1), {}, T + 2);
    await B.putDoc('큰.md', big, T + 3);
    await remove(A, '큰.md', T + 100);
    await applyBundleWith(B.host, await build(A, T + 101), { applyDeletions: true }, T + 102);
    const [s] = await deletedSnippets(B);
    expect(s.body).toContain('ㄱ'.repeat(MAX_KEPT_DELETED_CHARS));
    expect(s.body).not.toContain('ㄱ'.repeat(MAX_KEPT_DELETED_CHARS + 1));
    expect(s.body).toMatch(/너무 길어 앞 200KB 만 보관/);
    expect(await B.names()).toEqual([]);
  });
});

describe('서버 → 스탠드얼론 이름 변환', () => {
  it('폴더 안의 글을 서버에서 지우면 스탠드얼론의 평평한 이름의 글이 삭제 후보가 된다', async () => {
    const S = await serverDevice();
    const H = standaloneDevice();
    await S.putDoc('폴더/글.md', '본문', T);
    await applyBundleWith(H.host, await build(S, T + 1), {}, T + 2);
    expect(await H.names()).toEqual(['폴더 - 글.md']);
    await remove(S, '폴더/글.md', T + 100);
    const pre = await previewBundleWith(H.host, await build(S, T + 101), T + 102);
    expect(pre.deletions).toEqual([{ name: '폴더 - 글.md', action: 'delete' }]);
    await applyBundleWith(H.host, await build(S, T + 101), { applyDeletions: true }, T + 103);
    expect(await H.names()).toEqual([]);
  });
});
