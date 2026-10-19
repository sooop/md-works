import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { useWorksStore } from '../../src/lib/works/store';
import { createIdbStore } from '../../src/lib/works/idbStore';
import { createSnippet, listSnippets, listTrashedSnippets, trashSnippet, reattachPrefix } from '../../src/lib/works/snippets';

let n = 0;
beforeEach(() => useWorksStore(createIdbStore(`snip-prefix-${n++}`)));

describe('폴더 단위 연결 정리', () => {
  it('접두사를 치환하고 비슷한 이름은 건드리지 않는다', async () => {
    await createSnippet({ body: 'a', attachTo: ['dir/a.md', 'dir2/b.md', 'x.md'] });
    const t = await createSnippet({ body: 't', attachTo: ['dir/sub/c.md'] });
    await trashSnippet(t.id);
    await reattachPrefix('dir', 'moved');
    expect((await listSnippets())[0].attachedDocs).toEqual(['moved/a.md', 'dir2/b.md', 'x.md']);
    expect((await listTrashedSnippets())[0].trashedFrom).toEqual(['moved/sub/c.md']);
  });
  it('to 가 없으면 연결만 끊는다', async () => {
    await createSnippet({ body: 'a', attachTo: ['dir/a.md', 'k.md'] });
    await reattachPrefix('dir');
    expect((await listSnippets())[0].attachedDocs).toEqual(['k.md']);
  });
});
