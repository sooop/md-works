import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRecorder } from '../../src/lib/stats/recorder';
import { clearDays, commitDelta, mergeIntoStore, readDays, STATS_KEY, type Store } from '../../src/lib/stats/store';
import { KEEP_DAYS, addDays } from '../../src/lib/stats/logic';

const at = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
function memStore(): Store & { writes: number; raw: Map<string, string> } {
  const raw = new Map<string, string>();
  const s = {
    writes: 0, raw,
    getItem: (k: string) => raw.get(k) ?? null,
    setItem(k: string, v: string) { raw.set(k, v); s.writes++; },
    removeItem: (k: string) => { raw.delete(k); },
  };
  return s;
}

describe('증분만 더하는 쓰기', () => {
  it('다른 탭이 그 사이 쓴 값을 덮지 않는다', () => {
    const store = memStore();
    const now = at(2026, 11, 14);
    commitDelta({ '2026-11-14': 100 }, now, store); // 이 탭이 이전에 쓴 값
    // 다른 탭이 +50 을 더 썼다
    store.setItem(STATS_KEY, JSON.stringify({ days: { '2026-11-14': 150, '2026-11-13': 7 } }));
    commitDelta({ '2026-11-14': 30 }, now, store); // 이 탭은 메모리의 증분 30 만 더한다
    expect(readDays(store)).toEqual({ '2026-11-14': 180, '2026-11-13': 7 });
  });
  it('쓸 때 400일보다 오래된 날짜를 정리한다', () => {
    const store = memStore();
    const now = at(2026, 11, 14);
    const old = addDays('2026-11-14', -KEEP_DAYS);
    store.setItem(STATS_KEY, JSON.stringify({ days: { [old]: 5, '2026-11-01': 5 } }));
    commitDelta({ '2026-11-14': 1 }, now, store);
    expect(readDays(store)).toEqual({ '2026-11-01': 5, '2026-11-14': 1 });
  });
  it('저장소가 없어도 던지지 않는다', () => {
    expect(commitDelta({ '2026-11-14': 1 }, Date.now(), null)).toEqual({ '2026-11-14': 1 });
    expect(readDays(null)).toEqual({});
  });
  it('mergeIntoStore: 큰 값 우선', () => {
    const store = memStore();
    commitDelta({ '2026-11-14': 10, '2026-11-13': 50 }, at(2026, 11, 14), store);
    mergeIntoStore({ '2026-11-14': 20, '2026-11-13': 5 }, at(2026, 11, 14), store);
    expect(readDays(store)).toEqual({ '2026-11-14': 20, '2026-11-13': 50 });
  });
  it('clearDays', () => {
    const store = memStore();
    commitDelta({ '2026-11-14': 10 }, at(2026, 11, 14), store);
    clearDays(store);
    expect(readDays(store)).toEqual({});
  });
});

describe('기록기(디바운스)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('입력마다 쓰지 않고 2초 뒤 한 번만 쓴다', () => {
    const store = memStore();
    let now = at(2026, 11, 14, 10);
    const rec = createRecorder({ store, now: () => now });
    rec.track('a', 100);
    for (let i = 1; i <= 20; i++) { rec.track('a', 100 + i); vi.advanceTimersByTime(100); } // 2초 안의 연타
    expect(store.writes).toBe(0);
    expect(rec.view()['2026-11-14']).toBe(20); // 화면 값은 즉시 반영
    vi.advanceTimersByTime(2000);
    expect(store.writes).toBe(1);
    expect(readDays(store)).toEqual({ '2026-11-14': 20 });
    now += 1000;
  });
  it('flush(탭 숨김·pagehide)는 기다리지 않고 쓴다', () => {
    const store = memStore();
    const rec = createRecorder({ store, now: () => at(2026, 11, 14) });
    rec.track('a', 0);
    rec.track('a', 30);
    rec.flush();
    expect(readDays(store)).toEqual({ '2026-11-14': 30 });
    vi.advanceTimersByTime(5000);
    expect(store.writes).toBe(1); // 타이머가 또 쓰지 않는다
    rec.flush();
    expect(store.writes).toBe(1); // 모은 것이 없으면 쓰지 않는다
  });
  it('쓰기 직전에 다른 탭의 값을 다시 읽어 증분만 더한다', () => {
    const store = memStore();
    const rec = createRecorder({ store, now: () => at(2026, 11, 14) });
    rec.track('a', 0);
    rec.track('a', 10);
    store.setItem(STATS_KEY, JSON.stringify({ days: { '2026-11-14': 500 } })); // 다른 탭
    rec.flush();
    expect(readDays(store)).toEqual({ '2026-11-14': 510 });
    expect(rec.view()).toEqual({ '2026-11-14': 510 });
  });
  it('자정을 넘기면 새 날짜에 쌓인다', () => {
    const store = memStore();
    let now = at(2026, 11, 14, 23, 59);
    const rec = createRecorder({ store, now: () => now });
    rec.track('a', 0);
    rec.track('a', 10);
    now = at(2026, 11, 15, 0, 1);
    rec.track('a', 25);
    rec.flush();
    expect(readDays(store)).toEqual({ '2026-11-14': 10, '2026-11-15': 15 });
  });
  it('글 전환·큰 변화는 세지 않는다', () => {
    const store = memStore();
    const rec = createRecorder({ store, now: () => at(2026, 11, 14) });
    rec.track('a', 100);
    rec.track('a', 105);
    rec.track('b', 3000);
    rec.track('b', 9000); // +6000 붙여넣기
    rec.track('b', 9004);
    rec.flush();
    expect(readDays(store)).toEqual({ '2026-11-14': 9 });
  });
  it('clear 는 저장값과 모은 증분을 모두 지운다', () => {
    const store = memStore();
    const rec = createRecorder({ store, now: () => at(2026, 11, 14) });
    rec.track('a', 0);
    rec.track('a', 10);
    rec.clear();
    vi.advanceTimersByTime(5000);
    expect(readDays(store)).toEqual({});
    expect(rec.view()).toEqual({});
  });
});
