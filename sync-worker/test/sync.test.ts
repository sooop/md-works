import { beforeEach, describe, expect, it } from 'vitest';
import { handleRequest, type Env } from '../src/handler.ts';
import { D1Shim } from './d1shim.ts';
import { LIMITS } from '../../src/lib/sync/protocol.ts';
import { DEFAULT_LIMITS } from '../src/limits.ts';

const T0 = Date.UTC(2026, 10, 17, 12);
const DAY = 86_400_000;

let db: D1Shim;
let env: Env;
let clock: { t: number };
let rnd: number;

beforeEach(() => {
  db = new D1Shim();
  env = { DB: db, INVITE_CODE: 'inv', ALLOWED_APPS: 'md-works' };
  clock = { t: T0 };
  rnd = 1; // 정리 비활성
});

interface CallOpts {
  space?: string; token?: string; app?: string; invite?: string | null;
  body?: unknown; raw?: string; headers?: Record<string, string>;
}
async function call(o: CallOpts = {}, e: Env = env) {
  const headers: Record<string, string> = {
    'X-App-Id': o.app ?? 'md-works',
    'X-Space-Id': o.space ?? 'space1',
    Authorization: `Bearer ${o.token ?? 'tok'}`,
    'Content-Type': 'application/json',
    ...o.headers,
  };
  if (o.invite !== null) headers['X-Invite-Code'] = o.invite ?? 'inv';
  const res = await handleRequest(
    new Request('https://w.example/v1/sync', {
      method: 'POST', headers, body: o.raw ?? JSON.stringify(o.body ?? { cursor: 0, push: [] }),
    }),
    e, { now: () => clock.t, random: () => rnd },
  );
  return { status: res.status, res, json: (await res.json()) as any };
}
const put = (id: string, baseRev: number, blob = 'QUJD', deleted = false) => ({ id, baseRev, deleted, blob });
const push = (cursor: number, ...items: ReturnType<typeof put>[]) => ({ cursor, push: items });
const count = (sql: string) => (db.sqlite.prepare(sql).get() as any).c as number;

