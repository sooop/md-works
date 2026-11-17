import { describe, expect, it } from 'vitest';
import { standaloneDevice } from '../bundle/helpers';
import { createSyncAdapter, docItemId, snippetItemId, threadItemId } from '../../src/lib/sync/adapter';
import { contentHash } from '../../src/lib/bundle/merge';
import { ITEM_ID_RE, type DocData, type LocalItem, type SnippetData, type ThreadData } from '../../src/lib/sync/protocol';
import type { Snippet, Thread, Version } from '../../src/lib/works/types';

function device() {
  const dev = standaloneDevice();
  const adapter = createSyncAdapter({ host: dev.host, dbName: dev.dbName });
  return { dev, adapter };
}
const snip = (id: string, extra: Partial<Snippet> = {}): Snippet => ({
  id, body: `본문 ${id}`, color: 'yellow', createdAt: 10, updatedAt: 20, attachedDocs: [], ...extra,
});
const thread = (id: string, docKey: string, extra: Partial<Thread> = {}): Thread => ({
  id, docKey, anchor: { quote: 'q', prefix: 'p', suffix: 's' }, messages: [{ id: 'm1', text: '안녕', ts: 5 }],
  resolved: false, createdAt: 6, updatedAt: 7, ...extra,
});
const byKind = (items: LocalItem[], kind: string) => items.filter((i) => i.kind === kind);

describe('항목 id', () => {
  it('글 id 는 대소문자를 무시하고 27자이며 규칙에 맞는다', () => {
    expect(docItemId('폴더/Note.md')).toBe(docItemId('폴더/note.MD'));
    expect(docItemId('a.md')).not.toBe(docItemId('b.md'));
    expect(docItemId('a.md')).toBe(`d${contentHash('a.md')}`);
    expect(docItemId('a.md')).toHaveLength(27);
    expect(docItemId('긴 이름'.repeat(50))).toMatch(ITEM_ID_RE);
  });
  it('글감·스레드 id: 접두 + id, 62자 초과면 접두 + contentHash(id)', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    expect(snippetItemId(uuid)).toBe(`s-${uuid}`);
    expect(threadItemId(uuid)).toBe(`t-${uuid}`);
    const long = 'x'.repeat(61); // 's-' + 61 = 63 > 62
    expect(snippetItemId(long)).toBe(`s-${contentHash(long)}`);
    expect(threadItemId(long)).toBe(`t-${contentHash(long)}`);
    const edge = 'y'.repeat(60); // 정확히 62
    expect(snippetItemId(edge)).toBe(`s-${edge}`);
  });
});

describe('listLocal', () => {
  it('글·글감·스레드를 이름 기반으로 돌려준다(휴지통 글 제외, docKey 는 이름으로)', async () => {
    const { dev, adapter } = device();
    const kA = await dev.putDoc('폴더/A.md', '# A ![](idb:11111111-1111-1111-1111-111111111111)', 100);
    const kB = await dev.putDoc('B.md', 'bbb', 200);
    await dev.putDoc('C.md', 'ccc', 300);
    // C 를 휴지통으로
    const { createDocDb } = await import('../../src/lib/works/docDb');
    const db = createDocDb(dev.dbName);
    await db.trashDocs([(await dev.key('C.md'))!], 999);

    await dev.store.put('snippets', snip('s1', { attachedDocs: [kA, kB, 'ghost'], orders: { [kA]: 3, ghost: 9 }, source: { url: 'http://x' } }));
    await dev.store.put('snippets', snip('s2', { deletedAt: 50, trashedFrom: [kA, 'ghost'], attachedDocs: [] }));
    await dev.store.put('snippets', snip('s3', { body: '', purged: true, deletedAt: 60 }));
    await dev.store.put('threads', thread('t1', kA), kA);

    const items = await adapter.listLocal();
    const docs = byKind(items, 'doc');
    expect(docs.map((d) => (d.data as DocData).name).sort()).toEqual(['B.md', '폴더/A.md']);
    const a = docs.find((d) => (d.data as DocData).name === '폴더/A.md')!;
    expect(a).toMatchObject({ id: docItemId('폴더/A.md'), updatedAt: 100, deleted: false });
    expect((a.data as DocData).content).toContain('idb:11111111-1111-1111-1111-111111111111');

    const sn = Object.fromEntries(byKind(items, 'snippet').map((i) => [i.id, i.data as SnippetData]));
    expect(sn[snippetItemId('s1')].attachedDocNames).toEqual(['폴더/A.md', 'B.md']);
    expect(sn[snippetItemId('s1')].ordersByName).toEqual({ '폴더/A.md': 3 });
    expect(sn[snippetItemId('s2')]).toMatchObject({ deletedAt: 50, trashedFromNames: ['폴더/A.md'], attachedDocNames: [] });
    expect(sn[snippetItemId('s3')]).toMatchObject({ purged: true, deletedAt: 60 });

    const th = byKind(items, 'thread');
    expect(th).toHaveLength(1);
    expect(th[0]).toMatchObject({ id: threadItemId('t1'), updatedAt: 7 });
    expect((th[0].data as ThreadData).docName).toBe('폴더/A.md');
  });
});

