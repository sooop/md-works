// 글별 목표 분량: 입력 파싱·진행률 계산·localStorage 보관 (키 접두 'works.goal.')

export const GOAL_PREFIX = 'works.goal.';

/** 입력 문자열 → 목표 글자 수. 비었거나 0 이하·숫자가 아니면 null(목표 없음) */
export function parseGoal(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  const n = typeof input === 'number' ? input : Number(String(input).replace(/[,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.floor(n), 100_000_000);
}

export interface GoalProgress {
  /** 막대 채움 비율 0..1 */
  ratio: number;
  /** 정수 퍼센트 (100 초과 가능) */
  percent: number;
  reached: boolean;
}

export function goalProgress(count: number, goal: number | null): GoalProgress | null {
  if (!goal || goal <= 0) return null;
  const c = Math.max(0, count);
  return { ratio: Math.min(1, c / goal), percent: Math.floor((c / goal) * 100), reached: c >= goal };
}

/** '1,234 / 5,000자' */
export function formatProgress(count: number, goal: number): string {
  return `${count.toLocaleString('en-US')} / ${goal.toLocaleString('en-US')}자`;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const defaultStore = (): Store | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function loadGoal(docKey: string, store: Store | null = defaultStore()): number | null {
  if (!docKey || !store) return null;
  try { return parseGoal(store.getItem(GOAL_PREFIX + docKey)); } catch { return null; }
}

/** goal 이 null 이면 삭제 */
export function saveGoal(docKey: string, goal: number | null, store: Store | null = defaultStore()) {
  if (!docKey || !store) return;
  try {
    if (goal == null) store.removeItem(GOAL_PREFIX + docKey);
    else store.setItem(GOAL_PREFIX + docKey, String(goal));
  } catch { /* 저장 불가(용량·사생활 모드)는 무시 */ }
}
