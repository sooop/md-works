import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncEngine, hashItem, stableStringify } from '../../src/lib/sync/engine';
import { createMemoryMetaStore } from '../../src/lib/sync/metaStore';
import { LIMITS, SyncHttpError, type SyncRequest } from '../../src/lib/sync/protocol';
import { FakeServer, MemoryAdapter, fakeCodec } from './helpers';

class DeferAdapter extends MemoryAdapter {
  async apply(item: Parameters<MemoryAdapter['apply']>[0]) {
    if (item.kind === 'thread' && !this.items.has(`d${(item.data as { docName: string }).docName}`)) return 'deferred' as const;
    return super.apply(item);
  }
}

function device(
  server: FakeServer,
  o: { codec?: ReturnType<typeof fakeCodec>; auto?: boolean; now?: () => number; adapter?: MemoryAdapter; inviteCode?: string } = {},
) {
  const adapter = o.adapter ?? new MemoryAdapter();
  const meta = createMemoryMetaStore();
  const engine = createSyncEngine({
    config: { workerUrl: 'http://w', syncKey: 'K', inviteCode: o.inviteCode },
    adapter, meta, codec: o.codec ?? fakeCodec(), transport: server.transport(),
    autoSchedule: o.auto ?? false, now: o.now,
  });
  return { adapter, meta, engine };
}
const pushCount = (s: FakeServer) => s.requests.filter((r) => r.push.length > 0).length;
const net = () => new SyncHttpError(0, 'network');

afterEach(() => { vi.useRealTimers(); });

describe('해시', () => {
  it('키 순서가 달라도 같은 해시', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } })).toBe(stableStringify({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1 }));
    expect(hashItem({ deleted: false, data: { name: 'a', content: 'x' } })).toBe(hashItem({ deleted: false, data: { content: 'x', name: 'a' } }));
    expect(hashItem({ deleted: false, data: { name: 'a', content: 'x' } })).not.toBe(hashItem({ deleted: false, data: { name: 'a', content: 'y' } }));
  });
});

