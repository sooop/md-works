import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { useWorksStore, worksStore } from '../../src/lib/works/store';
import type { Snippet } from '../../src/lib/works/types';
import { createIdbStore } from '../../src/lib/works/idbStore';
import {
  createSnippet, listSnippets, listTrashedSnippets, attachSnippet, detachSnippet, trashSnippet, restoreSnippet,
  purgeSnippet, updateSnippet, reattachDoc,
} from '../../src/lib/works/snippets';

let n = 0;
beforeEach(() => useWorksStore(createIdbStore(`snip-test-${n++}`)));

describe('글감 도메인', () => {
  it('만들기·수정·목록(최근 수정 순)', async () => {
    const a = await createSnippet({ body: 'a' });
    await new Promise((r) => setTimeout(r, 2));
    const b = await createSnippet({ body: 'b', color: 'blue', source: { url: 'https://x.test' } });
    await new Promise((r) => setTimeout(r, 2));
    await updateSnippet(a.id, { body: 'a2' });
    const list = await listSnippets();
    expect(list.map((s) => s.body)).toEqual(['a2', 'b']);
    expect(list[1].color).toBe('blue');
    expect(b.source?.url).toBe('https://x.test');
  });

  it('붙이기·떼기는 중복 없이, 떼도 글감은 남는다', async () => {
    const s = await createSnippet({ body: 'x', attachTo: ['d1'] });
    await attachSnippet(s.id, 'd1');
    await attachSnippet(s.id, 'd2');
    expect((await listSnippets())[0].attachedDocs).toEqual(['d1', 'd2']);
    await detachSnippet(s.id, 'd1');
    expect((await listSnippets())[0].attachedDocs).toEqual(['d2']);
  });

  it('휴지통: 버리면 연결이 사라지고, 복구하면 원래 글에 되붙는다', async () => {
    const s = await createSnippet({ body: 'x', attachTo: ['d1', 'd2'] });
    await trashSnippet(s.id);
    expect(await listSnippets()).toEqual([]);
    const t = (await listTrashedSnippets())[0];
    expect(t.attachedDocs).toEqual([]);
    expect(t.trashedFrom).toEqual(['d1', 'd2']);
    await restoreSnippet(s.id);
    const r = (await listSnippets())[0];
    expect(r.attachedDocs).toEqual(['d1', 'd2']);
    expect(r.deletedAt).toBeUndefined();
    expect(r.trashedFrom).toBeUndefined();
  });

  it('완전 삭제', async () => {
    const s = await createSnippet({ body: 'x' });
    await trashSnippet(s.id);
    await purgeSnippet(s.id);
    expect(await listTrashedSnippets()).toEqual([]);
    expect(await listSnippets()).toEqual([]);
    // 레코드는 묘비로 남는다 — 다른 기기에서 가져와도 되살아나지 않도록
    const tomb = await worksStore().get<Snippet>('snippets', s.id);
    expect(tomb).toMatchObject({ id: s.id, body: '', purged: true });
    expect(tomb!.deletedAt).toBeGreaterThan(0);
    await purgeSnippet('없는 id'); // 없는 글감은 무시
    expect(await worksStore().get('snippets', '없는 id')).toBeUndefined();
  });

  it('글 이름 변경·삭제에 따라 연결을 옮기거나 끊는다(휴지통 안의 기억 포함)', async () => {
    const a = await createSnippet({ body: 'a', attachTo: ['old', 'k'] });
    const b = await createSnippet({ body: 'b', attachTo: ['old'] });
    await trashSnippet(b.id);
    await reattachDoc('old', 'new');
    expect((await listSnippets())[0].attachedDocs).toEqual(['new', 'k']);
    expect((await listTrashedSnippets())[0].trashedFrom).toEqual(['new']);
    await reattachDoc('new');
    expect((await listSnippets())[0].attachedDocs).toEqual(['k']);
    expect(a.id).toBeTruthy();
  });
});
