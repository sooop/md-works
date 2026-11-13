// 문서 휴지통(.works-trash)과 백업 보존 솎아내기 테스트
import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApi, backupsToDelete, backupTime, TRASH_KEEP_MS } from '../../server/api.js';

const servers: http.Server[] = [];
const dirs: string[] = [];
const DAY = 24 * 3600_000;

function serve(root: string, now?: () => number) {
  const api = createApi(root, now ? { now } : {});
  const server = http.createServer((req, res) => { void api(req, res); });
  return new Promise<string>((r) => server.listen(0, '127.0.0.1', () => {
    servers.push(server);
    r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  }));
}
async function boot(now?: () => number) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'works-trash-'));
  dirs.push(root);
  return { root, base: await serve(root, now) };
}
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

const json = { 'Content-Type': 'application/json' };
const enc = encodeURIComponent;
type Json = Record<string, any>;
async function call(base: string, method: string, url: string, body?: unknown) {
  const r = await fetch(base + url, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data: Json = {};
  try { data = JSON.parse(text); } catch { /* JSON 아님 */ }
  return { status: r.status, data };
}
const del = (base: string, p: string) => call(base, 'DELETE', `/api/file?path=${enc(p)}`);
const listTrash = async (base: string) => (await call(base, 'GET', '/api/trash')).data.items as Json[];
const restore = (base: string, id: string) => call(base, 'POST', '/api/trash/restore', { id });
const write = async (root: string, rel: string, data: string | Buffer = '내용') => {
  const f = path.join(root, ...rel.split('/'));
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, data);
};
const read = (root: string, rel: string) => fs.readFile(path.join(root, ...rel.split('/')), 'utf8');
const has = (root: string, rel: string) => fs.access(path.join(root, ...rel.split('/'))).then(() => true, () => false);
const treeNames = (nodes: Json[]): string[] => nodes.flatMap((n) => [n.path, ...(n.children ? treeNames(n.children) : [])]);

// 글 하나에 딸린 것을 전부 만든다: 본문·assets·이전 방식 코멘트·이력·스레드
async function seedDoc(base: string, root: string, rel: string) {
  const stem = path.posix.basename(rel, '.md');
  const dir = path.posix.dirname(rel);
  const pre = dir === '.' ? '' : dir + '/';
  await write(root, rel, `# ${stem}\n\n![](assets/${enc(stem)}/p.png)\n`);
  await write(root, `${pre}assets/${stem}/p.png`, Buffer.from([1, 2, 3, 4]));
  expect((await call(base, 'PUT', `/api/comments?path=${enc(rel)}`, { comments: [{ id: 'c1', quote: '인용', text: '코멘트' }] })).status).toBe(200);
  expect((await call(base, 'PUT', '/api/works', { coll: 'versions', part: rel, recs: [{ id: 'v1', updatedAt: 1, content: '옛 버전' }] })).status).toBe(200);
  expect((await call(base, 'PUT', '/api/works', { coll: 'threads', part: rel, recs: [{ id: 't1', updatedAt: 1, docKey: rel }] })).status).toBe(200);
}
async function expectSidecars(base: string, root: string, rel: string) {
  const c = await call(base, 'GET', `/api/comments?path=${enc(rel)}`);
  expect(c.data.comments.map((x: Json) => x.id)).toEqual(['c1']);
  const v = await call(base, 'GET', `/api/works?coll=versions&part=${enc(rel)}`);
  expect(v.data.records.map((x: Json) => x.id)).toEqual(['v1']);
  const t = await call(base, 'GET', `/api/works?coll=threads&part=${enc(rel)}`);
  expect(t.data.records.map((x: Json) => [x.id, x.docKey])).toEqual([['t1', rel]]);
}

