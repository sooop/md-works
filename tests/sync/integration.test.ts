// @vitest-environment node
// 동기화 전 구간 통합: 실제 서버 핸들러(+D1 shim) · 실제 코덱/키 · 실제 전송 · 실제 엔진/메타 저장소 · 실제 어댑터(+fake-indexeddb).
import { describe, expect, it } from 'vitest';
import { standaloneDevice } from '../bundle/helpers';
import { D1Shim } from '../../sync-worker/test/d1shim';
import { createSyncAdapter, docItemId, snippetItemId, threadItemId } from '../../src/lib/sync/adapter';
import { createSyncEngine } from '../../src/lib/sync/engine';
import { createIdbMetaStore } from '../../src/lib/sync/metaStore';
import { createCodec } from '../../src/lib/sync/codec';
import { deriveKeys, generateSyncKey } from '../../src/lib/sync/keys';
import { createTransport } from '../../src/lib/sync/transport';
import { APP_ID, type SyncRequest, type SyncResponse } from '../../src/lib/sync/protocol';
import type { Snippet, Thread } from '../../src/lib/works/types';

// sync-worker 의 소스는 '.ts' 확장자로 서로 import 해 루트 tsconfig(svelte-check)가 받아들이지 못한다. 런타임에만 읽는다.
interface Env { DB: unknown; INVITE_CODE?: string; ALLOWED_APPS?: string; [k: string]: unknown }
type HandleRequest = (request: Request, env: Env, deps?: { now?: () => number; random?: () => number }) => Promise<Response>;
const HANDLER_PATH = '../../sync-worker/src/handler.ts';
const { handleRequest } = (await import(/* @vite-ignore */ HANDLER_PATH)) as { handleRequest: HandleRequest };

const URL_BASE = 'https://sync.test';
const INVITE = 'invite-code';
const DAY = 86_400_000;

// ───────── 서버 ─────────
interface Exchange { req: SyncRequest; status: number; res?: SyncResponse; invite: string | null }
function makeServer(vars: Record<string, string | undefined> = {}) {
  const db = new D1Shim();
  const env: Env = { DB: db, INVITE_CODE: INVITE, ALLOWED_APPS: 'md-works', ...vars };
  const s = {
    db, env,
    clockOffset: 0,
    random: 1, // 정리 비활성
    log: [] as Exchange[],
    /** 다음 요청 본문을 이 문자열로 바꿔 보낸다(400 시험) */
    mangleBody: null as string | null,
    fetch: (async (url: string, init: RequestInit) => {
      const body = s.mangleBody ?? (init.body as string);
      s.mangleBody = null;
      const resp = await handleRequest(new Request(url, { ...init, body }), env, { now: () => Date.now() + s.clockOffset, random: () => s.random });
      let res: SyncResponse | undefined;
      if (resp.status === 200) res = (await resp.clone().json()) as SyncResponse;
      let req: SyncRequest;
      try { req = JSON.parse(body); } catch { req = { cursor: -1, push: [] }; }
      s.log.push({ req, status: resp.status, res, invite: new Headers(init.headers).get('X-Invite-Code') });
      return resp;
    }) as typeof fetch,
    sqlite: (sql: string) => db.sqlite.prepare(sql).all() as Record<string, unknown>[],
  };
  return s;
}
type Server = ReturnType<typeof makeServer>;

// ───────── 기기 ─────────
let seqN = 0;
async function makeDevice(server: Server, syncKey: string, opts: { invite?: boolean } = { invite: true }) {
  const dev = standaloneDevice();
  const adapter = createSyncAdapter({ host: dev.host, dbName: dev.dbName });
  const keys = await deriveKeys(syncKey, APP_ID);
  const transport = createTransport({ workerUrl: URL_BASE, appId: APP_ID, spaceId: keys.spaceId, authToken: keys.authToken }, server.fetch);
  const meta = createIdbMetaStore(`works-sync-it-${seqN++}`);
  const engine = createSyncEngine({
    config: { workerUrl: URL_BASE, syncKey, ...(opts.invite === false ? {} : { inviteCode: INVITE }) },
    adapter, meta, codec: createCodec(keys.encKey), transport, autoSchedule: false,
  });
  return { dev, adapter, meta, engine, keys };
}
type Device = Awaited<ReturnType<typeof makeDevice>>;

