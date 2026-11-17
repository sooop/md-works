import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createTransport, splitPushBatches } from '../../src/lib/sync/transport';
import { createIdbMetaStore, createMemoryMetaStore } from '../../src/lib/sync/metaStore';
import { LIMITS, SyncHttpError, type PushItem } from '../../src/lib/sync/protocol';

const cfg = { workerUrl: 'https://w.example.workers.dev/', appId: 'md-works', spaceId: 'sp', authToken: 'tok' };
const okBody = { cursor: 1, hasMore: false, accepted: [], conflicts: [], changes: [], usage: { items: 0, bytes: 0, dailyWrites: 0 } };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('createTransport', () => {
  it('헤더·본문·credentials omit', async () => {
    const f = vi.fn(async () => json(okBody));
    const t = createTransport(cfg, f as unknown as typeof fetch);
    const res = await t.sync({ cursor: 3, push: [] }, { inviteCode: 'INV' });
    expect(res.cursor).toBe(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://w.example.workers.dev/v1/sync');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toEqual({
      'X-App-Id': 'md-works', 'X-Space-Id': 'sp', Authorization: 'Bearer tok', 'Content-Type': 'application/json', 'X-Invite-Code': 'INV',
    });
    expect(JSON.parse(init.body as string)).toEqual({ cursor: 3, push: [] });
  });

  it('초대 코드가 없으면 헤더를 보내지 않는다', async () => {
    const f = vi.fn(async () => json(okBody));
    await createTransport(cfg, f as unknown as typeof fetch).sync({ cursor: 0, push: [] });
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty('X-Invite-Code');
  });

  it('비 2xx 는 SyncHttpError(status, code, retryAfter)', async () => {
    const t = createTransport(cfg, (async () => json({ error: 'unavailable' }, 503, { 'Retry-After': '12' })) as typeof fetch);
    await expect(t.sync({ cursor: 0, push: [] })).rejects.toMatchObject({ status: 503, code: 'unavailable', retryAfterSec: 12 });
    const t2 = createTransport(cfg, (async () => json({ error: 'daily_write_limit' }, 429)) as typeof fetch);
    await expect(t2.sync({ cursor: 0, push: [] })).rejects.toMatchObject({ status: 429, code: 'daily_write_limit', retryAfterSec: undefined });
    const t3 = createTransport(cfg, (async () => new Response('oops', { status: 500 })) as typeof fetch);
    await expect(t3.sync({ cursor: 0, push: [] })).rejects.toMatchObject({ status: 500, code: 'unknown' });
  });

  it('fetch 실패(TypeError)는 network', async () => {
    const t = createTransport(cfg, (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch);
    const err = await t.sync({ cursor: 0, push: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(SyncHttpError);
    expect(err).toMatchObject({ status: 0, code: 'network' });
  });
});

describe('splitPushBatches', () => {
  const item = (i: number, size: number): PushItem => ({ id: `i${i}`, baseRev: 0, deleted: false, blob: 'x'.repeat(size) });

  it('20건씩 나눈다', () => {
    const batches = splitPushBatches(Array.from({ length: 45 }, (_, i) => item(i, 10)));
    expect(batches.map((b) => b.length)).toEqual([20, 20, 5]);
  });

  it('본문 400KB 를 넘지 않게 나누고 순서를 지킨다', () => {
    const items = Array.from({ length: 10 }, (_, i) => item(i, 100_000));
    const batches = splitPushBatches(items);
    for (const b of batches) expect(JSON.stringify({ cursor: 0, push: b }).length).toBeLessThanOrEqual(LIMITS.SOFT_BODY_BYTES);
    expect(batches.flat().map((x) => x.id)).toEqual(items.map((x) => x.id));
    expect(batches.length).toBe(4);
  });

  it('상한을 넘는 단일 항목은 단독 묶음, 빈 입력은 빈 배열', () => {
    expect(splitPushBatches([item(0, 500_000), item(1, 10)]).map((b) => b.length)).toEqual([1, 1]);
    expect(splitPushBatches([])).toEqual([]);
  });
});

describe('메타 저장소', () => {
  const m = (id: string, rev = 1) => ({ id, rev, hash: 'h', updatedAt: 1, deleted: false });
  for (const [name, make] of [
    ['메모리', () => createMemoryMetaStore()],
    ['IndexedDB', () => createIdbMetaStore(`t-${Math.random()}`)],
  ] as const) {
    it(`${name}: put/putMany/remove/state/clear`, async () => {
      const s = make();
      expect(await s.getState()).toEqual({ cursor: 0, lastSyncAt: 0 });
      await s.put(m('a'));
      await s.putMany([m('b'), m('c', 3)]);
      await s.remove('b');
      expect((await s.getAll()).map((x) => x.id).sort()).toEqual(['a', 'c']);
      await s.setState({ cursor: 7 });
      await s.setState({ lastSyncAt: 99 });
      expect(await s.getState()).toEqual({ cursor: 7, lastSyncAt: 99 });
      await s.clear();
      expect(await s.getAll()).toEqual([]);
      expect(await s.getState()).toEqual({ cursor: 0, lastSyncAt: 0 });
    });
  }
});