describe('휴지통: 글 삭제 → 목록 → 복구 왕복', () => {
  it('본문·assets·코멘트·이력·스레드가 모두 돌아온다', async () => {
    const { base, root } = await boot();
    await seedDoc(base, root, 'a/x.md');
    const before = await read(root, 'a/x.md');
    const r = await del(base, 'a/x.md');
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
    expect(r.data.trashId).toMatch(/^\d{8}-\d{6}-[0-9a-f]{6}$/);

    // 삭제 후: 원래 자리·assets·사이드카가 모두 사라진다
    expect((await call(base, 'GET', `/api/file?path=${enc('a/x.md')}`)).status).toBe(404);
    expect(await has(root, 'a/assets/x')).toBe(false);
    expect((await call(base, 'GET', `/api/comments?path=${enc('a/x.md')}`)).data.comments).toEqual([]);
    expect((await call(base, 'GET', `/api/works?coll=versions&part=${enc('a/x.md')}`)).data.records).toEqual([]);
    expect((await call(base, 'GET', '/api/works/parts?coll=threads')).data.parts).toEqual([]);

    const items = await listTrash(base);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: r.data.trashId, path: 'a/x.md', name: 'x.md', type: 'file', docs: 1 });
    expect(typeof items[0].deletedAt).toBe('number');

    const back = await restore(base, r.data.trashId);
    expect(back.status).toBe(200);
    expect(back.data).toEqual({ ok: true, path: 'a/x.md', type: 'file' });
    expect(await read(root, 'a/x.md')).toBe(before);
    expect([...(await fs.readFile(path.join(root, 'a/assets/x/p.png')))]).toEqual([1, 2, 3, 4]);
    await expectSidecars(base, root, 'a/x.md');
    expect(await listTrash(base)).toEqual([]);
    expect(await has(root, '.works-trash/' + r.data.trashId)).toBe(false);
  });

  it('최근 삭제가 목록 앞에 온다', async () => {
    let t = Date.UTC(2026, 0, 1);
    const { base, root } = await boot(() => (t += 1000));
    await write(root, 'one.md'); await write(root, 'two.md');
    const a = (await del(base, 'one.md')).data.trashId;
    const b = (await del(base, 'two.md')).data.trashId;
    expect((await listTrash(base)).map((i) => i.id)).toEqual([b, a]);
  });

  it('.md 가 아닌 파일 삭제와 루트·없는 경로·숨김 항목은 거부한다', async () => {
    const { base, root } = await boot();
    await write(root, 'a.txt');
    expect((await del(base, 'a.txt')).status).toBe(400);
    expect((await del(base, '')).status).toBe(400); // 루트 자체
    expect((await del(base, 'nope.md')).status).toBe(404);
    await write(root, '.works/x/y.json', '{}');
    expect((await del(base, '.works')).status).toBe(400);
    expect(await has(root, 'a.txt')).toBe(true);
  });
});

describe('휴지통: 폴더 삭제 → 복구', () => {
  it('트리에 안 보이는 파일(PDF·이미지·.git)까지 보존되고 안의 글 사이드카도 돌아온다', async () => {
    const { base, root } = await boot();
    await seedDoc(base, root, 'proj/sub/n.md');
    await write(root, 'proj/top.md', '최상위');
    await write(root, 'proj/spec.pdf', Buffer.from('%PDF-1.4 binary'));
    await write(root, 'proj/img/logo.png', Buffer.from([9, 9]));
    await write(root, 'proj/.git/HEAD', 'ref: refs/heads/main');
    await write(root, 'keep.md', '남는 글');

    const r = await del(base, 'proj');
    expect(r.status).toBe(200);
    expect(await has(root, 'proj')).toBe(false);
    expect(await has(root, 'keep.md')).toBe(true);
    const items = await listTrash(base);
    expect(items[0]).toMatchObject({ path: 'proj', name: 'proj', type: 'dir', docs: 2 });
    expect((await call(base, 'GET', '/api/works/parts?coll=versions')).data.parts).toEqual([]);

    const back = await restore(base, r.data.trashId);
    expect(back.data).toEqual({ ok: true, path: 'proj', type: 'dir' });
    expect(await read(root, 'proj/spec.pdf')).toBe('%PDF-1.4 binary');
    expect(await has(root, 'proj/img/logo.png')).toBe(true);
    expect(await read(root, 'proj/.git/HEAD')).toBe('ref: refs/heads/main');
    expect(await read(root, 'proj/top.md')).toBe('최상위');
    expect(await has(root, 'proj/sub/assets/n/p.png')).toBe(true);
    await expectSidecars(base, root, 'proj/sub/n.md');
  });

  it('사라진 상위 폴더는 다시 만들어 복구한다', async () => {
    const { base, root } = await boot();
    await seedDoc(base, root, 'p/q/doc.md');
    const id = (await del(base, 'p/q/doc.md')).data.trashId;
    await fs.rm(path.join(root, 'p'), { recursive: true, force: true });
    const back = await restore(base, id);
    expect(back.data.path).toBe('p/q/doc.md');
    expect(await has(root, 'p/q/doc.md')).toBe(true);
    await expectSidecars(base, root, 'p/q/doc.md');
  });
});