describe('apply 왕복', () => {
  it('A 의 listLocal 을 B 에 적용해도 스레드·글감 연결이 B 의 docKey 로 유지된다', async () => {
    const A = device();
    const B = device();
    await B.dev.putDoc('다른.md', 'x', 1); // B 의 docKey 가 A 와 달라지게
    const kA = await A.dev.putDoc('폴더/글.md', '본문 idb:22222222-2222-2222-2222-222222222222', 100);
    await A.dev.store.put('snippets', snip('s1', { attachedDocs: [kA], orders: { [kA]: 4 } }));
    await A.dev.store.put('threads', thread('t1', kA), kA);

    const items = await A.adapter.listLocal();
    const order = [...byKind(items, 'doc'), ...byKind(items, 'snippet'), ...byKind(items, 'thread')];
    for (const it of order) expect(await B.adapter.apply(it)).toBe('applied');

    const kB = (await B.dev.key('폴더/글.md'))!;
    expect(kB).not.toBe(kA);
    expect(await B.dev.doc('폴더/글.md')).toBe('본문 idb:22222222-2222-2222-2222-222222222222');
    const s = (await B.dev.store.list<Snippet>('snippets'))[0];
    expect(s).toMatchObject({ id: 's1', attachedDocs: [kB], orders: { [kB]: 4 }, updatedAt: 20 });
    const ts = await B.dev.store.list<Thread>('threads', kB);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ id: 't1', docKey: kB, updatedAt: 7 });
    expect(B.dev.applied).toBeGreaterThan(0); // afterApply 호출

    // 되돌려 읽으면 같은 항목
    const back = await B.adapter.listLocal();
    const norm = (l: LocalItem[]) => l.filter((i) => i.kind !== 'doc' || (i.data as DocData).name === '폴더/글.md').sort((a, b) => a.id.localeCompare(b.id));
    expect(norm(back)).toEqual(norm(items));
  });

  it('글이 없으면 글감·스레드는 deferred, 글을 적용한 뒤 재시도하면 성공', async () => {
    const A = device();
    const B = device();
    const kA = await A.dev.putDoc('글.md', 'c', 1);
    await A.dev.store.put('snippets', snip('s1', { attachedDocs: [kA] }));
    await A.dev.store.put('threads', thread('t1', kA), kA);
    const items = await A.adapter.listLocal();
    const [doc] = byKind(items, 'doc');
    const [sn] = byKind(items, 'snippet');
    const [th] = byKind(items, 'thread');
    expect(await B.adapter.apply(sn)).toBe('deferred');
    expect(await B.adapter.apply(th)).toBe('deferred');
    expect(await B.dev.store.list('snippets')).toHaveLength(0);
    expect(await B.dev.store.parts('threads')).toHaveLength(0);
    expect(await B.adapter.apply(doc)).toBe('applied');
    expect(await B.adapter.apply(sn)).toBe('applied');
    expect(await B.adapter.apply(th)).toBe('applied');
    const kB = (await B.dev.key('글.md'))!;
    expect((await B.dev.store.list<Snippet>('snippets'))[0].attachedDocs).toEqual([kB]);
    expect(await B.dev.store.list('threads', kB)).toHaveLength(1);
  });

  it('setApplying 으로 묶으면 afterApply 는 끝에 한 번', async () => {
    const A = device();
    const B = device();
    await A.dev.putDoc('a.md', '1', 1);
    await A.dev.putDoc('b.md', '2', 1);
    B.adapter.setApplying!(true);
    for (const it of byKind(await A.adapter.listLocal(), 'doc')) await B.adapter.apply(it);
    expect(B.dev.applied).toBe(0);
    B.adapter.setApplying!(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(B.dev.applied).toBe(1);
  });

  it('글 이름의 대소문자·폴더 경로: 대소문자만 다른 이름은 기존 글을 덮어쓴다', async () => {
    const { dev, adapter } = device();
    const k = await dev.putDoc('폴더/Note.md', 'old', 10);
    const item: LocalItem = { id: docItemId('폴더/note.md'), kind: 'doc', updatedAt: 50, deleted: false, data: { name: '폴더/note.md', content: 'new' } };
    await adapter.apply(item);
    expect(await dev.names()).toEqual(['폴더/Note.md']);
    expect(await dev.key('폴더/Note.md')).toBe(k);
    expect(await dev.doc('폴더/Note.md')).toBe('new');
    // 새 깊은 경로
    await adapter.apply({ id: docItemId('a/b/c.md'), kind: 'doc', updatedAt: 7, deleted: false, data: { name: 'a/b/c.md', content: 'deep' } });
    expect(await dev.doc('a/b/c.md')).toBe('deep');
    const found = (await adapter.listLocal()).find((i) => i.id === docItemId('a/b/c.md'))!;
    expect(found.updatedAt).toBe(7);
  });
});

