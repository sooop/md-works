// 저장 흐름의 순수 로직: 재시도 간격, 서버의 409 응답 분기, 선택 결과 해석, keepalive 크기 판정.
// 서버·스탠드얼론 모드가 함께 쓰며, 부수효과가 없어 단위 테스트로 검증한다.

const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60_000;

/** 연속 실패 n 회째 뒤 다음 재시도까지의 대기(ms): 2s → 4s → 8s … 60s 상한 */
export function backoffMs(failures: number): number {
  const n = Math.max(1, Math.floor(failures) || 1);
  if (n > 5) return BACKOFF_MAX_MS; // 2^n 이 커지기 전에 상한 처리
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
}

/** fetch keepalive 본문 한도는 64KB(진행 중인 요청 합산)라 여유를 두고 60,000 바이트까지만 쓴다 */
export const KEEPALIVE_LIMIT = 60_000;
export function fitsKeepalive(body: string): boolean {
  if (body.length > KEEPALIVE_LIMIT) return false; // UTF-8 은 문자당 1바이트 이상이라 길이가 넘으면 바이트도 넘는다
  return new TextEncoder().encode(body).length <= KEEPALIVE_LIMIT;
}

/** 서버 오류에서 읽은 상태 코드·본문 */
export interface ErrInfo { status?: number; body?: { error?: string; mtime?: number; message?: string } | null }

export type SaveFailure =
  | { kind: 'conflict'; mtime?: number; message: string }
  | { kind: 'gone'; message: string }
  | { kind: 'other' };

/** 저장(PUT) 실패를 분기한다: 409 conflict(외부 수정) / 409 gone(사라짐) / 그 밖 */
export function classifySaveError(e: ErrInfo | null | undefined): SaveFailure {
  if (e?.status === 409 && e.body) {
    if (e.body.error === 'conflict') {
      return { kind: 'conflict', mtime: typeof e.body.mtime === 'number' ? e.body.mtime : undefined, message: e.body.message ?? '' };
    }
    if (e.body.error === 'gone') return { kind: 'gone', message: e.body.message ?? '' };
  }
  return { kind: 'other' };
}

export const CONFLICT_BUTTONS = ['내 내용으로 덮어쓰기', '디스크 내용 불러오기', '취소'];
/** 스탠드얼론: 다른 탭이 먼저 저장했을 때(단추 순서는 CONFLICT_BUTTONS 와 같아 conflictAction 을 그대로 쓴다) */
export const TAB_CONFLICT_BUTTONS = ['내 내용으로 덮어쓰기', '다른 탭의 내용 불러오기', '취소'];
export const GONE_BUTTONS =['다시 만들기', '닫기(내용은 이력에 남김)', '취소'];
export const LEAVE_BUTTONS = ['저장하지 않고 이동', '내용 복사', '취소'];

export type ConflictAction = 'overwrite' | 'reload' | 'cancel';
export type GoneAction = 'recreate' | 'close' | 'cancel';
export type LeaveAction = 'leave' | 'copy' | 'cancel';

/** askChoose 의 결과(누른 단추 번호, 닫으면 -1)를 동작으로 바꾼다. 범위 밖은 모두 취소 */
export const conflictAction = (pick: number): ConflictAction => (pick === 0 ? 'overwrite' : pick === 1 ? 'reload' : 'cancel');
export const goneAction = (pick: number): GoneAction => (pick === 0 ? 'recreate' : pick === 1 ? 'close' : 'cancel');
export const leaveAction = (pick: number): LeaveAction => (pick === 0 ? 'leave' : pick === 1 ? 'copy' : 'cancel');

/** 이력에 남길 버전 이름 */
export function versionLabel(kind: 'external' | 'mine' | 'gone' | 'tab', when = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const t = `${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())} ${p(when.getHours())}:${p(when.getMinutes())}`;
  const head = kind === 'external' ? '외부 수정본' : kind === 'tab' ? '다른 탭 수정본' : kind === 'mine' ? '내 편집본' : '삭제된 글의 마지막 내용';
  return `${head} (${t})`;
}

/** 저장 요청이 응답할 때까지 문서가 바뀌었으면(세대 번호가 다르면) 그 결과는 버려야 한다 */
export const isStaleGen = (started: number, current: number): boolean => started !== current;

/** 저장 요청 본문: 알고 있는 mtime 은 baseMtime 으로, 덮어쓰기는 force 로 보낸다 */
export function saveBody(content: string, baseMtime: number | undefined, force: boolean): { content: string; baseMtime?: number; force?: true } {
  if (force) return { content, force: true };
  return baseMtime === undefined ? { content } : { content, baseMtime };
}
