import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { createIdbStore } from '../../src/lib/works/idbStore';
import { newId } from '../../src/lib/works/types';

describe('idbStore.parts', () => {
  it('파티션 이름을 중복 없이 돌려주고 레코드 본문(getAll)을 읽지 않는다', async () => {
    const store = createIdbStore('works-parts-test');
    for (const p of ['a', 'b', 'a', 'c', 'b', 'a']) {
      await store.put('versions', { id: newId(), docKey: p, ts: 1, updatedAt: 1, content: 'x', enc: 'raw' } as never, p);
    }
    const spy = vi_spyGetAll();
    expect((await store.parts('versions')).sort()).toEqual(['a', 'b', 'c']);
    expect(spy.count).toBe(0);
    spy.restore();
  });
  it('비어 있으면 빈 배열', async () => {
    expect(await createIdbStore('works-parts-empty').parts('versions')).toEqual([]);
  });
});

// IDBObjectStore.getAll 호출을 센다
function vi_spyGetAll() {
  const proto = IDBObjectStore.prototype;
  const orig = proto.getAll;
  const state = { count: 0, restore: () => { proto.getAll = orig; } };
  proto.getAll = function (this: IDBObjectStore, ...a: Parameters<typeof orig>) { state.count++; return orig.apply(this, a); };
  return state;
}