describe('삭제', () => {
  it('삭제 항목은 로컬 글을 지우고 이력·스레드·글감 연결을 정리한다(묘비 없음)', async () => {
    const { dev, adapter } = device();
    const k = await dev.putDoc('x.md', 'c', 1);
    await dev.store.put('snippets', snip('s1', { attachedDocs: [k], orders: { [k]: 1 } }));
    await dev.store.put('threads', thread('t1', k), k);
    await dev.store.put<Version>('versions', { id: 'v1', docKey: k, ts: 1, updatedAt: 1, content: 'c', enc: 'raw' }, k);
    await adapter.apply({ id: docItemId('x.md'), kind: 'doc', updatedAt: 9, deleted: true, data: null });
    expect(await dev.names()).toEqual([]);
    expect(await dev.store.list('threads', k)).toEqual([]);
    expect(await dev.store.list('versions', k)).toEqual([]);
    expect((await dev.store.list<Snippet>('snippets'))[0].attachedDocs).toEqual([]);
    expect(await dev.store.list('tombstones')).toEqual([]);
    expect(byKind(await adapter.listLocal(), 'doc')).toEqual([]);
  });

  it('removeLocal: 글은 삭제, 글감·스레드는 레코드 제거', async () => {
    const { dev, adapter } = device();
    const k = await dev.putDoc('x.md', 'c', 1);
    await dev.store.put('snippets', snip('s1'));
    await dev.store.put('threads', thread('t1', k), k);
    const items = await adapter.listLocal();
    for (const it of items) await adapter.removeLocal(it);
    expect(await dev.names()).toEqual([]);
    expect(await dev.store.list('snippets')).toEqual([]);
    expect(await dev.store.parts('threads')).toEqual([]);
  });

  it('원격 삭제 글감·스레드 항목은 레코드를 지운다', async () => {
    const { dev, adapter } = device();
    const k = await dev.putDoc('x.md', 'c', 1);
    await dev.store.put('snippets', snip('s1'));
    await dev.store.put('threads', thread('t1', k), k);
    await adapter.apply({ id: snippetItemId('s1'), kind: 'snippet', updatedAt: 1, deleted: true, data: null });
    await adapter.apply({ id: threadItemId('t1'), kind: 'thread', updatedAt: 1, deleted: true, data: null });
    expect(await dev.store.list('snippets')).toEqual([]);
    expect(await dev.store.list('threads', k)).toEqual([]);
  });
});

