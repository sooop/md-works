// 두 WorksStore 구현(idb, sidecar)이 같은 동작을 하는지 확인하는 공용 테스트 스위트
import { describe, it, expect, beforeEach } from 'vitest';
import type { WorksStore } from '../../src/lib/works/store';
import type { Snippet, Version } from '../../src/lib/works/types';

const snip = (id: string, extra: Partial<Snippet> = {}): Snippet => ({
  id, updatedAt: 1, body: id, color: 'yellow', createdAt: 1, attachedDocs: [], ...extra,
});
const ver = (id: string, docKey: string, content = 'x'): Version => ({
  id, docKey, updatedAt: 1, ts: 1, content, enc: 'raw',
});
const ids = (rs: { id: string }[]) => rs.map((r) => r.id).sort();

export function worksStoreContract(name: string, make: () => Promise<WorksStore>) {
  describe(`WorksStore: ${name}`, () => {
    let s: WorksStore;
    beforeEach(async () => { s = await make(); });

    it('전역 컬렉션: put/get/list/remove', async () => {
      await s.put('snippets', snip('a'));
      await s.putMany('snippets', [snip('b'), snip('c')]);
      expect(ids(await s.list('snippets'))).toEqual(['a', 'b', 'c']);
      expect((await s.get<Snippet>('snippets', 'a'))?.body).toBe('a');
      await s.put('snippets', snip('a', { body: '수정' }));
      expect((await s.get<Snippet>('snippets', 'a'))?.body).toBe('수정');
      await s.remove('snippets', 'a');
      expect(await s.get('snippets', 'a')).toBeUndefined();
      expect(ids(await s.list('snippets'))).toEqual(['b', 'c']);
    });

    it('옵션 필드(deletedAt, source, 한글)를 그대로 보존한다', async () => {
      const r = snip('k', { deletedAt: 5, source: { url: 'https://x.test', title: '제목' }, trashedFrom: ['d1'], body: '가나다 ✓' });
      await s.put('snippets', r);
      expect(await s.get('snippets', 'k')).toEqual(r);
    });

    it('문서 파티션은 서로 격리된다', async () => {
      await s.put('versions', ver('v1', 'notes/한글 글.md'), 'notes/한글 글.md');
      await s.put('versions', ver('v2', 'b.md'), 'b.md');
      expect(ids(await s.list('versions', 'notes/한글 글.md'))).toEqual(['v1']);
      expect(ids(await s.list('versions', 'b.md'))).toEqual(['v2']);
      expect(await s.get('versions', 'v1', 'b.md')).toBeUndefined();
      expect((await s.parts('versions')).sort()).toEqual(['b.md', 'notes/한글 글.md']);
    });

    it('다른 파티션의 id 는 remove 로 지워지지 않는다', async () => {
      await s.put('versions', ver('v1', 'a.md'), 'a.md');
      await s.remove('versions', 'v1', 'b.md');
      expect(ids(await s.list('versions', 'a.md'))).toEqual(['v1']);
    });

    it('removePart 는 그 파티션만 지운다', async () => {
      await s.putMany('versions', [ver('v1', 'a.md'), ver('v2', 'a.md')], 'a.md');
      await s.put('versions', ver('v3', 'b.md'), 'b.md');
      await s.removePart('versions', 'a.md');
      expect(await s.list('versions', 'a.md')).toEqual([]);
      expect(ids(await s.list('versions', 'b.md'))).toEqual(['v3']);
      expect(await s.parts('versions')).toEqual(['b.md']);
    });

    it('movePart 는 파티션의 레코드를 옮긴다', async () => {
      await s.put('versions', ver('v1', 'a.md', '원본'), 'a.md');
      await s.put('versions', ver('v9', 'b.md', '옛것'), 'b.md');
      await s.movePart('versions', 'a.md', 'b.md');
      expect(await s.list('versions', 'a.md')).toEqual([]);
      expect(ids(await s.list('versions', 'b.md'))).toEqual(['v1', 'v9']);
      expect((await s.get<Version>('versions', 'v1', 'b.md'))?.content).toBe('원본');
    });

    it('전역 컬렉션의 parts: 비면 [], 있으면 하나', async () => {
      expect(await s.parts('snippets')).toEqual([]);
      await s.put('snippets', snip('a'));
      expect(await s.parts('snippets')).toEqual(['_']);
    });

    it('문서 컬렉션에서 파티션 없이 쓰면 거부한다', async () => {
      await expect(s.put('versions', ver('v1', 'a.md'))).rejects.toThrow();
    });
  });
}