describe('휴지통: 이름 충돌 복구', () => {
  it('글: 같은 이름이 있으면 이름 (2).md 로 복구하고 assets·링크·사이드카 키를 새 이름에 맞춘다', async () => {
    const { base, root } = await boot();
    await seedDoc(base, root, 'a/x.md');
    const id = (await del(base, 'a/x.md')).data.trashId;
    await write(root, 'a/x.md', '새로 만든 글');
    const back = await restore(base, id);
    expect(back.data).toEqual({ ok: true, path: 'a/x (2).md', type: 'file' });
    expect(await read(root, 'a/x.md')).toBe('새로 만든 글'); // 기존 글은 그대로
    expect(await read(root, 'a/x (2).md')).toContain(`assets/${enc('x (2)')}/p.png`);
    expect(await has(root, 'a/assets/x (2)/p.png')).toBe(true);
    expect(await has(root, 'a/assets/x')).toBe(false);
    await expectSidecars(base, root, 'a/x (2).md'); // 스레드 docKey 포함
    // 이미 (2) 인 이름이 또 충돌하면 (2) (2)
    const id2 = (await del(base, 'a/x (2).md')).data.trashId;
    await write(root, 'a/x (2).md', '또');
    expect((await restore(base, id2)).data.path).toBe('a/x (2) (2).md');
  });

  it('폴더: 폴더 (2) 로 복구한다', async () => {
    const { base, root } = await boot();
    await seedDoc(base, root, '폴더/n.md');
    const id = (await del(base, '폴더')).data.trashId;
    await write(root, '폴더/다른.md', '새 폴더');
    const back = await restore(base, id);
    expect(back.data).toEqual({ ok: true, path: '폴더 (2)', type: 'dir' });
    expect(await has(root, '폴더/다른.md')).toBe(true);
    expect(await has(root, '폴더 (2)/n.md')).toBe(true);
    await expectSidecars(base, root, '폴더 (2)/n.md');
  });

  it('없는 id 는 404, 형식이 틀린 id 는 400', async () => {
    const { base } = await boot();
    expect((await restore(base, '20260101-000000-abcdef')).status).toBe(404);
    expect((await restore(base, 'abc')).status).toBe(400);
    expect((await call(base, 'POST', '/api/trash/restore', {})).status).toBe(400);
  });
});