describe('기본 흐름', () => {
  it('오프라인에서 편집한 항목이 재접속 후 올라간다', async () => {
    const s = new FakeServer();
    const a = device(s);
    s.fail = () => net();
    a.adapter.putDoc('x', 'v1', 10);
    await a.engine.syncNow();
    expect(a.engine.status.phase).toBe('offline');
    expect(a.engine.status.lastError?.kind).toBe('network');
    expect(s.items.size).toBe(0);
    s.fail = null;
    await a.engine.syncNow();
    expect(a.engine.status.phase).toBe('idle');
    expect(s.items.get('dx')?.rev).toBe(1);
    expect((await a.meta.getAll())[0]).toMatchObject({ id: 'dx', rev: 1, deleted: false });
  });

  it('두 기기에 전파되고 자기 에코는 적용하지 않는다', async () => {
    const s = new FakeServer();
    const a = device(s), b = device(s);
    a.adapter.putDoc('x', 'v1', 10);
    await a.engine.syncNow();
    expect(a.adapter.applied).toHaveLength(0);
    await b.engine.syncNow();
    expect(b.adapter.content('dx')).toBe('v1');
    // 변경 없는 재동기화는 아무것도 올리지 않는다
    const before = pushCount(s);
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(pushCount(s)).toBe(before);
    expect(b.adapter.applied).toHaveLength(1);
  });

  it('pull 이 여러 페이지여도 모두 받는다', async () => {
    const s = new FakeServer();
    s.pageSize = 2;
    const a = device(s), b = device(s);
    for (let i = 0; i < 5; i++) a.adapter.putDoc(`n${i}`, `c${i}`, 10);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(b.adapter.items.size).toBe(5);
  });

  it('syncNow 는 진행 중이면 같은 Promise 를 돌려준다', async () => {
    const s = new FakeServer();
    const a = device(s);
    const p1 = a.engine.syncNow();
    const p2 = a.engine.syncNow();
    expect(p1).toBe(p2);
    await p1;
  });

  it('상태 변경을 구독자에게 알린다', async () => {
    const s = new FakeServer();
    const a = device(s);
    const phases: string[] = [];
    const off = a.engine.subscribe((st) => phases.push(st.phase));
    await a.engine.syncNow();
    off();
    expect([...new Set(phases)]).toEqual(['syncing', 'idle']);
    expect(a.engine.status.lastSyncAt).toBeGreaterThan(0);
  });

  it('삭제가 전파된다', async () => {
    const s = new FakeServer();
    const a = device(s), b = device(s);
    a.adapter.putDoc('x', 'v1', 10);
    await a.engine.syncNow();
    await b.engine.syncNow();
    a.adapter.del('dx');
    await a.engine.syncNow();
    expect(s.items.get('dx')).toMatchObject({ rev: 2, deleted: true });
    await b.engine.syncNow();
    expect(b.adapter.items.has('dx')).toBe(false);
    expect((await b.meta.getAll())[0]).toMatchObject({ rev: 2, deleted: true });
    // 삭제 항목은 다시 올라가지 않는다
    const before = pushCount(s);
    await b.engine.syncNow();
    expect(pushCount(s)).toBe(before);
  });

  it('서버가 삭제 blob 을 비워 돌려줘도 삭제를 적용한다', async () => {
    const s = new FakeServer();
    const a = device(s), b = device(s);
    a.adapter.putDoc('x', 'v1', 10);
    await a.engine.syncNow();
    await b.engine.syncNow();
    a.adapter.del('dx');
    await a.engine.syncNow();
    s.items.get('dx')!.blob = '';
    s.items.get('dx')!.seq = ++s.seq;
    await b.engine.syncNow();
    expect(b.adapter.items.has('dx')).toBe(false);
  });

  it('삭제 push 는 blob 에 data:null 평문을 암호화해 보낸다', async () => {
    const s = new FakeServer();
    const a = device(s);
    a.adapter.putDoc('x', 'v1', 10);
    await a.engine.syncNow();
    a.adapter.del('dx');
    await a.engine.syncNow();
    const req = s.requests.filter((r) => r.push.length).at(-1)!;
    expect(req.push[0]).toMatchObject({ id: 'dx', baseRev: 1, deleted: true });
    expect((await fakeCodec().decrypt('dx', req.push[0].blob)).data).toBeNull();
  });
});