describe('계약', () => {
  it('limits 기본값이 protocol.ts LIMITS 와 같다', () => {
    for (const k of Object.keys(DEFAULT_LIMITS) as (keyof typeof DEFAULT_LIMITS)[]) {
      expect(DEFAULT_LIMITS[k]).toBe(LIMITS[k]);
    }
  });
  it('health 는 D1 을 읽지 않는다', async () => {
    db.fail = true;
    const r = await handleRequest(new Request('https://w/v1/health'), env);
    expect(await r.json()).toEqual({ ok: true });
  });
  it('OPTIONS 는 CORS', async () => {
    const r = await handleRequest(new Request('https://w/v1/sync', { method: 'OPTIONS' }), env);
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(r.headers.get('Access-Control-Allow-Headers')).toContain('X-Invite-Code');
    expect(r.headers.get('Access-Control-Max-Age')).toBe('7200');
  });
  it('응답에 CORS 헤더가 있다', async () => {
    const r = await call();
    expect(r.res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('1. 초대 코드', () => {
  it('없거나 틀리면 403, 맞으면 생성', async () => {
    expect((await call({ invite: null })).status).toBe(403);
    expect((await call({ invite: 'wrong' })).status).toBe(403);
    expect(count('SELECT COUNT(*) c FROM spaces')).toBe(0);
    const ok = await call();
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ cursor: 0, hasMore: false, accepted: [], conflicts: [], changes: [], usage: { items: 0, bytes: 0, dailyWrites: 0 } });
    expect((await call({ invite: null })).status).toBe(200);
  });
  it('허용되지 않은 앱·공간 수 초과는 403', async () => {
    expect((await call({ app: 'other-app' })).status).toBe(403);
    const e = { ...env, MAX_SPACES: '2' };
    expect((await call({ space: 'a' }, e)).status).toBe(200);
    expect((await call({ space: 'b' }, e)).status).toBe(200);
    expect((await call({ space: 'c' }, e)).status).toBe(403);
    expect((await call({ space: 'a', invite: null }, e)).status).toBe(200);
  });
  it('INVITE_CODE 가 비어 있으면 아무 코드도 통하지 않는다', async () => {
    expect((await call({ invite: '' }, { ...env, INVITE_CODE: '' })).status).toBe(403);
  });
});

describe('2. 인증', () => {
  it('잘못된 토큰·헤더 누락은 401', async () => {
    await call();
    expect((await call({ token: 'bad' })).status).toBe(401);
    expect((await call({ headers: { Authorization: '' } })).status).toBe(401);
    expect((await call({ app: 'Bad_App' })).status).toBe(401);
    expect((await call({ token: 'bad' })).json).toEqual({ error: 'unauthorized' });
  });
  it('서버에는 토큰이 아니라 SHA-256 만 저장된다', async () => {
    await call();
    const row = db.sqlite.prepare('SELECT token_hash FROM spaces').get() as any;
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(db.dump()).not.toContain('"tok"');
  });
});

describe('3. 공간 격리', () => {
  it('다른 공간·다른 토큰의 항목을 읽을 수 없다', async () => {
    await call({ body: push(0, put('x1', 0, 'U0VDUkVU')) });
    await call({ space: 'space2', token: 'tok2' });
    const r = await call({ space: 'space2', token: 'tok2' });
    expect(r.json.changes).toEqual([]);
    expect((await call({ space: 'space1', token: 'tok2' })).status).toBe(401);
    expect((await call({ space: 'space2', token: 'tok' })).status).toBe(401);
  });
  it('같은 spaceId 라도 appId 가 다르면 401', async () => {
    const e = { ...env, ALLOWED_APPS: 'md-works,other' };
    await call({}, e);
    expect((await call({ app: 'other', invite: null }, e)).status).toBe(401);
  });
});

describe('4. 한도', () => {
  it('item_too_large: 요청 전체 거부(다른 항목도 안 올라감)', async () => {
    const e = { ...env, MAX_ITEM_BYTES: '10' };
    const r = await call({ body: push(0, put('a', 0, 'AAAA'), put('b', 0, 'A'.repeat(11))) }, e);
    expect(r.status).toBe(422);
    expect(r.json).toEqual({ error: 'item_too_large' });
    expect(count('SELECT COUNT(*) c FROM items')).toBe(0);
  });
  it('item_limit', async () => {
    const e = { ...env, MAX_ITEMS_PER_SPACE: '2' };
    expect((await call({ body: push(0, put('a', 0), put('b', 0)) }, e)).status).toBe(200);
    const r = await call({ body: push(0, put('c', 0)) }, e);
    expect([r.status, r.json]).toEqual([422, { error: 'item_limit' }]);
    expect((await call({ body: push(0, put('a', 1, 'WA==')) }, e)).status).toBe(200);
  });
  it('삭제한 항목은 개수에서 빠진다', async () => {
    const e = { ...env, MAX_ITEMS_PER_SPACE: '1' };
    await call({ body: push(0, put('a', 0)) }, e);
    const r = await call({ body: push(0, put('a', 1, '', true)) }, e);
    expect(r.json.usage.items).toBe(0);
    expect((await call({ body: push(0, put('b', 0)) }, e)).status).toBe(200);
  });
  it('space_full', async () => {
    const e = { ...env, MAX_SPACE_BYTES: '10' };
    expect((await call({ body: push(0, put('a', 0, 'A'.repeat(8))) }, e)).status).toBe(200);
    const r = await call({ body: push(0, put('b', 0, 'A'.repeat(8))) }, e);
    expect([r.status, r.json]).toEqual([422, { error: 'space_full' }]);
    const shrink = await call({ body: push(0, put('a', 1, 'AA')) }, e);
    expect(shrink.status).toBe(200);
    expect(shrink.json.usage.bytes).toBe(2);
  });
  it('daily_write_limit 와 UTC 날짜 리셋', async () => {
    const e = { ...env, MAX_DAILY_WRITES: '3' };
    expect((await call({ body: push(0, put('a', 0), put('b', 0)) }, e)).json.usage.dailyWrites).toBe(2);
    const r = await call({ body: push(0, put('c', 0), put('d', 0)) }, e);
    expect([r.status, r.json]).toEqual([429, { error: 'daily_write_limit' }]);
    expect((await call({ body: push(0, put('c', 0)) }, e)).json.usage.dailyWrites).toBe(3);
    clock.t += DAY;
    const next = await call({ body: push(0, put('d', 0)) }, e);
    expect(next.status).toBe(200);
    expect(next.json.usage.dailyWrites).toBe(1);
    clock.t += DAY;
    const w = db.writes;
    expect((await call({}, e)).json.usage.dailyWrites).toBe(0);
    expect(db.writes).toBe(w);
  });
  it('413: Content-Length 와 실제 길이', async () => {
    const e = { ...env, MAX_BODY_BYTES: '200' };
    await call({}, e);
    const a = await call({ headers: { 'Content-Length': '999' }, body: { cursor: 0, push: [] } }, e);
    expect([a.status, a.json]).toEqual([413, { error: 'body_too_large' }]);
    const b = await call({ raw: JSON.stringify({ cursor: 0, push: [], pad: 'x'.repeat(300) }) }, e);
    expect(b.status).toBe(413);
  });
  it('413: push 21건', async () => {
    await call();
    const items = Array.from({ length: 21 }, (_, i) => put(`i${i}`, 0));
    expect((await call({ body: push(0, ...items) })).status).toBe(413);
    expect((await call({ body: push(0, ...items.slice(0, 20)) })).status).toBe(200);
  });
  it('잘못된 본문은 400', async () => {
    await call();
    expect((await call({ raw: 'not json' })).status).toBe(400);
    expect((await call({ body: { cursor: -1, push: [] } })).status).toBe(400);
    expect((await call({ body: { cursor: 0, push: [{ id: 'bad id!', baseRev: 0, deleted: false, blob: '' }] } })).status).toBe(400);
  });
  it('D1 예외는 503 + Retry-After', async () => {
    await call();
    db.fail = true;
    const r = await call();
    expect(r.status).toBe(503);
    expect(r.json).toEqual({ error: 'unavailable' });
    expect(r.res.headers.get('Retry-After')).toBeTruthy();
  });
});

describe('5. 충돌', () => {
  it('같은 baseRev 로 두 번 보내면 한쪽만 수락', async () => {
    const first = await call({ body: push(0, put('a', 0, 'QQ==')) });
    expect(first.json.accepted).toEqual([{ id: 'a', rev: 1 }]);
    const second = await call({ body: push(0, put('a', 0, 'Qg==')) });
    expect(second.json.accepted).toEqual([]);
    expect(second.json.conflicts).toEqual([{ id: 'a', rev: 1, deleted: false, blob: 'QQ==' }]);
    const row = db.sqlite.prepare("SELECT blob, rev FROM items WHERE item_id='a'").get() as any;
    expect([row.blob, row.rev]).toEqual(['QQ==', 1]);
    const third = await call({ body: push(0, put('a', 1, 'Qw==')) });
    expect(third.json.accepted).toEqual([{ id: 'a', rev: 2 }]);
  });
  it('같은 push 안 중복 id 는 첫 것만', async () => {
    const r = await call({ body: push(0, put('a', 0, 'AA'), put('a', 0, 'BB')) });
    expect(r.json.accepted).toEqual([{ id: 'a', rev: 1 }]);
    expect((db.sqlite.prepare("SELECT blob FROM items WHERE item_id='a'").get() as any).blob).toBe('AA');
  });
  it('서버에 없는 항목에 baseRev>0 이면 rev 0 삭제 사본을 conflicts 로', async () => {
    await call();
    const r = await call({ body: push(0, put('zz', 3)) });
    expect(r.json.conflicts).toEqual([{ id: 'zz', rev: 0, deleted: true, blob: '' }]);
  });
});

describe('6. 변경 없는 요청은 쓰기 0', () => {
  it('읽기·빈 push·충돌만 있는 요청', async () => {
    await call({ body: push(0, put('a', 0)) });
    const w = db.writes;
    await call({ body: { cursor: 0, push: [] } });
    await call({ body: { cursor: 1, push: [] } });
    await call({ body: push(1, put('a', 0)) });
    expect(db.writes).toBe(w);
  });
  it('쓰기 요청의 문장 수는 1 + 항목 수(정리 없을 때)', async () => {
    await call();
    const w = db.writes;
    await call({ body: push(0, put('a', 0), put('b', 0), put('c', 0)) });
    expect(db.writes - w).toBe(4);
  });
});

describe('7. blob 불투명', () => {
  it('blob 은 base64 문자열 그대로 저장되고 덤프에 평문이 없다', async () => {
    const plain = 'TOP-SECRET-PLAINTEXT';
    const blob = Buffer.from('\x01\x02cipher-bytes-xyz').toString('base64');
    await call({ body: push(0, put('a', 0, blob)) });
    const stored = db.sqlite.prepare("SELECT blob, size FROM items WHERE item_id='a'").get() as any;
    expect(stored.blob).toBe(blob);
    expect(stored.size).toBe(blob.length);
    expect(db.dump()).not.toContain(plain);
    const back = await call();
    expect(back.json.changes[0].blob).toBe(blob);
  });
});

describe('8. 삭제·정리·resync', () => {
  it('삭제가 changes 로 전파된다', async () => {
    await call({ body: push(0, put('a', 0, 'QQ==')) });
    const del = await call({ body: push(0, put('a', 1, 'ignored', true)) });
    expect(del.json.accepted).toEqual([{ id: 'a', rev: 2 }]);
    const r = await call({ body: { cursor: 1, push: [] } });
    expect(r.json.changes).toEqual([{ id: 'a', rev: 2, deleted: true, blob: '' }]);
  });

  it('보관 기간이 지난 삭제 항목은 정리되고 purged_seq 가 오른다', async () => {
    await call({ body: push(0, put('a', 0), put('b', 0)) }); // seq 1,2
    await call({ body: push(0, put('a', 1, '', true)) }); // a: seq 3, 삭제
    clock.t += 31 * DAY;
    rnd = 0;
    const r = await call({ body: push(0, put('c', 0)) }); // c: seq 4
    expect(r.status).toBe(200);
    const ids = (db.sqlite.prepare('SELECT item_id FROM items ORDER BY seq').all() as any[]).map((x) => x.item_id);
    expect(ids).toEqual(['b', 'c']);
    expect(count('SELECT purged_seq c FROM spaces')).toBe(3);
    // 보관 기간 안의 삭제 항목은 남는다
    await call({ body: push(0, put('b', 1, '', true)) });
    await call({ body: push(0, put('c', 1, 'QQ==')) });
    expect(count("SELECT deleted c FROM items WHERE item_id='b'")).toBe(1);
  });

  it('정리는 쓰기 요청이 아니면 일어나지 않는다', async () => {
    await call({ body: push(0, put('a', 0)) });
    await call({ body: push(0, put('a', 1, '', true)) });
    clock.t += 31 * DAY;
    rnd = 0;
    await call({ body: { cursor: 0, push: [] } });
    expect(count('SELECT COUNT(*) c FROM items')).toBe(1);
  });

  it('오래된 커서는 resyncRequired, push 는 무시, cursor 0 기준 changes', async () => {
    await call({ body: push(0, put('a', 0), put('b', 0)) });
    await call({ body: push(0, put('a', 1, '', true)) }); // seq 3
    clock.t += 31 * DAY;
    rnd = 0;
    await call({ body: push(0, put('c', 0)) }); // 정리, purged_seq 3
    rnd = 1;
    const r = await call({ body: push(2, put('zzz', 0)) });
    expect(r.json.resyncRequired).toBe(true);
    expect(r.json.accepted).toEqual([]);
    expect(r.json.changes.map((c: any) => c.id).sort()).toEqual(['b', 'c']);
    expect(count("SELECT COUNT(*) c FROM items WHERE item_id='zzz'")).toBe(0);
    expect((await call({ body: { cursor: 0, push: [] } })).json.resyncRequired).toBeUndefined();
    expect((await call({ body: { cursor: 3, push: [] } })).json.resyncRequired).toBeUndefined();
  });
});

describe('pull 페이지', () => {
  it('50건 상한과 hasMore/cursor', async () => {
    await call();
    for (let k = 0; k < 3; k++) {
      const items = Array.from({ length: 20 }, (_, i) => put(`i${k * 20 + i}`, 0));
      await call({ body: push(0, ...items) });
    }
    const p1 = await call({ body: { cursor: 0, push: [] } });
    expect(p1.json.changes).toHaveLength(50);
    expect(p1.json.hasMore).toBe(true);
    expect(p1.json.cursor).toBe(50);
    const p2 = await call({ body: { cursor: 50, push: [] } });
    expect(p2.json.changes).toHaveLength(10);
    expect(p2.json.hasMore).toBe(false);
    expect(p2.json.cursor).toBe(60);
    expect(p1.json.changes[0].id).toBe('i0');
  });
  it('누적 blob 바이트 상한', async () => {
    const e = { ...env, PULL_MAX_BYTES: '100' };
    await call({ body: push(0, put('a', 0, 'A'.repeat(60)), put('b', 0, 'B'.repeat(60)), put('c', 0, 'C'.repeat(30))) }, e);
    const p1 = await call({ body: { cursor: 0, push: [] } }, e);
    expect(p1.json.changes.map((c: any) => c.id)).toEqual(['a']);
    expect(p1.json.hasMore).toBe(true);
    expect(p1.json.cursor).toBe(1);
    const p2 = await call({ body: { cursor: 1, push: [] } }, e);
    expect(p2.json.changes.map((c: any) => c.id)).toEqual(['b', 'c']);
    expect(p2.json.hasMore).toBe(false);
    expect(p2.json.cursor).toBe(3);
  });
  it('자기가 쓴 항목도 changes 에 포함되고 seq 는 단조 증가', async () => {
    const r = await call({ body: push(0, put('a', 0), put('b', 0)) });
    expect(r.json.changes.map((c: any) => c.id)).toEqual(['a', 'b']);
    expect(r.json.cursor).toBe(2);
    const r2 = await call({ body: push(2, put('a', 1, 'WA==')) });
    expect(r2.json.changes.map((c: any) => c.id)).toEqual(['a']);
    expect(r2.json.cursor).toBe(3);
  });
});