describe('휴지통: 완전 삭제·비우기', () => {
  it('DELETE /api/trash?id= 는 그 항목만, id 없이는 전부 지운다', async () => {
    let t = Date.UTC(2026, 0, 1);
    const { base, root } = await boot(() => (t += 1000));
    for (const n of ['a', 'b', 'c']) await write(root, `${n}.md`);
    const ids = [];
    for (const n of ['a', 'b', 'c']) ids.push((await del(base, `${n}.md`)).data.trashId);
    expect((await call(base, 'DELETE', `/api/trash?id=${ids[0]}`)).data).toEqual({ ok: true, removed: 1 });
    expect(await has(root, `.works-trash/${ids[0]}`)).toBe(false);
    expect((await call(base, 'DELETE', `/api/trash?id=${ids[0]}`)).status).toBe(404);
    expect((await restore(base, ids[0])).status).toBe(404);
    expect(await listTrash(base)).toHaveLength(2);
    expect((await call(base, 'DELETE', '/api/trash')).data).toEqual({ ok: true, removed: 2 });
    expect(await listTrash(base)).toEqual([]);
    expect((await call(base, 'DELETE', '/api/trash')).data).toEqual({ ok: true, removed: 0 });
  });
});

describe('휴지통: 30일 자동 비움', () => {
  it('GET /api/trash 때 30일이 지난 항목을 지운다(시각 주입)', async () => {
    let t = Date.UTC(2026, 0, 1);
    const { base, root } = await boot(() => t);
    await write(root, 'old.md'); await write(root, 'new.md');
    const oldId = (await del(base, 'old.md')).data.trashId;
    t += 10 * DAY;
    const newId = (await del(base, 'new.md')).data.trashId;
    t += TRASH_KEEP_MS - 10 * DAY; // old 는 정확히 30일 — 아직 안 지난 것
    expect((await listTrash(base)).map((i) => i.id).sort()).toEqual([newId, oldId].sort());
    t += 1;
    expect((await listTrash(base)).map((i) => i.id)).toEqual([newId]);
    expect(await has(root, `.works-trash/${oldId}`)).toBe(false);
  });

  it('서버 시작 때도 지운다', async () => {
    let t = Date.UTC(2026, 0, 1);
    const { base, root } = await boot(() => t);
    await write(root, 'old.md');
    const id = (await del(base, 'old.md')).data.trashId;
    expect(await has(root, `.works-trash/${id}`)).toBe(true);
    await serve(root, () => t + TRASH_KEEP_MS + DAY); // 같은 루트로 새 서버
    for (let i = 0; i < 50 && (await has(root, `.works-trash/${id}`)); i++) await new Promise((r) => setTimeout(r, 50));
    expect(await has(root, `.works-trash/${id}`)).toBe(false);
    expect(base).toBeTruthy();
  });
});