const snip = (id: string, extra: Partial<Snippet> = {}): Snippet => ({
  id, body: `본문 ${id}`, color: 'yellow', createdAt: 10, updatedAt: 20, attachedDocs: [], ...extra,
});
const thread = (id: string, docKey: string, extra: Partial<Thread> = {}): Thread => ({
  id, docKey, anchor: { quote: 'q', prefix: 'p', suffix: 's' }, messages: [{ id: 'm1', text: '스레드 메시지', ts: 5 }],
  resolved: false, createdAt: 6, updatedAt: 7, ...extra,
});

/** A 기기에 글 3편(폴더 글 포함)·글감·스레드를 채운다 */
async function populate(A: Device) {
  const kA = await A.dev.putDoc('폴더/글A.md', '# 글A\r\n본문 idb:11111111-1111-1111-1111-111111111111  \r\n끝', 100);
  const kB = await A.dev.putDoc('글B.md', '글B 본문\n\n\n줄 끝 공백  \n', 200);
  const kC = await A.dev.putDoc('Note C.md', '', 300);
  await A.dev.store.put('snippets', snip('sn1', { attachedDocs: [kA, kB], orders: { [kA]: 3, [kB]: 1 }, source: { url: 'http://x.test', title: 'T', excerpt: 'E' } }));
  await A.dev.store.put('snippets', snip('sn2', { deletedAt: 50, trashedFrom: [kA], attachedDocs: [], updatedAt: 51 }));
  await A.dev.store.put('snippets', snip('sn3', { body: '', purged: true, deletedAt: 60, updatedAt: 61 }));
  await A.dev.store.put('threads', thread('th1', kA), kA);
  return { kA, kB, kC };
}

const metaMap = async (d: Device) => new Map((await d.meta.getAll()).map((m) => [m.id, m]));
const revs = async (d: Device) => [...(await metaMap(d)).values()].map((m) => `${m.id}:${m.rev}`).sort();
async function ok(...ds: Device[]) {
  for (const d of ds) {
    await d.engine.syncNow();
    expect(d.engine.status.lastError, JSON.stringify(d.engine.status.lastError)).toBeUndefined();
    expect(d.engine.status.phase).toBe('idle');
  }
}
/** 변경 없이 한 번 더 sync 해도 서버 쓰기·rev 변화가 없다 */
async function expectQuiet(server: Server, ...ds: Device[]) {
  for (let i = 0; i < 2; i++) {
    for (const d of ds) {
      const before = await revs(d);
      const w = server.db.writes;
      await ok(d);
      expect(server.db.writes, '서버 쓰기').toBe(w);
      expect(await revs(d)).toEqual(before);
    }
  }
}
const snippetsOf = async (d: Device) => Object.fromEntries((await d.dev.store.list<Snippet>('snippets')).map((s) => [s.id, s]));

