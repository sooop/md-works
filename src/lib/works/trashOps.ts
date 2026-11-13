// 휴지통에서 글을 완전히 지울 때의 뒷정리: 예전의 글 삭제(removeDocCore)가 하던 일을 그대로 한다.
// 휴지통에 있는 동안에는 이력·코멘트 스레드·글감 핀을 건드리지 않고, 완전 삭제 때에만 지운다.
import { fullPath } from '../docTree';
import { recordDocGone } from '../bundle/tombstones';
import { removeHistory } from '../history';
import { reattachDoc } from './snippets';
import { worksStore } from './store';
import type { DocDb, DocRec } from './docDb';

/** 완전히 지운 글들의 이력·스레드·이전 방식 코멘트·글감 핀을 정리하고 삭제 묘비를 남긴다(한 부분이 실패해도 나머지는 계속한다) */
export async function cleanupPurged(recs: DocRec[], db: Pick<DocDb, 'idb'>): Promise<void> {
  for (const r of recs) {
    await recordDocGone(fullPath(r.folder ?? '', r.name), r.deletedAt ?? Date.now()).catch(() => { /* 무시 */ }); // 다른 기기의 번들에서 되살아나지 않도록(휴지통에 보낼 때 이미 남겼으면 그대로 둔다)
    await db.idb('comments', 'readwrite', (s) => s.delete(r.id)).catch(() => { /* 무시 */ });
    await worksStore().removePart('threads', r.id).catch(() => { /* 무시 */ });
    await removeHistory(r.id).catch(() => { /* 무시 */ });
    await reattachDoc(r.id).catch(() => { /* 무시 */ }); // 글감 연결 끊기
  }
}
