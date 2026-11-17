import { readLimits, type Limits } from './limits.ts';

// ───────── D1 호환 최소 인터페이스(테스트에서는 node:sqlite shim 이 구현) ─────────
export interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Db {
  prepare(sql: string): Stmt;
  batch(stmts: Stmt[]): Promise<unknown[]>;
}
export interface Env {
  DB: unknown;
  INVITE_CODE?: string;
  ALLOWED_APPS?: string;
  [k: string]: unknown;
}
export interface Deps {
  now: () => number;
  /** [0,1) 난수. 정리(purge) 확률 판정에 쓴다 */
  random: () => number;
}

const APP_ID_RE = /^[a-z0-9-]{1,32}$/;
const SPACE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ITEM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PURGE_PROBABILITY = 0.05;
const DAY_MS = 86_400_000;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'X-App-Id, X-Space-Id, Authorization, X-Invite-Code, Content-Type',
  'Access-Control-Max-Age': '7200',
};

class HttpError extends Error {
  constructor(public status: number, public code: string, public extra?: Record<string, string>) {
    super(code);
  }
}

function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  let out = '';
  for (const b of new Uint8Array(d)) out += b.toString(16).padStart(2, '0');
  return out;
}

/** 같은 길이의 문자열(해시 hex)을 상수 시간으로 비교 */
function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface SpaceRow {
  space_id: string;
  app_id: string;
  token_hash: string;
  seq: number;
  item_count: number;
  bytes_used: number;
  day: string;
  day_writes: number;
  purged_seq: number;
}
interface ExistingRow { item_id: string; rev: number; deleted: number; size: number }
interface RemoteItem { id: string; rev: number; deleted: boolean; blob: string }
interface PushItem { id: string; baseRev: number; deleted: boolean; blob: string }

export async function handleRequest(request: Request, env: Env, deps?: Partial<Deps>): Promise<Response> {
  const d: Deps = { now: deps?.now ?? Date.now, random: deps?.random ?? Math.random };
  const url = new URL(request.url);
  try {
    if (url.pathname === '/v1/health') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed');
      return json(200, { ok: true });
    }
    if (url.pathname !== '/v1/sync') throw new HttpError(404, 'not_found');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
    return await handleSync(request, env, d);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.code }, e.extra);
    // D1 등 내부 예외. 내용(토큰·키가 섞일 수 있음)은 기록하지 않는다
    return json(503, { error: 'unavailable' }, { 'Retry-After': '10' });
  }
}