describe('충돌', () => {
  async function twoDevices() {
    const s = new FakeServer();
    const a = device(s), b = device(s);
    a.adapter.putDoc('x', 'base', 10);
    await a.engine.syncNow();
    await b.engine.syncNow();
    return { s, a, b };
  }

  it('서버(다른 기기) 쪽이 더 새로우면 로컬 글은 preserveLoser 후 서버 사본이 적용된다', async () => {
    const { s, a, b } = await twoDevices();
    a.adapter.putDoc('x', 'from-a', 300);
    await a.engine.syncNow();
    b.adapter.putDoc('x', 'from-b', 200); // b 는 아직 a 의 변경을 모른다
    await b.engine.syncNow();
    expect(b.adapter.preserved.map((i) => (i.data as { content: string }).content)).toEqual(['from-b']);
    expect(b.adapter.content('dx')).toBe('from-a');
    expect(s.items.get('dx')!.rev).toBe(2);
    await a.engine.syncNow();
    expect(a.adapter.content('dx')).toBe('from-a');
    expect(a.adapter.preserved).toHaveLength(0);
  });

  it('로컬이 더 새로우면 서버 사본 rev 로 다시 올려 두 기기가 수렴한다', async () => {
    const { s, a, b } = await twoDevices();
    a.adapter.putDoc('x', 'from-a', 200);
    await a.engine.syncNow();
    b.adapter.putDoc('x', 'from-b', 300);
    await b.engine.syncNow();
    // 진 쪽은 서버 사본(from-a): 이긴 기기(b)의 이력에 남긴다
    expect(b.adapter.preserved.map((i) => (i.data as { content: string }).content)).toEqual(['from-a']);
    expect(s.items.get('dx')!.rev).toBe(3);
    await a.engine.syncNow();
    expect(a.adapter.content('dx')).toBe('from-b');
    expect(a.adapter.preserved.map((i) => (i.data as { content: string }).content)).toEqual([]);
  });

  it('push 충돌에서 진 로컬은 preserveLoser 된다(updatedAt 같으면 서버 우선)', async () => {
    const { s, a, b } = await twoDevices();
    a.adapter.putDoc('x', 'from-a', 500);
    await a.engine.syncNow();
    // b 의 풀이 a 의 변경을 못 보게 해서 push 단계에서 충돌을 낸다
    b.adapter.putDoc('x', 'from-b', 500);
    const origHandle = s.handle.bind(s);
    let first = true;
    s.handle = (req, inv) => {
      if (first && req.push.length === 0) { first = false; return { cursor: req.cursor, hasMore: false, accepted: [], conflicts: [], changes: [], usage: { items: 1, bytes: 0, dailyWrites: 0 } }; }
      return origHandle(req, inv);
    };
    await b.engine.syncNow();
    expect(b.adapter.preserved).toHaveLength(1);
    expect(b.adapter.content('dx')).toBe('from-a');
  });

  it('삭제 vs 수정: 다른 기기의 더 새로운 수정이 삭제를 이긴다', async () => {
    const { a, b } = await twoDevices();
    a.adapter.del('dx');
    // a 가 삭제를 올리기 전에 b 가 수정을 올린다
    b.adapter.putDoc('x', 'edited', 999);
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(a.adapter.content('dx')).toBe('edited');
  });

  it('삭제 vs 수정: 로컬 수정이 서버 삭제보다 새로우면 되살려 올린다', async () => {
    const s = new FakeServer();
    const a = device(s), b = device(s, { now: () => 500 });
    a.adapter.putDoc('x', 'base', 10);
    await a.engine.syncNow();
    await b.engine.syncNow();
    b.adapter.del('dx');
    await b.engine.syncNow();
    expect(s.items.get('dx')!.deleted).toBe(true);
    a.adapter.putDoc('x', 'alive', 999);
    await a.engine.syncNow();
    expect(s.items.get('dx')).toMatchObject({ deleted: false, rev: 3 });
    await b.engine.syncNow();
    expect(b.adapter.content('dx')).toBe('alive');
  });

  it('같은 이름의 새 글을 두 기기가 따로 만들어도 수렴한다', async () => {
    const s = new FakeServer();
    const a = device(s), b = device(s);
    a.adapter.putDoc('n', 'A', 100);
    await a.engine.syncNow();
    b.adapter.putDoc('n', 'B', 200);
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(a.adapter.content('dn')).toBe('B');
    expect(b.adapter.content('dn')).toBe('B');
    expect(a.adapter.preserved).toHaveLength(0);
  });
});

