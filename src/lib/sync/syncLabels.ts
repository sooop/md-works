// 동기화 화면에 쓰는 순수 함수(문구·비율·키 입력 정리). 상태·DOM 에 의존하지 않는다.
import { LIMITS, type SyncProblem, type SyncStatus, type SyncUsage } from './protocol';

export type PhaseTone = 'ok' | 'busy' | 'warn' | 'error' | 'muted';

/** 상태 줄의 문구 */
export function phaseLabel(status: Pick<SyncStatus, 'phase' | 'lastError'>): string {
  switch (status.phase) {
    case 'off': return '동기화를 쓰지 않는 중';
    case 'idle': return '최신 상태입니다';
    case 'pending': return '올릴 변경을 기다리는 중…';
    case 'syncing': return '동기화하는 중…';
    case 'offline': return '오프라인입니다 — 연결되면 이어서 동기화합니다';
    case 'error': return status.lastError ? `동기화하지 못했습니다: ${problemTitle(status.lastError)}` : '동기화하지 못했습니다';
    case 'paused': return status.lastError ? `멈춤: ${problemTitle(status.lastError)}` : '멈춤';
  }
}

/** 상태 줄의 색·아이콘을 고르는 분류 */
export function phaseTone(phase: SyncStatus['phase']): PhaseTone {
  switch (phase) {
    case 'idle': return 'ok';
    case 'pending': case 'syncing': return 'busy';
    case 'offline': return 'warn';
    case 'error': return 'error';
    case 'paused': case 'off': return 'muted';
  }
}

/** 문제 카드의 제목 */
export function problemTitle(problem: Pick<SyncProblem, 'kind'>): string {
  switch (problem.kind) {
    case 'unauthorized': return '키를 확인하세요';
    case 'forbidden': return '서버가 이 기기를 받아 주지 않습니다';
    case 'rate-limited': return '오늘의 쓰기 한도에 도달했습니다';
    case 'unavailable': return '서버가 잠시 응답하지 않습니다';
    case 'item-too-large': return '너무 큰 글이 있습니다';
    case 'space-full': return '서버 저장 공간이 가득 찼습니다';
    case 'item-limit': return '항목 수 한도에 도달했습니다';
    case 'crypto': return '키가 맞지 않는 데이터가 있습니다';
    case 'network': return '서버에 연결하지 못했습니다';
    case 'mass-delete': return '대량 삭제를 확인해야 합니다';
  }
}

export interface UsageRatio { items: number; bytes: number; writes: number }
const ratio = (n: number, max: number) => (max > 0 ? Math.min(1, Math.max(0, n / max)) : 0);

/** 사용량 비율(0~1, 상한에서 자름). items·bytes·오늘 쓰기 */
export function usageRatio(usage: SyncUsage | undefined): UsageRatio {
  if (!usage) return { items: 0, bytes: 0, writes: 0 };
  return {
    items: ratio(usage.items, LIMITS.MAX_ITEMS_PER_SPACE),
    bytes: ratio(usage.bytes, LIMITS.MAX_SPACE_BYTES),
    writes: ratio(usage.dailyWrites, LIMITS.MAX_DAILY_WRITES),
  };
}

/** 사용량이 경고 색을 쓸 만큼 찼는가(80% 이상) */
export const NEAR_LIMIT = 0.8;
export const isNearLimit = (r: number) => r >= NEAR_LIMIT;

/** 키 입력 자동 정리: 공백·하이픈 제거, 대문자화, I·L→1, O→0(normalizeSyncKey 와 같은 규칙), 26자까지, 4자씩 '-' 로 끊는다 */
export function groupKeyInput(raw: string): string {
  const s = raw
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .slice(0, 26);
  return s.match(/.{1,4}/g)?.join('-') ?? '';
}