async function handleSync(request: Request, env: Env, d: Deps): Promise<Response> {
  const L: Limits = readLimits(env);
  const db = env.DB as Db;

  // 1. 인증 -------------------------------------------------------------
  const appId = request.headers.get('X-App-Id') ?? '';
  const spaceId = request.headers.get('X-Space-Id') ?? '';
  const auth = request.headers.get('Authorization') ?? '';
  const m = /^Bearer (.+)$/.exec(auth);
  if (!APP_ID_RE.test(appId) || !SPACE_ID_RE.test(spaceId) || !m) throw new HttpError(401, 'unauthorized');

  const declared = request.headers.get('Content-Length');
  if (declared !== null && Number(declared) > L.MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large');

  const tokenHash = await sha256Hex(m[1]);
  const now = d.now();
  let space = await db.prepare('SELECT * FROM spaces WHERE space_id = ?').bind(spaceId).first<SpaceRow>();

  if (!space) {
    const invite = request.headers.get('X-Invite-Code') ?? '';
    const allowed = (env.ALLOWED_APPS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const secret = env.INVITE_CODE ?? '';
    const inviteOk = secret !== '' && invite !== '' && ctEqual(await sha256Hex(invite), await sha256Hex(secret));
    if (!inviteOk || !allowed.includes(appId)) throw new HttpError(403, 'forbidden');
    // 공간 수 상한은 INSERT 안에서 원자적으로 판정한다
    await db
      .prepare(
        `INSERT OR IGNORE INTO spaces (space_id, app_id, token_hash, seq, item_count, bytes_used, day, day_writes, created_at, purged_seq)
         SELECT ?, ?, ?, 0, 0, 0, '', 0, ?, 0 WHERE (SELECT COUNT(*) FROM spaces) < ?`,
      )
      .bind(spaceId, appId, tokenHash, now, L.MAX_SPACES)
      .run();
    space = await db.prepare('SELECT * FROM spaces WHERE space_id = ?').bind(spaceId).first<SpaceRow>();
    if (!space) throw new HttpError(403, 'forbidden');
  }
  if (space.app_id !== appId || !ctEqual(space.token_hash, tokenHash)) throw new HttpError(401, 'unauthorized');

  // 본문 읽기(실제 길이도 확인)
  const buf = await request.arrayBuffer();
  if (buf.byteLength > L.MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large');
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new HttpError(400, 'bad_request');
  }
  const req = body as { cursor?: unknown; push?: unknown };
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'bad_request');
  const cursorIn = req.cursor === undefined ? 0 : req.cursor;
  if (typeof cursorIn !== 'number' || !Number.isInteger(cursorIn) || cursorIn < 0) throw new HttpError(400, 'bad_request');
  const pushRaw = req.push === undefined ? [] : req.push;
  if (!Array.isArray(pushRaw)) throw new HttpError(400, 'bad_request');
  if (pushRaw.length > L.MAX_PUSH_ITEMS) throw new HttpError(413, 'body_too_large');

  const resyncRequired = cursorIn > 0 && cursorIn < space.purged_seq;
  let cursor = resyncRequired ? 0 : cursorIn;

  // push 형식 검사 + 같은 id 중복은 첫 것만
  const pushes: PushItem[] = [];
  if (!resyncRequired) {
    const seen = new Set<string>();
    for (const raw of pushRaw as Record<string, unknown>[]) {
      if (
        typeof raw !== 'object' || raw === null ||
        typeof raw.id !== 'string' || !ITEM_ID_RE.test(raw.id) ||
        typeof raw.baseRev !== 'number' || !Number.isInteger(raw.baseRev) || raw.baseRev < 0 ||
        typeof raw.deleted !== 'boolean' || typeof raw.blob !== 'string'
      ) throw new HttpError(400, 'bad_request');
      if (seen.has(raw.id)) continue;
      seen.add(raw.id);
      pushes.push({ id: raw.id, baseRev: raw.baseRev, deleted: raw.deleted, blob: raw.blob });
    }
  }

  // 2. 한도(항목 크기) ---------------------------------------------------
  for (const p of pushes) if (p.blob.length > L.MAX_ITEM_BYTES) throw new HttpError(422, 'item_too_large');

  // 3. 쓰기 --------------------------------------------------------------
  const today = new Date(now).toISOString().slice(0, 10);
  const dayWritesNow = space.day === today ? space.day_writes : 0;
  const accepted: { id: string; rev: number }[] = [];
  const conflicts: RemoteItem[] = [];
  let seq = space.seq;
  let itemCount = space.item_count;
  let bytesUsed = space.bytes_used;
  let dailyWrites = dayWritesNow;

  if (pushes.length > 0) {
    const ph = pushes.map(() => '?').join(',');
    const rows = (
      await db
        .prepare(`SELECT item_id, rev, deleted, size FROM items WHERE space_id = ? AND item_id IN (${ph})`)
        .bind(spaceId, ...pushes.map((p) => p.id))
        .all<ExistingRow>()
    ).results;
    const existing = new Map(rows.map((r) => [r.item_id, r]));

    const toWrite: { p: PushItem; rev: number }[] = [];
    const conflictIds: string[] = [];
    let countDelta = 0;
    let bytesDelta = 0;
    for (const p of pushes) {
      const ex = existing.get(p.id);
      if (!ex) {
        if (p.baseRev !== 0) {
          // 서버에 없는 항목에 baseRev>0: 사본이 없으므로 rev 0 의 삭제 사본으로 알린다
          conflicts.push({ id: p.id, rev: 0, deleted: true, blob: '' });
          continue;
        }
        toWrite.push({ p, rev: 1 });
        if (!p.deleted) countDelta += 1;
        bytesDelta += p.deleted ? 0 : p.blob.length;
      } else if (p.baseRev === ex.rev) {
        toWrite.push({ p, rev: ex.rev + 1 });
        countDelta += (p.deleted ? 0 : 1) - (ex.deleted ? 0 : 1);
        bytesDelta += (p.deleted ? 0 : p.blob.length) - ex.size;
      } else {
        conflictIds.push(p.id);
      }
    }
    if (conflictIds.length > 0) {
      const cph = conflictIds.map(() => '?').join(',');
      const crow = (
        await db
          .prepare(`SELECT item_id, rev, deleted, blob FROM items WHERE space_id = ? AND item_id IN (${cph})`)
          .bind(spaceId, ...conflictIds)
          .all<{ item_id: string; rev: number; deleted: number; blob: string }>()
      ).results;
      const byId = new Map(crow.map((r) => [r.item_id, r]));
      for (const id of conflictIds) {
        const r = byId.get(id);
        if (r) conflicts.push({ id, rev: r.rev, deleted: r.deleted === 1, blob: r.blob });
      }
    }

    const n = toWrite.length;
    if (n > 0) {
      if (countDelta > 0 && itemCount + countDelta > L.MAX_ITEMS_PER_SPACE) throw new HttpError(422, 'item_limit');
      if (bytesDelta > 0 && bytesUsed + bytesDelta > L.MAX_SPACE_BYTES) throw new HttpError(422, 'space_full');
      if (dayWritesNow + n > L.MAX_DAILY_WRITES) throw new HttpError(429, 'daily_write_limit');

      const stmts: Stmt[] = [];
      // 첫 문장: seq 를 쓰기 건수만큼 올리고 카운터를 상대값으로 갱신
      stmts.push(
        db
          .prepare(
            `UPDATE spaces SET seq = seq + ?, item_count = item_count + ?, bytes_used = bytes_used + ?,
               day_writes = CASE WHEN day = ? THEN day_writes + ? ELSE ? END, day = ?
             WHERE space_id = ?`,
          )
          .bind(n, countDelta, bytesDelta, today, n, n, today, spaceId),
      );
      // 이어지는 항목 문장: 방금 올린 spaces.seq 를 서브쿼리로 읽어 seq 를 배정(i 번째 = seq - (n-1-i))
      toWrite.forEach(({ p, rev }, i) => {
        const blob = p.deleted ? '' : p.blob;
        stmts.push(
          db
            .prepare(
              `INSERT INTO items (space_id, item_id, rev, seq, deleted, size, blob, updated_at)
               VALUES (?, ?, ?, (SELECT seq FROM spaces WHERE space_id = ?) - ?, ?, ?, ?, ?)
               ON CONFLICT (space_id, item_id) DO UPDATE SET
                 rev = excluded.rev, seq = excluded.seq, deleted = excluded.deleted,
                 size = excluded.size, blob = excluded.blob, updated_at = excluded.updated_at
               WHERE items.rev = ?`,
            )
            .bind(spaceId, p.id, rev, spaceId, n - 1 - i, p.deleted ? 1 : 0, blob.length, blob, now, p.baseRev),
        );
        accepted.push({ id: p.id, rev });
      });
      // 정리: 쓰기 요청의 약 5%
      if (d.random() < PURGE_PROBABILITY) {
        const cutoff = now - L.TOMBSTONE_DAYS * DAY_MS;
        stmts.push(
          db
            .prepare(
              `UPDATE spaces SET purged_seq = MAX(purged_seq,
                 COALESCE((SELECT MAX(seq) FROM items WHERE space_id = ? AND deleted = 1 AND updated_at < ?), 0))
               WHERE space_id = ?`,
            )
            .bind(spaceId, cutoff, spaceId),
          db
            .prepare('DELETE FROM items WHERE space_id = ? AND deleted = 1 AND updated_at < ?')
            .bind(spaceId, cutoff),
        );
      }
      await db.batch(stmts);
      seq += n;
      itemCount += countDelta;
      bytesUsed += bytesDelta;
      dailyWrites += n;
    }
  }

  // 4. 읽기 --------------------------------------------------------------
  const changes: RemoteItem[] = [];
  let hasMore = false;
  let outCursor = seq;
  if (cursor < seq) {
    const metas = (
      await db
        .prepare('SELECT seq, size FROM items WHERE space_id = ? AND seq > ? ORDER BY seq LIMIT ?')
        .bind(spaceId, cursor, L.PULL_MAX_ITEMS + 1)
        .all<{ seq: number; size: number }>()
    ).results;
    let take = 0;
    let bytes = 0;
    for (const r of metas) {
      if (take >= L.PULL_MAX_ITEMS) break;
      if (take > 0 && bytes + r.size > L.PULL_MAX_BYTES) break;
      bytes += r.size;
      take++;
    }
    if (take > 0) {
      const lastSeq = metas[take - 1].seq;
      const rows = (
        await db
          .prepare(
            'SELECT item_id, rev, seq, deleted, blob FROM items WHERE space_id = ? AND seq > ? AND seq <= ? ORDER BY seq',
          )
          .bind(spaceId, cursor, lastSeq)
          .all<{ item_id: string; rev: number; seq: number; deleted: number; blob: string }>()
      ).results;
      for (const r of rows) changes.push({ id: r.item_id, rev: r.rev, deleted: r.deleted === 1, blob: r.blob });
      hasMore = metas.length > take;
      outCursor = hasMore ? lastSeq : seq;
    }
  }
  cursor = outCursor;

  const res: Record<string, unknown> = {
    cursor,
    hasMore,
    accepted,
    conflicts,
    changes,
    usage: { items: itemCount, bytes: bytesUsed, dailyWrites },
  };
  if (resyncRequired) res.resyncRequired = true;
  return json(200, res);
}