describe('오류 처리', () => {
  it('401: paused, 자동 동기화 중단', async () => {
    vi.useFakeTimers();
    const s = new FakeServer();
    const a = device(s, { auto: true });
    s.fail = () => new SyncHttpError(401, 'unauthorized');
    a.engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.engine.status.phase).toBe('paused');
    expect(a.engine.status.lastError?.kind).toBe('unauthorized');
    const n = s.requests.length;
    a.adapter.putDoc('x', 'v', 1);
    a.engine.markDirty();
    await vi.advanceTimersByTimeAsync(LIMITS.PULL_MAX_ITEMS * 10_000);
    expect(s.requests.length).toBe(n);
    // 설정을 고친 뒤 resume
    s.fail = null;
    a.engine.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.engine.status.phase).toBe('idle');
    expect(s.items.has('dx')).toBe(true);
    a.engine.stop();
  });

  it('403: paused forbidden, 재시도하지 않는다', async () => {
    vi.useFakeTimers();
    const s = new FakeServer();
    const a = device(s, { auto: true });
    s.fail = () => new SyncHttpError(403, 'forbidden');
    a.engine.start();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(a.engine.status).toMatchObject({ phase: 'paused', lastError: { kind: 'forbidden' } });
    expect(s.requests.length).toBe(1);
    a.engine.stop();
  });

  it('429: 푸시만 멈추고 풀은 계속한다. retryAt 은 다음 00:00 UTC', async () => {
    const s = new FakeServer();
    const t = Date.UTC(2026, 0, 1, 12);
    const a = device(s, { now: () => t }), b = device(s);
    b.adapter.putDoc('z', 'zz', 5);
    await b.engine.syncNow();
    s.maxDailyWrites = 0;
    a.adapter.putDoc('x', 'v', 10);
    await a.engine.syncNow();
    expect(a.adapter.content('dz')).toBe('zz'); // 풀은 계속
    expect(a.engine.status.phase).toBe('error');
    expect(a.engine.status.lastError).toMatchObject({ kind: 'rate-limited', retryAt: Date.UTC(2026, 0, 2) });
    const n = pushCount(s);
    await a.engine.syncNow();
    expect(pushCount(s)).toBe(n); // 더 시도하지 않음
    expect(a.adapter.items.has('dx')).toBe(true);
  });

  it('503: Retry-After 부터 지수 백오프', async () => {
    vi.useFakeTimers();
    const s = new FakeServer();
    const a = device(s, { auto: true });
    s.fail = (_r, n) => (n <= 2 ? new SyncHttpError(503, 'unavailable', 10) : undefined);
    a.engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.engine.status).toMatchObject({ phase: 'error', lastError: { kind: 'unavailable' } });
    expect(a.engine.status.lastError?.retryAt).toBe(Date.now() + 10_000);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(s.requests.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.requests.length).toBe(2); // 두 번째도 실패 -> 20초
    await vi.advanceTimersByTimeAsync(19_999);
    expect(s.requests.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.requests.length).toBe(3);
    expect(a.engine.status.phase).toBe('idle');
    a.engine.stop();
  });

  it('503 Retry-After 가 없으면 30초, 상한 10분', async () => {
    vi.useFakeTimers();
    const s = new FakeServer();
    const a = device(s, { auto: true });
    s.fail = () => new SyncHttpError(503, 'unavailable');
    a.engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.engine.status.lastError?.retryAt).toBe(Date.now() + 30_000);
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(600_000);
    expect(a.engine.status.lastError?.retryAt! - Date.now()).toBeLessThanOrEqual(600_000);
    a.engine.stop();
  });

  it('네트워크 오류 뒤 online 이벤트에서 재시도한다', async () => {
    vi.useFakeTimers();
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal('window', { addEventListener: (k: string, f: () => void) => { listeners[k] = f; }, removeEventListener: () => {} });
    try {
      const s = new FakeServer();
      const a = device(s, { auto: true });
      s.fail = () => net();
      a.adapter.putDoc('x', 'v', 1);
      a.engine.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(a.engine.status.phase).toBe('offline');
      s.fail = null;
      listeners.online();
      await vi.advanceTimersByTimeAsync(0);
      expect(a.engine.status.phase).toBe('idle');
      expect(s.items.has('dx')).toBe(true);
      a.engine.stop();
    } finally { vi.unstubAllGlobals(); }
  });

  it('413: 배치를 반으로 나눠 재시도한다', async () => {
    const s = new FakeServer();
    s.maxBodyItems = 2;
    const a = device(s);
    for (let i = 0; i < 5; i++) a.adapter.putDoc(`n${i}`, 'c', 1);
    await a.engine.syncNow();
    expect(s.items.size).toBe(5);
    expect(a.engine.status.oversize).toEqual([]);
  });

  it('413: 단일 항목도 거부되면 oversize 로 기록하고 나머지는 올린다', async () => {
    const s = new FakeServer();
    s.fail = (r) => (r.push.some((p) => p.id === 'dbig') ? new SyncHttpError(413, 'body_too_large') : undefined);
    const a = device(s);
    a.adapter.putDoc('big', 'B', 1);
    a.adapter.putDoc('ok', 'O', 1);
    await a.engine.syncNow();
    expect(s.items.has('dok')).toBe(true);
    expect(s.items.has('dbig')).toBe(false);
    expect(a.engine.status.oversize.map((o) => o.id)).toEqual(['dbig']);
    expect(a.engine.status.lastError?.kind).toBe('item-too-large');
  });

  it('422 item_too_large: 항목별로 걸러 나머지를 올린다', async () => {
    const s = new FakeServer();
    s.fail = (r) => (r.push.some((p) => p.id === 'dbad') ? new SyncHttpError(422, 'item_too_large') : undefined);
    const a = device(s);
    for (const n of ['a', 'bad', 'c', 'd']) a.adapter.putDoc(n, 'x', 1);
    await a.engine.syncNow();
    expect([...s.items.keys()].sort()).toEqual(['da', 'dc', 'dd']);
    expect(a.engine.status.oversize.map((o) => o.id)).toEqual(['dbad']);
  });

  it('blob 이 MAX_ITEM_BYTES 를 넘으면 보내지 않고 oversize 로 기록한다', async () => {
    const s = new FakeServer();
    const a = device(s);
    a.adapter.putDoc('huge', 'x'.repeat(LIMITS.MAX_ITEM_BYTES + 10), 1);
    a.adapter.putDoc('ok', 'x', 1);
    await a.engine.syncNow();
    expect(a.engine.status.oversize).toHaveLength(1);
    expect(a.engine.status.oversize[0].label).toBe('huge');
    expect([...s.items.keys()]).toEqual(['dok']);
  });

  it('422 space_full/item_limit: 푸시 중단, 풀은 계속', async () => {
    for (const [code, kind] of [['space_full', 'space-full'], ['item_limit', 'item-limit']] as const) {
      const s = new FakeServer();
      const b = device(s);
      b.adapter.putDoc('z', 'zz', 5);
      await b.engine.syncNow();
      s.fail = (r) => (r.push.length ? new SyncHttpError(422, code) : undefined);
      const a = device(s);
      a.adapter.putDoc('x', 'v', 1);
      await a.engine.syncNow();
      expect(a.adapter.content('dz')).toBe('zz');
      expect(a.engine.status).toMatchObject({ phase: 'error', lastError: { kind } });
      expect(s.items.has('dx')).toBe(false);
    }
  });

  it('복호화 실패: crypto 오류, 자동 재시도 없음', async () => {
    vi.useFakeTimers();
    const s = new FakeServer();
    const b = device(s, { codec: fakeCodec('other') });
    b.adapter.putDoc('x', 'v', 1);
    await b.engine.syncNow();
    const a = device(s, { auto: true });
    a.engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.engine.status).toMatchObject({ phase: 'error', lastError: { kind: 'crypto' } });
    const n = s.requests.length;
    a.engine.markDirty();
    await vi.advanceTimersByTimeAsync(400_000);
    expect(s.requests.length).toBe(n);
    expect(a.adapter.items.size).toBe(0);
    a.engine.stop();
  });

  it('첫 요청에만 초대 코드를 보내고 성공하면 onInviteUsed 를 부른다', async () => {
    const s = new FakeServer();
    const a = device(s, { inviteCode: 'INV' });
    const used = vi.fn();
    a.engine.onInviteUsed = used;
    a.adapter.putDoc('x', 'v', 1);
    await a.engine.syncNow();
    expect(s.invites[0]).toBe('INV');
    expect(s.invites.slice(1).every((i) => i === undefined)).toBe(true);
    expect(used).toHaveBeenCalledTimes(1);
  });
});

