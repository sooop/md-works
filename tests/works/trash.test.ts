import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createDocDb, type DocRec } from '../../src/lib/works/docDb';
import { createIdbStore } from '../../src/lib/works/idbStore';
import { useWorksStore, worksStore } from '../../src/lib/works/store';
import { cleanupPurged } from '../../src/lib/works/trashOps';
import { expiredIds, restoreFolderPath, restoreName, trashItems } from '../../src/lib/works/trashLogic';
import { planRemoteDoc } from '../../src/lib/works/remoteDoc';
import { createStandaloneHost } from '../../src/lib/bundle/hosts/standalone';
import { applyBundleWith, buildBundleWith } from '../../src/lib/bundle/core';
import { listTombstones, recordDocGone } from '../../src/lib/bundle/tombstones';
import { agoLabel, daysLeft, restoreMessage, trashWhen, TRASH_MS } from '../../src/lib/trash';
import type { Snippet } from '../../src/lib/works/types';
import { unzipSync, strFromU8 } from 'fflate';

let n = 0;
const fresh = () => {
  const name = `works-trash-${n++}`;
  useWorksStore(createIdbStore(`${name}-data`));
  return { name, db: createDocDb(name) };
};
const rec = (id: string, content = 'x', extra: Partial<DocRec> = {}): DocRec => ({ id, name: `${id}.md`, content, updated: 1, ...extra });
const ID = (c: string) => c.repeat(36).slice(0, 36);
const DAY = 24 * 60 * 60 * 1000;

describe('글 소프트 삭제', () => {
  it('휴지통으로 가도 레코드는 남고, 목록·이름 계산·저장·메타 변경에서는 없는 글이다', async () => {
    const { db } = fresh();
    await db.create(() => rec('a', 'v1'));
    const trashed = await db.trashDocs(['a'], 100);
    expect(trashed[0].deletedAt).toBe(100);
    expect((await db.getAll())).toHaveLength(1); // 이력·이미지 참조를 위해 레코드는 그대로
    expect(await db.listTrash()).toMatchObject([{ id: 'a', type: 'file', path: 'a.md', docs: 1, deletedAt: 100 }]);
    // 새 글 이름 계산에서 휴지통의 글은 보이지 않는다
    let seen = -1;
    await db.create((existing) => { seen = existing.length; return rec('b'); });
    expect(seen).toBe(0);
    // 저장은 되살리지 않는다
    expect((await db.saveContent({ rec: rec('a', 'v2'), base: 'v1' })).kind).toBe('gone');
    expect((await db.get('a'))?.content).toBe('v1');
    expect((await db.get('a'))?.deletedAt).toBe(100);
    // 이름·폴더 변경도 없는 글로 본다
    expect(await db.patch('a', (c) => ({ ...c, name: 'z.md' }))).toBeUndefined();
    expect(await db.patchMany(['a'], (c) => ({ ...c, name: 'z.md' }))).toEqual([]);
  });

  it('저장의 "다시 만들기"는 휴지통 표시를 걷고 새로 쓴다', async () => {
    const { db } = fresh();
    await db.create(() => rec('a', 'v1'));
    await db.trashDocs(['a'], 5);
    const r = await db.saveContent({ rec: rec('a', 'v2'), base: 'v1', recreate: true });
    expect(r.kind).toBe('ok');
    expect((await db.get('a'))?.deletedAt).toBeUndefined();
    expect(await db.listTrash()).toEqual([]);
  });

  it('이미 휴지통에 있는 글을 다시 보내도 삭제 시각이 바뀌지 않는다', async () => {
    const { db } = fresh();
    await db.create(() => rec('a'));
    await db.trashDocs(['a'], 5);
    expect(await db.trashDocs(['a'], 99)).toEqual([]);
    expect((await db.get('a'))?.deletedAt).toBe(5);
  });
});

describe('이미지 정리(gc)', () => {
  it('휴지통 글이 참조하는 이미지는 지우지 않고, 완전 삭제 뒤에는 지운다', async () => {
    const { db } = fresh();
    const img = ID('a');
    const other = ID('b');
    await db.idb('images', 'readwrite', (s) => s.put({ id: img, blob: new Blob(['1']), created: 0 }));
    await db.idb('images', 'readwrite', (s) => s.put({ id: other, blob: new Blob(['2']), created: 0 }));
    await db.create(() => rec('a', `![](idb:${img})`));
    await db.trashDocs(['a'], 1);
    const dead = await db.gc({ extraContents: [], now: 1_000_000, graceMs: 1000 });
    expect(dead).toEqual([other]);
    await db.purgeTrash(['a']);
    expect(await db.gc({ extraContents: [], now: 1_000_000, graceMs: 1000 })).toEqual([img]);
  });
});

