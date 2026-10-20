// 글감의 글별 순서(orders[docKey], 작을수록 위)를 다루는 순수 함수. 저장·UI 와 분리해 단위 테스트한다.
import type { Snippet } from './types';

/** 정렬 값 사이 간격이 이보다 작아지면 그 글의 순서를 1,2,3… 로 다시 매긴다 */
export const MIN_GAP = 1e-6;

export interface OrderChange { id: string; order: number }

/** 새로 붙이는 글감이 놓일 값: 그 글에서 지금 가장 작은 값 − 1 (값을 가진 글감이 없으면 0) */
export function topOrder(all: Snippet[], docKey: string): number {
  let min = Infinity;
  for (const s of all) {
    const v = s.orders?.[docKey];
    if (typeof v === 'number' && Number.isFinite(v) && v < min) min = v;
  }
  return min === Infinity ? 0 : min - 1;
}

/** orders 에 한 글의 값을 넣은 새 객체 */
export const withOrder = (orders: Record<string, number> | undefined, docKey: string, v: number): Record<string, number> =>
  ({ ...(orders ?? {}), [docKey]: v });

/** orders 에서 한 글의 키를 뺀 새 객체(비면 undefined) */
export function withoutOrder(orders: Record<string, number> | undefined, docKey: string): Record<string, number> | undefined {
  if (!orders || !(docKey in orders)) return orders;
  const rest = Object.fromEntries(Object.entries(orders).filter(([k]) => k !== docKey));
  return Object.keys(rest).length ? rest : undefined;
}

/**
 * orders 의 키를 바꾼다. map 이 undefined 를 돌려주면 그 키는 버린다.
 * 같은 키로 모이면 먼저 나온 값을 유지한다. 비면 undefined.
 */
export function mapOrderKeys(orders: Record<string, number> | undefined, map: (key: string) => string | undefined): Record<string, number> | undefined {
  if (!orders) return undefined;
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(orders)) {
    const nk = map(k);
    if (nk !== undefined && !out.has(nk)) out.set(nk, v);
  }
  return out.size ? Object.fromEntries(out) : undefined;
}

/**
 * '이 글에 붙은 것' 보기의 순서: 값이 없는 글감이 맨 위(최근 수정 순), 그다음 값 오름차순(같으면 최근 수정 순).
 * 입력 배열은 바꾸지 않는다.
 */
export function sortForDoc(list: Snippet[], docKey: string): Snippet[] {
  const val = (s: Snippet) => s.orders?.[docKey];
  return [...list].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x === undefined && y === undefined) return b.updatedAt - a.updatedAt;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    return x - y || b.updatedAt - a.updatedAt;
  });
}

/**
 * orderedIds 에서 movingIds 를 한 덩어리로 떼어 targetIndex(원래 목록 기준 삽입 위치 0..n, 그 인덱스의 카드 앞)에 끼운다.
 * 덩어리 안의 순서는 원래 목록의 상대 순서를 유지한다. 목록에 없는 id 는 무시한다.
 */
export function moveBlock(orderedIds: string[], movingIds: string[], targetIndex: number): string[] {
  const set = new Set(movingIds);
  const block = orderedIds.filter((id) => set.has(id));
  if (!block.length) return [...orderedIds];
  const t = Math.max(0, Math.min(orderedIds.length, Math.round(targetIndex)));
  const before = orderedIds.slice(0, t).filter((id) => !set.has(id));
  const after = orderedIds.slice(t).filter((id) => !set.has(id));
  return [...before, ...block, ...after];
}

/**
 * 선택된 카드를 각각 한 칸 위(dir=-1)/아래(+1)로 옮긴다. 이미 끝에 닿은 카드·선택끼리 붙은 덩어리는 건드리지 않아
 * 불연속 선택도 상대 순서가 유지된다.
 */
export function shiftBlock(orderedIds: string[], movingIds: string[], dir: -1 | 1): string[] {
  const set = new Set(movingIds);
  const out = [...orderedIds];
  const idx = dir < 0 ? out.map((_, i) => i) : out.map((_, i) => out.length - 1 - i);
  for (const i of idx) {
    const j = i + dir;
    if (!set.has(out[i]) || j < 0 || j >= out.length || set.has(out[j])) continue;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 1,2,3… 로 다시 매기고 값이 달라지는 것만 돌려준다 */
function renumber(newIds: string[], current: (id: string) => number | undefined): OrderChange[] {
  return newIds.flatMap((id, i) => (current(id) === i + 1 ? [] : [{ id, order: i + 1 }]));
}

/**
 * newIds(바뀐 뒤 순서)에 맞도록 정렬 값을 다시 매긴다. 바뀐 글감만 돌려준다.
 * - 옮긴 글감(movingIds)과 값이 없거나 순서가 어긋난 글감만 새 값을 받고, 나머지 값은 그대로 둔다(updatedAt 갱신 대상 최소화).
 * - 새 값은 양옆 고정 값의 부동소수 중간값. 간격이 MIN_GAP 미만이면 전체를 1..n 으로 재번호한다.
 * - 순서가 그대로면 빈 배열.
 */
export function assignOrders(oldIds: string[], newIds: string[], movingIds: string[], current: (id: string) => number | undefined): OrderChange[] {
  if (oldIds.length === newIds.length && oldIds.every((id, i) => id === newIds[i])) return [];
  const moving = new Set(movingIds);
  // 고정: 옮기지 않았고 값이 있으며 앞선 고정 값보다 큰 것
  const fixed: boolean[] = [];
  let max = -Infinity;
  for (const id of newIds) {
    const v = current(id);
    const ok = !moving.has(id) && v !== undefined && Number.isFinite(v) && v > max;
    fixed.push(ok);
    if (ok) max = v!;
  }
  const next = new Map<string, number>();
  let lo: number | undefined;
  let i = 0;
  while (i < newIds.length) {
    if (fixed[i]) { lo = current(newIds[i]); i++; continue; }
    let j = i;
    while (j < newIds.length && !fixed[j]) j++;
    const hi = j < newIds.length ? current(newIds[j]) : undefined;
    const k = j - i;
    for (let m = 0; m < k; m++) {
      let v: number;
      if (lo === undefined && hi === undefined) v = m + 1;
      else if (hi === undefined) v = lo! + m + 1;
      else if (lo === undefined) v = hi - (k - m);
      else {
        if ((hi - lo) / (k + 1) < MIN_GAP) return renumber(newIds, current);
        v = lo + ((hi - lo) * (m + 1)) / (k + 1);
      }
      next.set(newIds[i + m], v);
    }
    i = j;
  }
  return [...next].filter(([id, v]) => current(id) !== v).map(([id, order]) => ({ id, order }));
}
