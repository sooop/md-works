// 글 삭제 묘비: 글을 지우거나 이름을 바꾸면(옛 이름) 그 이름을 'tombstones' 컬렉션에 기록해 둔다.
// 번들에 실려 다른 기기로 가면, 그쪽이 같은 글을 되살리지 않고(skip-deleted) 지울지 물을 수 있다(병합 규칙은 merge.ts).
// 레코드 id 는 이름(소문자)에서 만든 안전한 id 다 — 서버 사이드카 id 규칙(ID_RE)을 지키고, 대소문자만 다른 이름은 한 묘비가 된다.
import { worksStore, type WorksStore } from '../works/store';
import type { Tombstone } from '../works/types';
import { contentHash } from './merge';

/** 글 이름 → 묘비 id ('t' + 26자 16진). 같은 보관소 안에서 대소문자 무시로 같은 이름이면 같은 id */
export const tombId = (name: string): string => `t${contentHash(name.toLowerCase())}`;

/** 비교용 이름 키(대소문자 무시) */
export const nameKey = (name: string): string => name.toLowerCase();

/** 글이 사라졌음을 기록한다(삭제·이름 변경의 옛 이름). 이미 더 늦은 묘비가 있으면 그대로 둔다 */
export async function recordDocGone(name: string, deletedAt = Date.now(), store: WorksStore = worksStore()): Promise<void> {
  if (!name) return;
  const id = tombId(name);
  const cur = await store.get<Tombstone>('tombstones', id);
  if (cur && cur.deletedAt >= deletedAt) return;
  await store.put<Tombstone>('tombstones', { id, name, deletedAt, updatedAt: deletedAt });
}

/** 같은 이름으로 글을 다시 만들었을 때 묘비를 지운다 */
export async function clearDocGone(name: string, store: WorksStore = worksStore()): Promise<void> {
  if (!name) return;
  await store.remove('tombstones', tombId(name));
}

/** 폴더 삭제·이름 변경: 하위 글 이름마다 묘비를 기록한다(이름은 글 이름 목록으로 넘긴다) */
export async function recordDocsGone(names: string[], deletedAt = Date.now(), store: WorksStore = worksStore()): Promise<void> {
  for (const n of names) await recordDocGone(n, deletedAt, store);
}

export async function listTombstones(store: WorksStore = worksStore()): Promise<Tombstone[]> {
  return (await store.list<Tombstone>('tombstones')).filter((t) => typeof t.name === 'string' && typeof t.deletedAt === 'number');
}