describe('복구', () => {
  it('원래 폴더·이름으로 돌아오고 휴지통에서 빠진다', async () => {
    const { db } = fresh();
    await db.create(() => rec('a', 'v1', { folder: '주제' }));
    await db.trashDocs(['a'], 1);
    const r = await db.restoreTrash(['a']);
    expect(r).toMatchObject({ ok: 1, failed: 0, paths: ['주제/a.md'], docPaths: ['주제/a.md'] });
    expect(await db.get('a')).toEqual(rec('a', 'v1', { folder: '주제' }));
    expect(await db.listTrash()).toEqual([]);
  });

  it('같은 이름이 생겼으면 이름 (2) 로 복구한다', async () => {
    const { db } = fresh();
    await db.create(() => rec('a', 'old', { name: '글.md' }));
    await db.trashDocs(['a'], 1);
    await db.create(() => rec('b', 'new', { name: '글.md' }));
    const r = await db.restoreTrash(['a']);
    expect(r.paths).toEqual(['글 (2).md']);
    expect((await db.get('a'))?.name).toBe('글 (2).md');
    expect((await db.get('b'))?.name).toBe('글.md');
  });

  it('없는 항목은 실패로 센다', async () => {
    const { db } = fresh();
    await db.create(() => rec('a'));
    const r = await db.restoreTrash(['a', 'zzz']);
    expect(r.ok).toBe(0);
    expect(r.failed).toBe(2);
    expect(r.error).toContain('휴지통');
  });
});

describe('폴더 묶음 삭제·복구', () => {
  it('폴더는 한 항목(docs: N)이고 복구하면 빈 폴더까지 구조째 돌아온다', async () => {
    const { db } = fresh();
    await db.create(() => rec('a', 'A', { folder: '프로젝트' }));
    await db.create(() => rec('b', 'B', { folder: '프로젝트/하위' }));
    await db.create(() => rec('c', 'C'));
    await db.updateFolders((s) => { s.add('프로젝트'); s.add('프로젝트/빈'); s.add('다른'); });
    const t = await db.trashFolder('프로젝트', 50, 'batch1');
    expect(t?.docs.map((d) => d.id).sort()).toEqual(['a', 'b']);
    expect(await db.readFolders()).toEqual(['다른']); // 보이는 폴더 목록에서 빠진다
    const items = await db.listTrash();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'batch1', type: 'dir', path: '프로젝트', name: '프로젝트', docs: 2, deletedAt: 50 });

    const r = await db.restoreTrash(['batch1']);
    expect(r).toMatchObject({ ok: 1, paths: ['프로젝트'] });
    expect(r.docPaths.sort()).toEqual(['프로젝트/a.md', '프로젝트/하위/b.md']);
    expect((await db.readFolders()).sort()).toEqual(['다른', '프로젝트', '프로젝트/빈'].sort()); // 글이 있는 하위 폴더는 글의 folder 로 알 수 있다
    expect((await db.get('a'))?.deletedAt).toBeUndefined();
    expect((await db.get('b'))?.folder).toBe('프로젝트/하위');
    expect(await db.listTrash()).toEqual([]);
    expect(await db.readTrashDirs()).toEqual({});
  });

  it('빈 폴더도 휴지통에 한 항목으로 보이고 복구된다', async () => {
    const { db } = fresh();
    await db.updateFolders((s) => s.add('빈'));
    expect(await db.trashFolder('빈', 1, 'e')).toBeTruthy();
    expect((await db.listTrash())[0]).toMatchObject({ type: 'dir', docs: 0 });
    await db.restoreTrash(['e']);
    expect(await db.readFolders()).toEqual(['빈']);
  });

  it('없는 폴더는 지울 것이 없다', async () => {
    const { db } = fresh();
    expect(await db.trashFolder('없음', 1, 'x')).toBeUndefined();
  });

  it('같은 이름의 폴더가 생겼으면 폴더 (2) 로, 사라진 상위 폴더는 다시 만든다', async () => {
    const { db } = fresh();
    await db.create(() => rec('a', 'A', { folder: '위/폴더' }));
    await db.trashFolder('위/폴더', 1, 'g');
    await db.create(() => rec('n', 'N', { folder: '위/폴더' })); // 같은 이름의 새 폴더
    const r = await db.restoreTrash(['g']);
    expect(r.paths).toEqual(['위/폴더 (2)']);
    expect((await db.get('a'))?.folder).toBe('위/폴더 (2)');
    expect((await db.readFolders())).toContain('위/폴더 (2)');
  });

  it('이미 따로 휴지통에 있던 글은 폴더 묶음에 섞이지 않는다', async () => {
    const { db } = fresh();
    await db.create(() => rec('a', 'A', { folder: 'f' }));
    await db.create(() => rec('b', 'B', { folder: 'f' }));
    await db.trashDocs(['a'], 1);
    await db.trashFolder('f', 2, 'g');
    const items = await db.listTrash();
    expect(items.map((i) => [i.id, i.type, i.docs])).toEqual([['g', 'dir', 1], ['a', 'file', 1]]);
  });
});

