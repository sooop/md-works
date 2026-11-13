// 다른 탭이 저장소를 바꿨을 때 이 탭의 메모리 사본과 열린 글을 어떻게 맞출지 정하는 순수 로직.
import type { DocRec } from './docDb';

export interface RemoteDocState {
  /** 이 탭에 저장하지 않은 변경이 있나(입력 대기·저장 중·저장 실패·충돌 보류) */
  editing: boolean;
  docName: string;
  docContent: string;
  /** DB 의 그 글(없으면 다른 탭에서 지워진 것. 휴지통에 있는 글도 없는 것으로 넘긴다) */
  db: { name: string; content: string } | undefined;
  /** db 가 없는 이유가 휴지통으로 옮겨졌기 때문인가(안내 문구만 달라진다. 동작은 지워진 글과 같다) */
  trashed?: boolean;
}

export type RemoteAction =
  | { kind: 'none' }
  | { kind: 'reload'; name: string; content: string } // 편집 중이 아니고 내용이 달라졌다: 조용히 새 내용으로 다시 읽는다
  | { kind: 'rename'; name: string } // 이름만 바뀜(편집기를 다시 만들지 않는다)
  | { kind: 'closed'; trashed?: boolean } // 편집 중이 아닌데 지워졌다(또는 휴지통으로 갔다): 닫고 안내한다
  | { kind: 'gone-editing' }; // 편집 중인데 지워졌다: 다시 만들기 / 닫기 / 취소를 묻는다

export function planRemoteDoc(s: RemoteDocState): RemoteAction {
  if (!s.db) return s.editing ? { kind: 'gone-editing' } : s.trashed ? { kind: 'closed', trashed: true } : { kind: 'closed' };
  // 편집 중이면 내용은 건드리지 않는다. 다른 탭이 먼저 저장했는지는 저장하는 순간의 DB 검사가 가린다.
  if (!s.editing && s.db.content !== s.docContent) return { kind: 'reload', name: s.db.name, content: s.db.content };
  if (s.db.name !== s.docName) return { kind: 'rename', name: s.db.name };
  return { kind: 'none' };
}

/**
 * DB 의 글 목록을 메모리 사본(mem)과 base(이 탭이 마지막으로 읽거나 쓴 DB 내용)에 합친다.
 * 저장하지 못한 글(unsaved)은 내용·수정 시각을 메모리 것으로 두고(이름·폴더만 DB 를 따른다), DB 에서 지워졌어도 남겨 둔다
 * (저장할 때 '지워졌다'를 알리고 내용을 이력에 남길 수 있게).
 */
export function mergeRecs(mem: Map<string, DocRec>, base: Map<string, string>, db: DocRec[], unsaved: ReadonlySet<string>): void {
  const seen = new Set<string>();
  for (const r of db) {
    seen.add(r.id);
    const cur = mem.get(r.id);
    if (cur && unsaved.has(r.id)) {
      cur.name = r.name;
      if (r.folder) cur.folder = r.folder; else delete cur.folder;
      continue;
    }
    mem.set(r.id, r);
    base.set(r.id, r.content);
  }
  for (const id of [...mem.keys()]) {
    if (seen.has(id) || unsaved.has(id)) continue;
    mem.delete(id);
    base.delete(id);
  }
}
