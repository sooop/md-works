// 집필 통계 저장: localStorage `works.stats` 에 `{ days }`. 서버 모드에서도 정본은 여기다(서버 폴더에는 쓰지 않는다).
import { addDelta, cleanDays, dateKey, mergeDays, parseStats, pruneDays, serializeStats, type Days } from './logic';

export const STATS_KEY = 'works.stats';
export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const defaultStore = (): Store | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function readDays(store: Store | null = defaultStore()): Days {
  try { return store ? parseStats(store.getItem(STATS_KEY)) : {}; } catch { return {}; }
}

function write(store: Store | null, days: Days, nowMs: number): Days {
  const out = pruneDays(cleanDays(days), dateKey(nowMs));
  try { store?.setItem(STATS_KEY, serializeStats(out)); } catch { /* 가득 찼거나 막혔으면 이번 기록은 건너뛴다 */ }
  return out;
}

/** 저장된 값을 다시 읽어 이번에 모은 증분만 더해 쓴다(다른 탭이 그 사이 쓴 값을 덮지 않는다). 쓴 결과를 돌려준다 */
export function commitDelta(delta: Days, nowMs: number, store: Store | null = defaultStore()): Days {
  return write(store, addDelta(readDays(store), delta), nowMs);
}

/** 다른 기기(번들)의 기록을 날짜별 큰 값 우선으로 합쳐 쓴다 */
export function mergeIntoStore(incoming: Days, nowMs: number, store: Store | null = defaultStore()): Days {
  return write(store, mergeDays(readDays(store), incoming), nowMs);
}

export function clearDays(store: Store | null = defaultStore()) {
  try { store?.removeItem(STATS_KEY); } catch { /* 무시 */ }
}