describe('스케줄', () => {
  it('markDirty 는 5초 디바운스 뒤 푸시한다', async () => {
    vi.useFakeTimers();
    const s = new FakeServer();
    const a = device(s, { auto: true });
    a.adapter.putDoc('x', 'v', 1);
    a.engine.markDirty();
    expect(a.engine.status.phase).toBe('pending');
    await vi.advanceTimersByTimeAsync(3_000);
    a.engine.markDirty(); // 디바운스 재시작
    await vi.advanceTimersByTimeAsync(4_999);
    expect(s.requests.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.items.has('dx')).toBe(true);
    expect(a.engine.status.phase).toBe('idle');
    a.engine.stop();
  });

  it('같은 항목은 30초에 한 번만 푸시한다', async () => {
    vi.useFakeTimers();
    const s = new FakeServer();
    const a = device(s, { auto: true });
    a.adapter.putDoc('x', 'v1', 1);
    a.engine.markDirty();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.items.get('dx')!.rev).toBe(1);
    a.adapter.putDoc('x', 'v2', 2);
    a.engine.markDirty();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.items.get('dx')!.rev).toBe(1);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(s.items.get('dx')!.rev).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.items.get('dx')!.rev).toBe(2);
    a.engine.stop();
  });

  it('일일 쓰기 한도 80% 이상이면 throttled, 푸시 간격 5분', async () => {
    vi.useFakeTimers();
    const s = new FakeServer();
    s.dailyWrites = LIMITS.MAX_DAILY_WRITES * 0.8;
    const a = device(s, { auto: true });
    a.adapter.putDoc('x', 'v1', 1);
    await a.engine.syncNow();
    expect(a.engine.status.throttled).toBe(true);
    a.adapter.putDoc('x', 'v2', 2);
    a.engine.markDirty();
    await vi.advanceTimersByTimeAsync(299_000);
    expect(s.items.get('dx')!.rev).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.items.get('dx')!.rev).toBe(2);
    a.engine.stop();
  });

  it('start 는 즉시 한 번 동기화하고 180초마다 풀한다', async () => {
    vi.useFakeTimers();
    const s = new FakeServer();
    const a = device(s, { auto: true });
    a.engine.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.requests.length).toBe(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(s.requests.length).toBe(2);
    a.engine.stop();
    await vi.advanceTimersByTimeAsync(400_000);
    expect(s.requests.length).toBe(2);
  });

  it('화면이 숨겨지면 대기 중 푸시를 즉시 한다', async () => {
    vi.useFakeTimers();
    const handlers: Record<string, () => void> = {};
    const doc = { visibilityState: 'visible', addEventListener: (k: string, f: () => void) => { handlers[k] = f; }, removeEventListener: () => {} };
    vi.stubGlobal('document', doc);
    try {
      const s = new FakeServer();
      const a = device(s, { auto: true });
      a.engine.start();
      await vi.advanceTimersByTimeAsync(0);
      a.adapter.putDoc('x', 'v', 1);
      a.engine.markDirty();
      doc.visibilityState = 'hidden';
      handlers.visibilitychange();
      await vi.advanceTimersByTimeAsync(0);
      expect(s.items.has('dx')).toBe(true);
      a.engine.stop();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('대량 삭제 가드', () => {
  async function setup(n = 10) {
    const s = new FakeServer();
    const a = device(s);
    for (let i = 0; i < n; i++) a.adapter.putDoc(`n${i}`, `c${i}`, 1);
    await a.engine.syncNow();
    return { s, a };
  }

  it('6개 이상·절반 이상 사라지면 푸시를 멈추고 paused', async () => {
    const { s, a } = await setup();
    for (let i = 0; i < 8; i++) a.adapter.del(`dn${i}`);
    const n = pushCount(s);
    await a.engine.syncNow();
    expect(a.engine.status.phase).toBe('paused');
    expect(a.engine.status.massDelete).toEqual({ missing: 8, total: 10 });
    expect(pushCount(s)).toBe(n);
    expect([...s.items.values()].some((x) => x.deleted)).toBe(false);
  });

  it('5개 이하이거나 절반 미만이면 통과', async () => {
    const { s, a } = await setup();
    for (let i = 0; i < 5; i++) a.adapter.del(`dn${i}`);
    await a.engine.syncNow();
    expect(a.engine.status.phase).toBe('idle');
    expect([...s.items.values()].filter((x) => x.deleted)).toHaveLength(5);

    const s2 = await setup(20);
    for (let i = 0; i < 8; i++) s2.a.adapter.del(`dn${i}`);
    await s2.a.engine.syncNow();
    expect(s2.a.engine.status.phase).toBe('idle');
    expect([...s2.s.items.values()].filter((x) => x.deleted)).toHaveLength(8);
  });

  it("'proceed' 는 삭제를 서버에 반영한다", async () => {
    const { s, a } = await setup();
    for (let i = 0; i < 8; i++) a.adapter.del(`dn${i}`);
    await a.engine.syncNow();
    await a.engine.resolveMassDelete('proceed');
    expect(a.engine.status.massDelete).toBeUndefined();
    expect(a.engine.status.phase).toBe('idle');
    expect([...s.items.values()].filter((x) => x.deleted)).toHaveLength(8);
  });

  it("'restore' 는 서버 사본을 다시 받는다", async () => {
    const { s, a } = await setup();
    for (let i = 0; i < 8; i++) a.adapter.del(`dn${i}`);
    await a.engine.syncNow();
    await a.engine.resolveMassDelete('restore');
    expect(a.adapter.items.size).toBe(10);
    expect(a.engine.status.phase).toBe('idle');
    expect([...s.items.values()].some((x) => x.deleted)).toBe(false);
  });

  it('listLocal 이 실패하면 삭제를 올리지 않는다', async () => {
    const { s, a } = await setup();
    a.adapter.failList = true;
    await a.engine.syncNow();
    expect(a.engine.status.phase).toBe('error');
    expect([...s.items.values()].some((x) => x.deleted)).toBe(false);
  });
});

describe('resyncRequired', () => {
  async function setup() {
    const s = new FakeServer();
    const a = device(s);
    a.adapter.putDoc('a', 'A', 1);
    a.adapter.putDoc('b', 'B', 1);
    await a.engine.syncNow();
    const other = device(s);
    other.adapter.putDoc('e', 'E', 1);
    await other.engine.syncNow(); // a 의 커서보다 큰 seq 를 만든다
    s.drop('da');
    s.purgedSeq = s.seq; // a 의 커서(2)보다 큼
    return { s, a };
  }

  it('서버에 없는 로컬 항목을 모아 묻고 푸시를 보류한다', async () => {
    const { s, a } = await setup();
    a.adapter.putDoc('c', 'new', 5);
    const n = pushCount(s);
    await a.engine.syncNow();
    expect(a.engine.status.phase).toBe('idle');
    expect(a.engine.status.resync?.orphans).toEqual([{ id: 'da', kind: 'doc', label: 'a' }]);
    expect(pushCount(s)).toBe(n);
    expect(s.items.has('dc')).toBe(false);
    // 다음 사이클에도 보류가 유지된다
    await a.engine.syncNow();
    expect(a.engine.status.resync).toBeDefined();
    expect(pushCount(s)).toBe(n);
  });

  it("'upload' 는 baseRev 0 새 항목으로 올린다", async () => {
    const { s, a } = await setup();
    await a.engine.syncNow();
    await a.engine.resolveResync('upload');
    expect(a.engine.status.resync).toBeUndefined();
    expect(s.items.get('da')?.rev).toBe(1);
    expect(s.requests.at(-1 - 1)!.push[0]).toMatchObject({ id: 'da', baseRev: 0 });
  });

  it("'delete' 는 로컬에서 지우고 메타도 지운다", async () => {
    const { s, a } = await setup();
    await a.engine.syncNow();
    await a.engine.resolveResync('delete');
    expect(a.adapter.removed.map((i) => i.id)).toEqual(['da']);
    expect(a.adapter.items.has('da')).toBe(false);
    expect((await a.meta.getAll()).map((m) => m.id)).toEqual(['db', 'de']);
    expect(s.items.has('da')).toBe(false);
    expect(a.engine.status.resync).toBeUndefined();
  });

  it('고아가 없으면 묻지 않고 커서를 갱신한다', async () => {
    const s = new FakeServer();
    const a = device(s);
    a.adapter.putDoc('a', 'A', 1);
    await a.engine.syncNow();
    const other = device(s);
    other.adapter.putDoc('e', 'E', 1);
    await other.engine.syncNow();
    s.purgedSeq = s.seq;
    await a.engine.syncNow();
    expect(a.engine.status.resync).toBeUndefined();
    expect((await a.meta.getState()).cursor).toBe(s.seq);
  });
});

describe('deferred 재적용', () => {
  it('같은 동기화 안에서 글을 적용한 뒤 보류된 스레드를 다시 적용한다', async () => {
    const s = new FakeServer();
    const b = device(s);
    b.adapter.putThread('t-1', 'x', 1); // 스레드가 먼저 올라간다
    b.adapter.putDoc('x', 'doc', 1);
    await b.engine.syncNow();
    const a = device(s, { adapter: new DeferAdapter() });
    await a.engine.syncNow();
    expect(a.adapter.items.has('t-1')).toBe(true);
    expect(a.adapter.items.has('dx')).toBe(true);
    expect((await a.meta.getAll()).every((m) => !m.pending)).toBe(true);
  });

  it('글이 아직 없으면 pending 을 유지하고 다음 사이클에 다시 시도한다', async () => {
    const s = new FakeServer();
    const b = device(s);
    b.adapter.putThread('t-1', 'x', 1);
    await b.engine.syncNow();
    const a = device(s, { adapter: new DeferAdapter() });
    await a.engine.syncNow();
    expect(a.adapter.items.has('t-1')).toBe(false);
    expect((await a.meta.getAll()).find((m) => m.id === 't-1')?.pending).toBe(true);
    // 보류 항목을 삭제로 오해해 올리지 않는다
    expect(s.items.get('t-1')).toMatchObject({ rev: 1, deleted: false });
    b.adapter.putDoc('x', 'doc', 1);
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(a.adapter.items.has('t-1')).toBe(true);
    expect((await a.meta.getAll()).find((m) => m.id === 't-1')?.pending).toBeFalsy();
    expect(s.items.get('t-1')!.rev).toBe(1);
  });
});

describe('서버 계약: 실제 서버와의 통합에서 발견된 경우', () => {
  it('서버에 없는 항목에 baseRev>0 으로 올려 conflicts{rev 0, deleted, 빈 blob} 를 받으면 로컬을 지우지 않고 baseRev 0 으로 다시 올린다', async () => {
    const s = new FakeServer();
    const a = device(s);
    a.adapter.putDoc('x', 'v1', 10);
    await a.engine.syncNow();
    s.drop('dx'); // 서버에서 사라짐(purged_seq 는 그대로)
    a.adapter.putDoc('x', 'v2', 20);
    // 실제 서버처럼 '없는 항목 + baseRev>0' 은 rev 0 삭제 사본 conflict 로 답한다
    const real = s.handle.bind(s);
    s.handle = (req, inv) => {
      const miss = req.push.filter((p) => p.baseRev > 0 && !s.items.has(p.id));
      const ok = { ...req, push: req.push.filter((p) => !miss.includes(p)) };
      const r = real(ok, inv);
      r.conflicts.push(...miss.map((p) => ({ id: p.id, rev: 0, deleted: true, blob: '' })));
      return r;
    };
    await a.engine.syncNow();
    expect(a.engine.status.lastError).toBeUndefined();
    expect(a.adapter.content('dx')).toBe('v2');
    expect(s.items.get('dx')).toMatchObject({ rev: 1, deleted: false });
  });

  it('서버가 정리 뒤 항목을 낮은 rev 로 다시 만들어도(받는 기기의 메타 rev 가 더 큼) 적용한다', async () => {
    const s = new FakeServer();
    const a = device(s);
    const b = device(s);
    a.adapter.putDoc('x', 'v1', 10);
    await a.engine.syncNow();
    a.adapter.putDoc('x', 'v2', 20);
    await a.engine.syncNow(); // rev 2
    await b.engine.syncNow();
    s.drop('dx'); // 서버가 정리해 없앤 뒤
    const c = device(s);
    c.adapter.putDoc('x', 'v3', 30);
    await c.engine.syncNow(); // rev 1 로 새로 생성
    await b.engine.syncNow();
    expect(b.adapter.content('dx')).toBe('v3');
  });
});