describe('휴지통: id·경로 검증과 접근 차단', () => {
  it('id 에 경로 탈출·구분자가 있으면 거부한다', async () => {
    const { base, root } = await boot();
    await write(root, 'victim.md', '살아야 함');
    const bad = ['..', '../x', '..%2f..%2fvictim.md', '20260101-000000-abcdef/..', '20260101-000000-abcdef%5c..', '.', ''];
    for (const id of bad) {
      expect((await call(base, 'DELETE', `/api/trash?id=${id}`)).status).toBe(400);
      expect((await call(base, 'POST', '/api/trash/restore', { id: decodeURIComponent(id) })).status).toBe(400);
    }
    expect((await call(base, 'POST', '/api/trash/restore', { id: ['x'] })).status).toBe(400);
    expect(await read(root, 'victim.md')).toBe('살아야 함');
  });

  it('휴지통 안은 /api/file·/api/raw·/api/create·/api/rename·/api/upload 등으로 닿지 않는다', async () => {
    const { base, root } = await boot();
    await seedDoc(base, root, 'a/x.md');
    const id = (await del(base, 'a/x.md')).data.trashId;
    const inner = `.works-trash/${id}/item/x.md`;
    expect((await call(base, 'GET', `/api/file?path=${enc(inner)}`)).status).toBe(403);
    expect((await call(base, 'PUT', `/api/file?path=${enc(inner)}`, { content: 'x' })).status).toBe(403);
    expect((await call(base, 'GET', `/api/raw?path=${enc(`.works-trash/${id}/assets/p.png`)}`)).status).toBe(403);
    expect((await call(base, 'DELETE', `/api/file?path=${enc('.works-trash/' + id)}`)).status).toBe(403);
    expect((await call(base, 'DELETE', `/api/file?path=${enc('.WORKS-TRASH')}`)).status).toBe(403);
    expect((await call(base, 'POST', '/api/create', { path: '.works-trash/new.md' })).status).toBe(403);
    expect((await call(base, 'POST', '/api/rename', { from: inner, to: 'stolen.md' })).status).toBe(403);
    expect((await call(base, 'POST', '/api/rename', { from: 'a/..', to: '.works-trash/zz' })).status).toBeGreaterThanOrEqual(400);
    expect((await call(base, 'GET', `/api/comments?path=${enc(inner)}`)).status).toBe(403);
    expect(await has(root, 'stolen.md')).toBe(false);
    expect(await has(root, inner)).toBe(true);
  });

  it('변조된 meta.json 의 경로(루트 밖)는 복구 때 거부한다', async () => {
    const { base, root } = await boot();
    await write(root, 'a.md');
    const id = (await del(base, 'a.md')).data.trashId;
    const mf = path.join(root, '.works-trash', id, 'meta.json');
    const meta = JSON.parse(await fs.readFile(mf, 'utf8'));
    await fs.writeFile(mf, JSON.stringify({ ...meta, path: '../evil.md' }));
    const r = await restore(base, id);
    expect(r.status).toBe(403);
    expect(await has(path.dirname(root), 'evil.md')).toBe(false);
  });
});

describe('휴지통은 트리·검색·번들 색인에 나오지 않는다', () => {
  it('삭제한 글의 본문·assets 가 목록에서 사라지고 휴지통 폴더는 보이지 않는다', async () => {
    const { base, root } = await boot();
    await write(root, 'live.md', '고유단어ZZ 살아있는 글');
    await write(root, 'gone.md', '고유단어ZZ 지워질 글');
    await write(root, 'assets/gone/p.png', Buffer.from([1]));
    await del(base, 'gone.md');
    const tree = await call(base, 'GET', '/api/tree');
    expect(treeNames(tree.data.children)).toEqual(['live.md']);
    const s = await call(base, 'GET', `/api/search?q=${enc('고유단어ZZ')}`);
    expect(JSON.stringify(s.data)).toContain('live.md');
    expect(JSON.stringify(s.data)).not.toContain('gone.md');
    expect(JSON.stringify(s.data)).not.toContain('works-trash');
    const idx = await call(base, 'GET', '/api/bundle/index');
    expect(idx.data.docs.map((d: Json) => d.path)).toEqual(['live.md']);
    expect(idx.data.assets).toEqual([]);
  });
});

