// 문서 휴지통: 모드(서버·스탠드얼론)와 무관한 인터페이스와 화면용 순수 함수.
// 서버는 `/api/trash*`, 스탠드얼론은 IndexedDB 의 삭제 표시(deletedAt)로 구현한다.

export interface TrashItem {
  /** 복구·완전 삭제에 쓰는 키(서버: 휴지통 id, 스탠드얼론: 글은 글 id, 폴더는 삭제 묶음 id) */
  id: string;
  /** 지우기 전의 경로(글은 `폴더/이름.md`, 폴더는 `폴더/하위`) */
  path: string;
  /** 이름(글은 `.md` 포함) */
  name: string;
  type: 'file' | 'dir';
  /** 삭제한 시각(ms) */
  deletedAt: number;
  /** 글이면 1, 폴더면 안에 든 글 수 */
  docs: number;
}

export interface TrashRestoreResult {
  ok: number;
  failed: number;
  /** 첫 실패 이유 */
  error?: string;
  /** 복구된 경로(같은 이름이 있어 `이름 (2)` 로 바뀌었을 수 있다) */
  paths: string[];
}

export interface TrashCtl {
  /** 휴지통 목록(최근 삭제 먼저). 30일 지난 항목은 먼저 비운다 */
  list(): Promise<TrashItem[]>;
  restore(ids: string[]): Promise<TrashRestoreResult>;
  /** 완전 삭제 */
  purge(ids: string[]): Promise<void>;
  /** 비우기 */
  empty(): Promise<void>;
  /** 다른 탭·다른 곳에서 휴지통이 바뀌었을 때 알림을 받는다(선택). 돌려주는 함수로 해제 */
  subscribe?(fn: () => void): () => void;
}

export const TRASH_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
export const TRASH_MS = TRASH_DAYS * DAY;

/** 자동 삭제까지 남은 날수(올림, 0 이상) */
export function daysLeft(deletedAt: number, now: number): number {
  return Math.max(0, Math.ceil((deletedAt + TRASH_MS - now) / DAY));
}

/** 삭제 시각의 상대 표기: '방금' · 'N분 전' · 'N시간 전' · 'N일 전' */
export function agoLabel(deletedAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - deletedAt) / 1000));
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

/** '3일 전 삭제 · 27일 뒤 자동 삭제' 처럼 항목 한 줄에 보일 문구 */
export function trashWhen(deletedAt: number, now: number): string {
  const left = daysLeft(deletedAt, now);
  return `${agoLabel(deletedAt, now)} 삭제 · ${left <= 0 ? '곧 자동 삭제' : `${left}일 뒤 자동 삭제`}`;
}

/** 항목의 원래 위치(폴더 경로, 최상위면 '') */
export function trashFolder(item: Pick<TrashItem, 'path'>): string {
  const i = item.path.lastIndexOf('/');
  return i < 0 ? '' : item.path.slice(0, i);
}

/** 화면에 보일 이름: 글은 .md 를 뗀다 */
export const trashLabel = (item: Pick<TrashItem, 'name' | 'type'>): string => (item.type === 'file' ? item.name.replace(/\.md$/i, '') : item.name);

/** 복구 결과를 알리는 한 줄 */
export function restoreMessage(items: Pick<TrashItem, 'id' | 'name' | 'type' | 'path'>[], r: { ok: number; failed: number; error?: string; paths: string[] }): { text: string; kind: 'info' | 'error' } {
  if (!r.ok && !r.failed) return { text: '복구할 항목이 없습니다', kind: 'info' };
  if (!r.ok) return { text: `복구하지 못했습니다: ${r.error ?? '알 수 없는 오류'}`, kind: 'error' };
  const base = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '');
  const head = r.ok === 1 && items.length === 1
    ? (() => {
      const it = items[0];
      const to = r.paths[0] ?? '';
      const renamed = to && to !== it.path;
      return renamed ? `복구했습니다: ${trashLabel(it)} → ${base(to)} (같은 이름이 있어 이름을 바꿨습니다)` : `복구했습니다: ${trashLabel(it)}`;
    })()
    : `${r.ok}개를 복구했습니다`;
  return r.failed ? { text: `${head} (${r.failed}개 실패: ${r.error ?? '알 수 없는 오류'})`, kind: 'error' } : { text: head, kind: 'info' };
}
