import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useWorksStore } from '../../src/lib/works/store';
import type { WorksStore } from '../../src/lib/works/store';
import { snapshot, removeHistory, SNAPSHOT_INTERVAL_MS } from '../../src/lib/history';

// 저장소 호출 횟수를 세는 메모리 가짜 store
function fakeStore() {
  const rows = new Map<string, Map<string, { id: string; ts: number }>>(); // part -> id -> rec
  const calls = { list: 0, put: 0, remove: 0, parts: 0, removePart: 0 };
  const store = {
    async list(_c: string, part?: string) { calls.list++; return [...(rows.get(part!)?.values() ?? [])]; },
    async get() { return undefined; },
    async put(_c: string, rec: { id: string; ts: number }, part?: string) { calls.put++; if (!rows.has(part!)) rows.set(part!, new Map()); rows.get(part!)!.set(rec.id, rec); },
    async putMany() {},
    async remove(_c: string, id: string, part?: string) { calls.remove++; rows.get(part!)?.delete(id); },
    async parts() { calls.parts++; return [...rows.keys()]; },
    async removePart(_c: string, part: string) { calls.removePart++; rows.delete(part); },
    async movePart() {},
  };
  return { store: store as unknown as WorksStore, calls, rows };
}

describe('snapshot 5분 간격 캐시', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000_000_000); });
  afterEach(() => vi.useRealTimers());

  it('첫 호출은 저장소를 읽고, 5분 안의 다음 호출은 저장소를 부르지 않는다', async () => {
    const f = fakeStore();
    useWorksStore(f.store);
    await snapshot('d1', '첫 내용');
    expect(f.calls.list).toBe(1);
    expect(f.calls.put).toBe(1);
    await snapshot('d1', '둘째 내용');
    await snapshot('d1', '셋째 내용');
    expect(f.calls.list).toBe(1);
    expect(f.calls.put).toBe(1);
  });

  it('5분이 지나면 다시 읽고 새 버전을 남긴다', async () => {
    const f = fakeStore();
    useWorksStore(f.store);
    await snapshot('d1', 'a');
    vi.advanceTimersByTime(SNAPSHOT_INTERVAL_MS + 1);
    await snapshot('d1', 'b');
    expect(f.calls.list).toBe(2);
    expect(f.calls.put).toBe(2);
  });

  it('force 는 캐시와 무관하게 저장소를 읽는다', async () => {
    const f = fakeStore();
    useWorksStore(f.store);
    await snapshot('d1', 'a');
    await snapshot('d1', 'b', true);
    expect(f.calls.list).toBe(2);
    expect(f.calls.put).toBe(2);
  });

  it('다른 탭이 넣은 최근 버전이 있으면 첫 호출이 읽어서 건너뛰고, 이후는 저장소를 부르지 않는다', async () => {
    const f = fakeStore();
    useWorksStore(f.store);
    f.rows.set('d1', new Map([['x', { id: 'x', ts: Date.now() - 1000 }]]));
    await snapshot('d1', 'a');
    await snapshot('d1', 'b');
    expect(f.calls.list).toBe(1);
    expect(f.calls.put).toBe(0);
  });

  it('이력을 지우면 캐시도 비워 새 버전을 남길 수 있다', async () => {
    const f = fakeStore();
    useWorksStore(f.store);
    await snapshot('d1', 'a');
    await removeHistory('d1');
    await snapshot('d1', 'b');
    expect(f.calls.put).toBe(2);
  });

  it('같은 docKey 의 동시 호출은 줄을 서서 중복 버전을 만들지 않는다', async () => {
    const f = fakeStore();
    useWorksStore(f.store);
    await Promise.all([snapshot('d1', 'a'), snapshot('d1', 'a'), snapshot('d1', 'a')]);
    expect(f.calls.put).toBe(1);
    expect(f.rows.get('d1')!.size).toBe(1);
  });

  it('docKey 마다 따로 센다', async () => {
    const f = fakeStore();
    useWorksStore(f.store);
    await snapshot('d1', 'a');
    await snapshot('d2', 'a');
    expect(f.calls.put).toBe(2);
  });
});