describe('백업 솎아내기 규칙 (backupsToDelete)', () => {
  const NOW = new Date(2026, 5, 20, 12, 0, 0).getTime();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const nm = (t: number, n = 0) => {
    const d = new Date(t);
    return `md-works-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}${n ? `-${n}` : ''}.mwb`;
  };
  const items = (ts: number[]) => ts.map((t) => ({ name: nm(t), time: backupTime(nm(t)) }));
  const kept = (ts: number[]) => { const del = new Set(backupsToDelete(items(ts), NOW)); return ts.filter((t) => !del.has(nm(t))); };

  it('백업 이름의 시각을 읽는다', () => {
    expect(backupTime('md-works-20260620-120000.mwb')).toBe(NOW);
    expect(backupTime('md-works-20260620-120000-3.zip')).toBe(NOW);
    expect(backupTime('이상한이름', 77)).toBe(77);
  });

  it('최근 10개는 나이와 무관하게 전부 유지한다(15분 간격 → 2.5시간)', () => {
    const ts = Array.from({ length: 10 }, (_, i) => NOW - i * 15 * 60_000);
    expect(kept(ts)).toEqual(ts);
    expect(backupsToDelete(items(ts), NOW)).toEqual([]);
  });

  it('10개를 넘으면 48시간 안은 시간당 최신 1개만 남긴다', () => {
    // 15분 간격 24개(6시간): 최근 10개 + 그 밖은 시간당 1개
    const ts = Array.from({ length: 24 }, (_, i) => NOW - i * 15 * 60_000);
    const k = kept(ts);
    expect(k.slice(0, 10)).toEqual(ts.slice(0, 10));
    const rest = k.slice(10);
    const hours = rest.map((t) => Math.floor(t / 3600_000));
    expect(new Set(hours).size).toBe(hours.length);
    // 각 시간 묶음의 최신 것이 남는다
    for (const t of rest) {
      const newest = Math.max(...ts.slice(10).filter((x) => Math.floor(x / 3600_000) === Math.floor(t / 3600_000)));
      expect(t).toBe(newest);
    }
  });

  it('48시간~30일은 하루당 최신 1개, 30일 넘으면 지운다', () => {
    const recent = Array.from({ length: 10 }, (_, i) => NOW - i * 60_000);
    const D = (days: number, hour: number) => new Date(2026, 5, 20 - days, hour, 0, 0).getTime();
    const old = [D(5, 20), D(5, 9), D(5, 1), D(10, 23), D(10, 2), D(29, 12), D(40, 12), D(90, 12)];
    const k = kept([...recent, ...old]);
    expect(k.slice(10)).toEqual([D(5, 20), D(10, 23), D(29, 12)]);
  });

  it('같은 초 충돌 번호(-2)가 붙은 이름도 처리하고, 입력 순서에 영향받지 않는다', () => {
    const base = Array.from({ length: 10 }, (_, i) => NOW - i * 1000);
    const a = { name: nm(NOW - DAY * 5, 0), time: NOW - DAY * 5 };
    const b = { name: nm(NOW - DAY * 5, 2), time: NOW - DAY * 5 };
    const all = [...base.map((t) => ({ name: nm(t), time: t })), a, b];
    expect(backupsToDelete(all, NOW)).toEqual([a.name]); // 번호가 큰 쪽이 더 새것
    expect(backupsToDelete([...all].reverse(), NOW)).toEqual([a.name]);
  });

  it('POST /api/backup 은 솎아 낸 목록을 남기고 GET /api/backups 형태는 같다', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'works-bk-'));
    dirs.push(root);
    const dir = path.join(root, '.works-backup');
    await fs.mkdir(dir);
    // 5일 전 하루 안의 백업 3개와 60일 전 1개, 최근 것 10개
    const day5 = [20, 9, 1].map((h) => new Date(2026, 5, 15, h, 0, 0).getTime());
    const stale = [new Date(2026, 3, 1, 12, 0, 0).getTime()];
    const fresh = Array.from({ length: 9 }, (_, i) => NOW - (i + 1) * 60_000);
    for (const t of [...day5, ...stale, ...fresh]) await fs.writeFile(path.join(dir, nm(t)), 'PK');
    const base = await serve(root, () => NOW);
    const r = await fetch(`${base}/api/backup`, { method: 'POST', body: Buffer.from('PK\x03\x04zip') });
    expect(r.status).toBe(200);
    const res = await r.json();
    const list = (await call(base, 'GET', '/api/backups')).data.backups as Json[];
    expect(Object.keys(list[0]).sort()).toEqual(['mtime', 'name', 'size']);
    expect(list.length).toBe(res.kept);
    const names = list.map((b) => b.name);
    expect(names).toContain(res.name);
    expect(names).toContain(nm(day5[0]));
    expect(names).not.toContain(nm(day5[1]));
    expect(names).not.toContain(nm(day5[2]));
    expect(names).not.toContain(nm(stale[0]));
    expect(names.length).toBe(11); // 새 것 + 최근 9 = 10, 하루 대표 1
  });
});
