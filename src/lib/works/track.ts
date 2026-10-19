// WorksStore 의 쓰기 메서드를 감싸 변경을 알리는 순수 래퍼(백업 '마지막 변경 시각' 추적용).
// 읽기(list/get/parts)는 그대로 통과시키고, 쓰기가 성공한 뒤에만 onWrite 를 부른다.
import type { WorksStore } from './store';

export function trackWrites(store: WorksStore, onWrite: () => void): WorksStore {
  const after = <A extends unknown[]>(fn: (...a: A) => Promise<void>) =>
    async (...a: A): Promise<void> => {
      await fn(...a);
      try { onWrite(); } catch { /* 알림 실패가 저장을 막지 않는다 */ }
    };
  return {
    list: (coll, part) => store.list(coll, part),
    get: (coll, id, part) => store.get(coll, id, part),
    parts: (coll) => store.parts(coll),
    put: after((coll, rec, part) => store.put(coll, rec, part)),
    putMany: after((coll, recs, part) => store.putMany(coll, recs, part)),
    remove: after((coll, id, part) => store.remove(coll, id, part)),
    removePart: after((coll, part) => store.removePart(coll, part)),
    movePart: after((coll, from, to) => store.movePart(coll, from, to)),
  };
}
