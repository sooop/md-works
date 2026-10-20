// 호스트가 글을 지울 때 쓰는 공용 정리: 글감에서 그 글의 연결을 끊는다(works/snippets 의 reattachDoc 과 같은 규칙, 저장소를 인자로 받는다).
import type { WorksStore } from '../works/store';
import type { Snippet } from '../works/types';
import { withoutOrder } from '../works/snippetOrder';

export async function detachSnippetsFrom(store: WorksStore, docKey: string): Promise<void> {
  for (const s of await store.list<Snippet>('snippets')) {
    if (s.purged) continue;
    if (!s.attachedDocs.includes(docKey) && !(s.trashedFrom ?? []).includes(docKey) && !(docKey in (s.orders ?? {}))) continue;
    const drop = (d: string[]) => d.filter((x) => x !== docKey);
    const { orders: _o, ...rest } = s;
    void _o;
    const orders = withoutOrder(s.orders, docKey);
    await store.put('snippets', {
      ...rest, updatedAt: Date.now(), attachedDocs: drop(s.attachedDocs), ...(s.trashedFrom ? { trashedFrom: drop(s.trashedFrom) } : {}),
      ...(orders ? { orders } : {}),
    });
  }
}