describe('preserveLoser', () => {
  it('이름 붙은 버전을 남기고 중복 호출에도 한 개', async () => {
    const { dev, adapter } = device();
    const k = await dev.putDoc('x.md', '이긴 내용', 100);
    const loser: LocalItem = { id: docItemId('x.md'), kind: 'doc', updatedAt: 50, deleted: false, data: { name: 'x.md', content: '진 내용' } };
    await adapter.preserveLoser(loser);
    await adapter.preserveLoser(loser);
    const vs = await dev.versions('x.md');
    expect(vs).toHaveLength(1);
    expect(vs[0].text).toBe('진 내용');
    expect(vs[0].name).toMatch(/^동기화 전\(\d{4}-\d{2}-\d{2}\)$/);
    expect(vs[0].docKey).toBe(k);
    // 글이 없으면 아무 일도 없다
    await adapter.preserveLoser({ ...loser, id: docItemId('none.md'), data: { name: 'none.md', content: 'z' } });
    // 글이 아닌 항목은 무시
    await adapter.preserveLoser({ id: 's-1', kind: 'snippet', updatedAt: 1, deleted: false, data: null });
  });
});

describe('휴지통·purged 글감', () => {
  it('휴지통 글감(deletedAt·trashedFrom)과 purged 묘비가 그대로 왕복한다', async () => {
    const A = device();
    const B = device();
    const kA = await A.dev.putDoc('글.md', 'c', 1);
    await A.dev.store.put('snippets', snip('s1', { deletedAt: 30, trashedFrom: [kA], attachedDocs: [], orders: { [kA]: 2 } }));
    await A.dev.store.put('snippets', snip('s2', { body: '', purged: true, deletedAt: 40, updatedAt: 41 }));
    const items = await A.adapter.listLocal();
    for (const it of [...byKind(items, 'doc'), ...byKind(items, 'snippet')]) expect(await B.adapter.apply(it)).toBe('applied');
    const kB = (await B.dev.key('글.md'))!;
    const all = Object.fromEntries((await B.dev.store.list<Snippet>('snippets')).map((s) => [s.id, s]));
    expect(all.s1).toMatchObject({ deletedAt: 30, trashedFrom: [kB], attachedDocs: [], orders: { [kB]: 2 } });
    expect(all.s2).toMatchObject({ purged: true, deletedAt: 40, updatedAt: 41, body: '', attachedDocs: [] });
  });

  it('휴지통 글감의 trashedFrom 글이 없어도 deferred 가 아니다(attachedDocs 만 기준)', async () => {
    const { adapter, dev } = device();
    const sn: LocalItem = {
      id: snippetItemId('s1'), kind: 'snippet', updatedAt: 5, deleted: false,
      data: { body: 'b', color: 'blue', createdAt: 1, attachedDocNames: [], trashedFromNames: ['없는.md'], deletedAt: 4 },
    };
    expect(await adapter.apply(sn)).toBe('applied');
    expect((await dev.store.list<Snippet>('snippets'))[0]).toMatchObject({ trashedFrom: [], deletedAt: 4 });
  });
});