describe('완전 삭제와 30일 비우기', () => {
  it('완전 삭제는 핀·스레드·이력을 정리하고, 휴지통에 있는 동안에는 그대로 둔다', async () => {
    const { db } = fresh();
    const store = worksStore();
    await db.create(() => rec('a', 'A'));
    await store.put('threads', { id: 't1', updatedAt: 1 }, 'a');
    await store.put('versions', { id: 'v1', updatedAt: 1 }, 'a');
    await store.put('snippets', { id: 's1', updatedAt: 1, body: 'b', color: 'yellow', createdAt: 1, attachedDocs: ['a', 'other'] });
    await db.trashDocs(['a'], 1);
    // 휴지통에 있는 동안: 모두 그대로
    expect((await store.list('threads', 'a')).length).toBe(1);
    expect((await store.list('versions', 'a')).length).toBe(1);
    expect(((await store.get<Snippet>('snippets', 's1'))!).attachedDocs).toEqual(['a', 'other']);
    // 복구하면 그대로 살아난다
    await db.restoreTrash(['a']);
    expect(((await store.get<Snippet>('snippets', 's1'))!).attachedDocs).toEqual(['a', 'other']);
    // 다시 보내고 완전 삭제
    await db.trashDocs(['a'], 2);
    const removed = await db.purgeTrash(['a']);
    await cleanupPurged(removed, db);
    expect(await db.get('a')).toBeUndefined();
    expect((await store.list('threads', 'a')).length).toBe(0);
    expect((await store.list('versions', 'a')).length).toBe(0);
    expect(((await store.get<Snippet>('snippets', 's1'))!).attachedDocs).toEqual(['other']);
    expect((await listTombstones()).map((t) => t.name)).toContain('a.md');
  });

  it('폴더 묶음을 완전 삭제하면 안의 글이 모두 지워진다', async () => {
    const { db } = fresh();
    await db.create(() => rec('a', 'A', { folder: 'f' }));
    await db.create(() => rec('b', 'B', { folder: 'f' }));
    await db.trashFolder('f', 1, 'g');
    const removed = await db.purgeTrash(['g']);
    expect(removed.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(await db.getAll()).toEqual([]);
    expect(await db.readTrashDirs()).toEqual({});
  });

  it('살아 있는 글은 완전 삭제 대상이 아니다', async () => {
    const { db } = fresh();
    await db.create(() => rec('a'));
    expect(await db.purgeTrash(['a'])).toEqual([]);
    expect(await db.get('a')).toBeTruthy();
  });

  it('보관 기간(30일)이 지난 항목만 고른다 — 시각 주입', async () => {
    const { db } = fresh();
    const now = 100 * DAY;
    await db.create(() => rec('old'));
    await db.create(() => rec('new'));
    await db.create(() => rec('f1', 'x', { folder: 'dir' }));
    await db.trashDocs(['old'], now - 31 * DAY);
    await db.trashDocs(['new'], now - 29 * DAY);
    await db.trashFolder('dir', now - TRASH_MS, 'dirbatch'); // 정확히 30일
    expect((await db.expiredTrash(now, TRASH_MS)).sort()).toEqual(['dirbatch', 'old']);
    await db.purgeTrash(await db.expiredTrash(now, TRASH_MS));
    expect((await db.listTrash()).map((i) => i.id)).toEqual(['new']);
  });
});

describe('순수 로직', () => {
  const live = [rec('a', '', { name: '글.md' }), rec('b', '', { name: '글 (2).md' })];
  it('restoreName: 번호는 비어 있는 첫 번호', () => {
    expect(restoreName('글.md', '', live, new Set())).toBe('글 (3).md');
    expect(restoreName('다른.md', '', live, new Set())).toBe('다른.md');
  });
  it('restoreName: 같은 이름의 폴더와도 겹치지 않는다', () => {
    expect(restoreName('글.md', '', [], new Set(['글.md']))).toBe('글 (2).md');
  });
  it('restoreFolderPath', () => {
    expect(restoreFolderPath('a/b', [], new Set(['a', 'a/b']))).toBe('a/b (2)');
    expect(restoreFolderPath('a/b', [], new Set(['a']))).toBe('a/b');
  });
  it('trashItems / expiredIds: 최근 삭제 먼저', () => {
    const recs = [rec('x', '', { deletedAt: 5 }), rec('y', '', { deletedAt: 9 }), rec('z')];
    expect(trashItems(recs, {}).map((i) => i.id)).toEqual(['y', 'x']);
    expect(expiredIds(recs, {}, 10, 5)).toEqual(['x']);
  });
  it('상대 표기와 남은 날수', () => {
    expect(agoLabel(0, 30_000)).toBe('방금');
    expect(agoLabel(0, 5 * 60_000)).toBe('5분 전');
    expect(agoLabel(0, 3 * 3600_000)).toBe('3시간 전');
    expect(agoLabel(0, 3 * DAY)).toBe('3일 전');
    expect(daysLeft(0, 3 * DAY)).toBe(27);
    expect(trashWhen(0, 3 * DAY)).toBe('3일 전 삭제 · 27일 뒤 자동 삭제');
    expect(trashWhen(0, 31 * DAY)).toContain('곧 자동 삭제');
  });
  it('복구 결과 문구: 이름이 바뀌면 알린다', () => {
    const item = { id: 'a', name: '글.md', path: '글.md', type: 'file' as const };
    expect(restoreMessage([item], { ok: 1, failed: 0, paths: ['글.md'] }).text).toBe('복구했습니다: 글');
    expect(restoreMessage([item], { ok: 1, failed: 0, paths: ['글 (2).md'] }).text).toBe('복구했습니다: 글 → 글 (2) (같은 이름이 있어 이름을 바꿨습니다)');
    expect(restoreMessage([item], { ok: 0, failed: 1, error: '이유', paths: [] })).toEqual({ text: '복구하지 못했습니다: 이유', kind: 'error' });
  });
});

describe('다른 탭의 삭제 반영(planRemoteDoc)', () => {
  it('휴지통으로 간 글: 편집 중이 아니면 닫고, 편집 중이면 선택창', () => {
    const base = { docName: 'a.md', docContent: 'x', db: undefined, trashed: true };
    expect(planRemoteDoc({ ...base, editing: false })).toEqual({ kind: 'closed', trashed: true });
    expect(planRemoteDoc({ ...base, editing: true })).toEqual({ kind: 'gone-editing' });
  });
});

describe('번들', () => {
  const make = (name: string) => {
    const store = worksStore();
    return createStandaloneHost({ store: () => store, dbName: name });
  };

  it('내보내기에는 휴지통 글이 실리지 않는다(이름 목록·본문)', async () => {
    const { name, db } = fresh();
    await db.create(() => rec('a', '살아 있는 글'));
    await db.create(() => rec('b', '지운 글'));
    await db.trashDocs(['b'], 1);
    const host = make(name);
    expect((await host.listDocs()).map((d) => d.name)).toEqual(['a.md']);
    const { bytes } = await buildBundleWith(host);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toContain('a.md');
    expect(Object.keys(files)).not.toContain('b.md');
    expect(strFromU8(files['a.md'])).toBe('살아 있는 글');
  });

  it('가져오기: 번들 글이 삭제 시각 뒤에 수정됐으면 휴지통의 글을 되살려 덮고(id 유지), 아니면 휴지통에 둔다', async () => {
    const src = fresh();
    await src.db.create(() => rec('s', '번들 내용', { name: '글.md', updated: 5000 }));
    const bundle = (await buildBundleWith(make(src.name))).bytes;

    // 이 기기: 같은 이름의 글을 4000 에 지움 → 번들(5000)이 더 나중 → 되살린다
    const a = fresh();
    await a.db.create(() => rec('mine', '옛 내용', { name: '글.md', updated: 1000 }));
    await a.db.trashDocs(['mine'], 4000);
    await recordDocGone('글.md', 4000);
    const r1 = await applyBundleWith(make(a.name), bundle);
    expect(r1.docsAdded).toBe(1);
    const back = await a.db.get('mine');
    expect(back?.deletedAt).toBeUndefined();
    expect(back?.content).toBe('번들 내용');
    expect(await a.db.getAll()).toHaveLength(1);

    // 이 기기: 6000 에 지움 → 번들(5000)이 더 오래됨 → 휴지통에 그대로
    const b = fresh();
    await b.db.create(() => rec('mine', '옛 내용', { name: '글.md', updated: 1000 }));
    await b.db.trashDocs(['mine'], 6000);
    await recordDocGone('글.md', 6000);
    await applyBundleWith(make(b.name), bundle);
    const kept = await b.db.get('mine');
    expect(kept?.deletedAt).toBe(6000);
    expect(kept?.content).toBe('옛 내용');
    expect((await b.db.getAll())).toHaveLength(1);
  });
});