// ───────── 시나리오 ─────────
describe('동기화 전 구간 통합', () => {
  it('(a) A 의 글·글감·스레드가 B 에 도착하고 B 의 docKey 로 연결된다 + (e) 이후 조용하다', async () => {
    const server = makeServer();
    const key = generateSyncKey();
    const A = await makeDevice(server, key);
    const B = await makeDevice(server, key);
    await B.dev.putDoc('다른.md', 'x', 1); // B 의 docKey 가 A 와 달라지게(이 글은 B 에서 A 로도 간다)
    const k = await populate(A);

    await ok(A);
    await ok(B);
    expect(await B.dev.names()).toEqual(['Note C.md', '글B.md', '다른.md', '폴더/글A.md']);
    expect(await B.dev.doc('폴더/글A.md')).toBe('# 글A\r\n본문 idb:11111111-1111-1111-1111-111111111111  \r\n끝');
    expect(await B.dev.doc('글B.md')).toBe('글B 본문\n\n\n줄 끝 공백  \n');
    const kA = (await B.dev.key('폴더/글A.md'))!;
    const kB = (await B.dev.key('글B.md'))!;
    expect(kA).not.toBe(k.kA);
    const sn = await snippetsOf(B);
    expect(sn.sn1).toMatchObject({ attachedDocs: [kA, kB], orders: { [kA]: 3, [kB]: 1 }, source: { url: 'http://x.test' } });
    expect(sn.sn2).toMatchObject({ deletedAt: 50, trashedFrom: [kA] });
    expect(sn.sn3).toMatchObject({ purged: true });
    const ts = await B.dev.store.list<Thread>('threads', kA);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ id: 'th1', docKey: kA, messages: [{ id: 'm1', text: '스레드 메시지', ts: 5 }] });

    // (e) 모든 종류 항목에서 dirty 루프 없음. 가장 먼저 B 의 '받은 직후' 한 번(위 ok(B) 직후 푸시된 것이 없어야 한다)
    await ok(A);
    await expectQuiet(server, A, B);
  });

  it('(e) 받기만 한 기기는 서버에 아무것도 쓰지 않는다(적용 데이터 == listLocal 데이터)', async () => {
    const server = makeServer();
    const key = generateSyncKey();
    const A = await makeDevice(server, key);
    const B = await makeDevice(server, key);
    await populate(A);
    await ok(A);
    const written = server.db.writes;
    await ok(B);
    expect(server.db.writes).toBe(written); // B 의 첫 sync 는 쓰기 0
    const mB = await metaMap(B);
    const mA = await metaMap(A);
    for (const [id, m] of mA) expect(mB.get(id)?.rev, id).toBe(m.rev);
    // 적용 데이터와 listLocal 데이터가 같다
    const la = (await A.adapter.listLocal()).sort((x, y) => x.id.localeCompare(y.id));
    const lb = (await B.adapter.listLocal()).sort((x, y) => x.id.localeCompare(y.id));
    expect(lb).toEqual(la);
    await expectQuiet(server, B, A);
    // 서버 rev 는 모두 1
    expect(server.sqlite('SELECT DISTINCT rev FROM items')).toEqual([{ rev: 1 }]);
  });

  it('(b) B 가 글을 고치면 A 에 반영된다', async () => {
    const server = makeServer();
    const key = generateSyncKey();
    const A = await makeDevice(server, key);
    const B = await makeDevice(server, key);
    await populate(A);
    await ok(A, B);
    await B.dev.putDoc('글B.md', '글B 수정본', 5000);
    const kB = (await B.dev.key('글B.md'))!;
    await B.dev.store.put('snippets', snip('sn1', { body: 'B 가 고친 글감', updatedAt: 5000, attachedDocs: [kB] }));
    await ok(B, A);
    expect(await A.dev.doc('글B.md')).toBe('글B 수정본');
    const sn = await snippetsOf(A);
    expect(sn.sn1.body).toBe('B 가 고친 글감');
    expect(sn.sn1.attachedDocs).toEqual([(await A.dev.key('글B.md'))!]);
    await expectQuiet(server, A, B);
  });

  it('(c) 오프라인에서 같은 글을 각각 수정하면 수렴하고 진 쪽은 이력에 남는다', async () => {
    const server = makeServer();
    const key = generateSyncKey();
    const A = await makeDevice(server, key);
    const B = await makeDevice(server, key);
    await A.dev.putDoc('공유.md', '처음', 100);
    await ok(A, B);
    await A.dev.putDoc('공유.md', 'A 의 수정', 1000);
    await B.dev.putDoc('공유.md', 'B 의 수정', 2000); // 더 늦다 → B 승
    await ok(B); // 더 늦은 B 가 먼저 올림
    await ok(A); // A 는 충돌 → 진 A 의 본문이 이력으로 남고 B 의 본문이 적용됨
    await ok(B);
    expect(await A.dev.doc('공유.md')).toBe('B 의 수정');
    expect(await B.dev.doc('공유.md')).toBe('B 의 수정');
    const vs = await A.dev.versions('공유.md');
    expect(vs.some((v) => v.text === 'A 의 수정' && /^동기화 전\(\d{4}-\d{2}-\d{2}\)$/.test(v.name ?? ''))).toBe(true);
    await expectQuiet(server, A, B);

    await expectQuiet(server, A, B);
  });

  it('(c2) 오래된 쪽이 먼저 올려도(서버 사본이 진 쪽) 이긴 기기의 이력에 진 본문이 남고 한 값으로 수렴한다', async () => {
    const server = makeServer();
    const key = generateSyncKey();
    const A = await makeDevice(server, key);
    const B = await makeDevice(server, key);
    await A.dev.putDoc('공유.md', '처음', 100);
    await ok(A, B);
    await A.dev.putDoc('공유.md', 'A 오래된 수정', 1000);
    await B.dev.putDoc('공유.md', 'B 늦은 수정', 2000);
    await ok(A); // 오래된 A 가 먼저 올림
    await ok(B); // B 는 로컬이 이겨 서버 사본(A 본문)을 이력에 남기고 올림
    await ok(A);
    expect(await A.dev.doc('공유.md')).toBe('B 늦은 수정');
    expect(await B.dev.doc('공유.md')).toBe('B 늦은 수정');
    const vb = (await B.dev.versions('공유.md')).filter((v) => v.text === 'A 오래된 수정' && /^동기화 전\(\d{4}-\d{2}-\d{2}\)$/.test(v.name ?? ''));
    expect(vb).toHaveLength(1);
    await ok(B, A);
    expect((await B.dev.versions('공유.md')).filter((v) => v.text === 'A 오래된 수정')).toHaveLength(1); // 반복해도 한 개
    await expectQuiet(server, A, B);

    // 반대 방향: 늦은 쪽(A)이 먼저 올리고 오래된 쪽(B)이 나중에 sync
    await A.dev.putDoc('공유.md', 'A 2차(늦음)', 9000);
    await B.dev.putDoc('공유.md', 'B 2차(오래됨)', 8000);
    await ok(A);
    await ok(B);
    await ok(A);
    expect(await B.dev.doc('공유.md')).toBe('A 2차(늦음)');
    expect(await A.dev.doc('공유.md')).toBe('A 2차(늦음)');
    expect((await B.dev.versions('공유.md')).filter((v) => v.text === 'B 2차(오래됨)' && /^동기화 전/.test(v.name ?? ''))).toHaveLength(1);
    await expectQuiet(server, A, B);
  });

  it('(d) A 의 글 삭제가 B 에 전파되고 글감 연결·스레드가 정리된다 (+ 위험 1: 빈 blob 삭제 항목)', async () => {
    const server = makeServer();
    const key = generateSyncKey();
    const A = await makeDevice(server, key);
    const B = await makeDevice(server, key);
    await populate(A);
    await ok(A, B);
    const kA = (await B.dev.key('폴더/글A.md'))!;
    expect((await B.dev.store.list('threads', kA)).length).toBe(1);

    await A.dev.host.deleteDoc('폴더/글A.md');
    await ok(A);
    const del = server.sqlite(`SELECT item_id, deleted, blob FROM items WHERE item_id = '${docItemId('폴더/글A.md')}'`);
    expect(del).toEqual([{ item_id: docItemId('폴더/글A.md'), deleted: 1, blob: '' }]); // 서버는 빈 blob
    await ok(B);
    expect(await B.dev.names()).toEqual(['Note C.md', '글B.md']);
    expect(await B.dev.store.list('threads', kA)).toEqual([]);
    expect((await snippetsOf(B)).sn1.attachedDocs).toEqual([(await B.dev.key('글B.md'))!]);
    // 글감·스레드도 A 쪽에서 같은 상태가 서버에 올라간 뒤 B 에도 같아야 한다(양쪽 수렴)
    await ok(A, B);
    const byId = (l: { id: string }[]) => [...l].sort((x, y) => x.id.localeCompare(y.id));
    expect(byId(await B.adapter.listLocal())).toEqual(byId(await A.adapter.listLocal()));
    await expectQuiet(server, A, B);
  });

  it('(d2) 글감·스레드 삭제(removeLocal 이 아닌 저장소 삭제)도 전파된다', async () => {
    const server = makeServer();
    const key = generateSyncKey();
    const A = await makeDevice(server, key);
    const B = await makeDevice(server, key);
    const k = await populate(A);
    await ok(A, B);
    await A.dev.store.remove('snippets', 'sn1');
    await A.dev.store.remove('threads', 'th1', k.kA);
    await ok(A, B);
    expect(Object.keys(await snippetsOf(B)).sort()).toEqual(['sn2', 'sn3']);
    expect(await B.dev.store.parts('threads')).toEqual([]);
    await expectQuiet(server, A, B);
  });

  it('(f) 서버 D1 덤프에 글 본문·이름·글감·스레드 평문이 없다', async () => {
    const server = makeServer();
    const key = generateSyncKey();
    const A = await makeDevice(server, key);
    await populate(A);
    await ok(A);
    const dump = server.db.dump();
    expect(dump.length).toBeGreaterThan(500);
    for (const secret of ['글A', '글B', 'Note C', '폴더', '줄 끝', 'idb:1111', '스레드 메시지', '본문 sn1', 'x.test', key, key.replace(/-/g, '')]) {
      expect(dump.includes(secret), secret).toBe(false);
    }
  });

  it('(g) 틀린 키로 연결한 기기는 401 → paused unauthorized', async () => {
    const server = makeServer();
    const A = await makeDevice(server, generateSyncKey());
    await populate(A);
    await ok(A);
    const X = await makeDevice(server, generateSyncKey(), { invite: false });
    // 다른 키는 다른 공간이므로 초대 코드가 없으면 403 이다. 같은 공간에 다른 토큰을 보내려면 공간 id 만 같고 토큰이 다른 전송을 쓴다.
    await X.engine.syncNow();
    expect(X.engine.status.phase).toBe('paused');
    expect(X.engine.status.lastError?.kind).toBe('forbidden');

    const keys = await deriveKeys(generateSyncKey(), APP_ID);
    const meta = createIdbMetaStore(`works-sync-it-${seqN++}`);
    const dev = standaloneDevice();
    const wrong = createSyncEngine({
      config: { workerUrl: URL_BASE, syncKey: 'unused', inviteCode: INVITE },
      adapter: createSyncAdapter({ host: dev.host, dbName: dev.dbName }), meta, codec: createCodec(keys.encKey),
      transport: createTransport({ workerUrl: URL_BASE, appId: APP_ID, spaceId: A.keys.spaceId, authToken: keys.authToken }, server.fetch),
      autoSchedule: false,
    });
    await wrong.syncNow();
    expect(wrong.status.phase).toBe('paused');
    expect(wrong.status.lastError?.kind).toBe('unauthorized');
    expect(server.log.at(-1)!.status).toBe(401);
    expect(await dev.names()).toEqual([]);
  });

  it('(g2) 토큰은 맞지만 암호화 키가 다르면 crypto 오류(데이터는 손대지 않음)', async () => {
    const server = makeServer();
    const key = generateSyncKey();
    const A = await makeDevice(server, key);
    await populate(A);
    await ok(A);
    const other = await deriveKeys(generateSyncKey(), APP_ID);
    const dev = standaloneDevice();
    const e = createSyncEngine({
      config: { workerUrl: URL_BASE, syncKey: key },
      adapter: createSyncAdapter({ host: dev.host, dbName: dev.dbName }), meta: createIdbMetaStore(`works-sync-it-${seqN++}`),
      codec: createCodec(other.encKey),
      transport: createTransport({ workerUrl: URL_BASE, appId: APP_ID, spaceId: A.keys.spaceId, authToken: A.keys.authToken }, server.fetch),
      autoSchedule: false,
    });
    await e.syncNow();
    expect(e.status.lastError?.kind).toBe('crypto');
    expect(await dev.names()).toEqual([]);
  });

  it('(h) 초대 코드 없는 새 공간은 403 → paused forbidden, 틀린 코드도 같다', async () => {
    const server = makeServer();
    const key = generateSyncKey();
    const D = await makeDevice(server, key, { invite: false });
    await D.dev.putDoc('a.md', 'a', 1);
    await D.engine.syncNow();
    expect(D.engine.status.phase).toBe('paused');
    expect(D.engine.status.lastError?.kind).toBe('forbidden');
    expect(server.log.at(-1)!.status).toBe(403);
    expect(server.sqlite('SELECT * FROM spaces')).toEqual([]);

    // 초대 코드가 맞으면 공간이 생기고 첫 요청 이후에는 코드를 보내지 않는다
    const E = await makeDevice(server, key);
    await E.dev.putDoc('a.md', 'a', 1);
    await ok(E);
    await ok(E);
    expect(server.log.filter((x) => x.invite === INVITE)).toHaveLength(1);
    expect(server.sqlite('SELECT * FROM spaces')).toHaveLength(1);
  });

  describe('(i) purged_seq 보다 오래된 커서 → resync', () => {
    async function setup() {
      const server = makeServer();
      const key = generateSyncKey();
      const A = await makeDevice(server, key);
      const B = await makeDevice(server, key);
      await A.dev.putDoc('남는.md', 'keep', 100);
      await A.dev.putDoc('지워질.md', 'to delete', 100);
      await ok(A, B);
      // B 가 오프라인인 동안 A 가 글을 지우고, 30일 뒤 정리가 돌게 한다
      await A.dev.host.deleteDoc('지워질.md');
      await ok(A);
      server.clockOffset = 31 * DAY;
      server.random = 0;
      await A.dev.putDoc('남는.md', 'keep 2', 200);
      await ok(A);
      server.random = 1;
      server.clockOffset = 0;
      expect(server.sqlite("SELECT purged_seq FROM spaces")[0].purged_seq).toBeGreaterThan(0);
      expect(server.sqlite("SELECT * FROM items WHERE deleted = 1")).toEqual([]);
      return { server, A, B };
    }

    it('orphans 를 묻고, upload 면 서버에 새 항목으로 올라간다', async () => {
      const { server, A, B } = await setup();
      await B.engine.syncNow();
      expect(server.log.some((x) => x.res?.resyncRequired)).toBe(true);
      expect(B.engine.status.resync?.orphans).toEqual([{ id: docItemId('지워질.md'), kind: 'doc', label: '지워질.md' }]);
      expect(await B.dev.doc('남는.md')).toBe('keep 2');
      await B.engine.resolveResync('upload');
      expect(B.engine.status.resync).toBeUndefined();
      expect(B.engine.status.lastError).toBeUndefined();
      expect(server.sqlite(`SELECT rev, deleted FROM items WHERE item_id = '${docItemId('지워질.md')}'`)).toEqual([{ rev: 1, deleted: 0 }]);
      await ok(A);
      expect(await A.dev.doc('지워질.md')).toBe('to delete');
      await expectQuiet(server, A, B);
    });

    it('delete 면 B 에서 지워지고 서버는 그대로', async () => {
      const { server, A, B } = await setup();
      await B.engine.syncNow();
      expect(B.engine.status.resync?.orphans).toHaveLength(1);
      await B.engine.resolveResync('delete');
      expect(await B.dev.names()).toEqual(['남는.md']);
      expect(server.sqlite(`SELECT * FROM items WHERE item_id = '${docItemId('지워질.md')}'`)).toEqual([]);
      expect(B.engine.status.lastError).toBeUndefined();
      await ok(A);
      expect(await A.dev.names()).toEqual(['남는.md']);
      await expectQuiet(server, A, B);
    });
  });

  // ───────── 위험 겨냥 ─────────
  describe('(j) 계약 위험', () => {
    it('위험 2: 서버에 없는 항목을 baseRev>0 으로 올리면 conflicts(rev 0, deleted, 빈 blob) → 엔진이 baseRev 0 으로 다시 올린다', async () => {
      const server = makeServer();
      const key = generateSyncKey();
      const A = await makeDevice(server, key);
      await A.dev.putDoc('글.md', '첫', 100);
      await ok(A);
      // 서버에서 항목을 직접 지운다(purged_seq 는 건드리지 않음 → resync 없이 로컬이 '내가 올린 적 있는데 서버에 없다')
      server.db.sqlite.exec('DELETE FROM items');
      await A.dev.putDoc('글.md', '둘', 200);
      server.log.length = 0;
      await ok(A);
      const pushes = server.log.flatMap((x) => x.req.push);
      expect(pushes.map((p) => p.baseRev)).toEqual([1, 0]); // 먼저 baseRev 1 → conflict(rev 0) → baseRev 0 으로 재전송
      expect(server.log.some((x) => x.res?.conflicts.some((c) => c.rev === 0 && c.deleted && c.blob === ''))).toBe(true);
      expect(server.sqlite('SELECT rev, deleted FROM items')).toEqual([{ rev: 1, deleted: 0 }]);
      expect(await A.dev.doc('글.md')).toBe('둘'); // 로컬을 지우지 않는다
      await expectQuiet(server, A);
      // 다른 기기가 받아 본다
      const B = await makeDevice(server, key);
      await ok(B);
      expect(await B.dev.doc('글.md')).toBe('둘');
    });

    it('위험 2b: 같은 상황에서 글감·스레드도 로컬을 지우지 않고 다시 올린다', async () => {
      const server = makeServer();
      const key = generateSyncKey();
      const A = await makeDevice(server, key);
      const k = await A.dev.putDoc('글.md', '첫', 100);
      await A.dev.store.put('snippets', snip('sn1', { attachedDocs: [k] }));
      await A.dev.store.put('threads', thread('th1', k), k);
      await ok(A);
      server.db.sqlite.exec('DELETE FROM items');
      await A.dev.putDoc('글.md', '둘', 200);
      await A.dev.store.put('snippets', snip('sn1', { attachedDocs: [k], body: '수정', updatedAt: 300 }));
      await A.dev.store.put('threads', thread('th1', k, { resolved: true, updatedAt: 301 }), k);
      await ok(A);
      expect(server.sqlite('SELECT item_id, rev FROM items ORDER BY item_id').map((r) => r.rev)).toEqual([1, 1, 1]);
      expect((await snippetsOf(A)).sn1.body).toBe('수정');
      expect(await A.dev.store.list('threads', k)).toHaveLength(1);
      await expectQuiet(server, A);
    });

    it('위험 3: 400 bad_request 는 paused 가 아니라 error 이고, 다음 sync 가 정상 복구한다', async () => {
      const server = makeServer();
      const A = await makeDevice(server, generateSyncKey());
      await A.dev.putDoc('글.md', '본문', 100);
      server.mangleBody = '{깨진 json';
      await A.engine.syncNow();
      expect(server.log.at(-1)!.status).toBe(400);
      expect(A.engine.status.phase).toBe('error');
      expect(A.engine.status.lastError?.kind).toBe('unavailable');
      expect(A.engine.status.lastError?.retryAt).toBeUndefined();
      expect(await A.dev.names()).toEqual(['글.md']); // 로컬 무사
      await ok(A);
      expect(server.sqlite('SELECT rev FROM items')).toEqual([{ rev: 1 }]);
    });

    it('위험 4: push 응답의 changes(자기 에코)로 적용·재푸시·rev 변화가 생기지 않는다', async () => {
      const server = makeServer();
      const A = await makeDevice(server, generateSyncKey());
      await populate(A);
      await ok(A);
      const pushReq = server.log.find((x) => x.req.push.length > 0)!;
      expect(pushReq.res!.changes.length).toBeGreaterThan(0); // 서버는 에코를 싣는다
      expect(server.log.filter((x) => x.req.push.length > 0)).toHaveLength(1); // 재푸시 없음
      expect([...(await metaMap(A)).values()].every((m) => m.rev === 1)).toBe(true);
      expect(server.sqlite('SELECT DISTINCT rev FROM items')).toEqual([{ rev: 1 }]);
    });

    it('위험 5: 페이지 경계(항목 수·바이트)에서도 빠짐·중복 없이 모두 받고 커서가 공간 seq 에 도달한다', async () => {
      for (const vars of [{ PULL_MAX_ITEMS: '5' }, { PULL_MAX_BYTES: '600' }] as Record<string, string>[]) {
        const server = makeServer(vars);
        const key = generateSyncKey();
        const A = await makeDevice(server, key);
        const B = await makeDevice(server, key);
        const names: string[] = [];
        for (let i = 0; i < 17; i++) { names.push(`글${i}.md`); await A.dev.putDoc(`글${i}.md`, `내용 ${i}`.repeat(10), 100 + i); }
        await ok(A);
        server.log.length = 0;
        await ok(B);
        const pulls = server.log.filter((x) => x.req.push.length === 0);
        expect(pulls.length).toBeGreaterThan(3);
        const pages = pulls.filter((x) => x.res!.hasMore);
        expect(pages.length).toBeGreaterThan(2);
        expect(pulls.at(-1)!.res!.hasMore).toBe(false);
        const cursors = pulls.map((x) => x.res!.cursor);
        expect(cursors).toEqual([...cursors].sort((x, y) => x - y));
        const seq = server.sqlite('SELECT seq FROM spaces')[0].seq as number;
        expect(pulls.at(-1)!.res!.cursor).toBe(seq);
        const got = pulls.flatMap((x) => x.res!.changes.map((c) => c.id));
        expect(new Set(got).size).toBe(17);
        expect(got).toHaveLength(17); // 중복 없음
        expect((await B.dev.names()).sort()).toEqual([...names].sort());
        // 다음 sync 는 같은 커서에서 변경 없음
        const before = server.log.length;
        await ok(B);
        expect(server.log.slice(before).every((x) => x.res!.changes.length === 0 || x.res!.changes.every((c) => false))).toBe(true);
        await expectQuiet(server, A, B);
      }
    });

    it('위험 5b: 많은 항목을 한 번에 올려도(push 20건 분할) 서버·클라이언트가 같은 개수로 수렴', async () => {
      const server = makeServer();
      const key = generateSyncKey();
      const A = await makeDevice(server, key);
      const B = await makeDevice(server, key);
      for (let i = 0; i < 45; i++) await A.dev.store.put('snippets', snip(`m${i}`, { body: `메모 ${i}` }));
      await ok(A, B);
      expect(Object.keys(await snippetsOf(B))).toHaveLength(45);
      expect(server.sqlite('SELECT COUNT(*) AS n FROM items')[0].n).toBe(45);
      await expectQuiet(server, A, B);
    });
  });

  it('id 규칙: 서버가 받아들인 항목 id 가 어댑터 id 와 같다', async () => {
    const server = makeServer();
    const A = await makeDevice(server, generateSyncKey());
    const k = await populate(A);
    await ok(A);
    const ids = server.sqlite('SELECT item_id FROM items').map((r) => r.item_id).sort();
    expect(ids).toEqual([
      docItemId('폴더/글A.md'), docItemId('글B.md'), docItemId('Note C.md'),
      snippetItemId('sn1'), snippetItemId('sn2'), snippetItemId('sn3'), threadItemId('th1'),
    ].sort());
    expect(k.kA).toBeTruthy();
  });
});
