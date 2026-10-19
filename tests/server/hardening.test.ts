// 서버 잔여 보안 보강(작업 A) 회귀 테스트: 예약 장치 이름, 대체 데이터 스트림, 댕글링 symlink, 백업 동시성, mtime 상한, 단건 조회
import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApi } from '../../server/api.js';
import { isWindowsReserved } from '../../server/api.js';
import { createSidecarStore } from '../../src/lib/works/sidecarStore';

const servers: http.Server[] = [];
const dirs: string[] = [];

async function boot() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'works-hard-'));
  const root = path.join(base, 'notes');
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs', 'keep.md'), '지키기', 'utf8');
  dirs.push(base);
  const api = createApi(root);
  const server = http.createServer((req, res) => { void api(req, res); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { base, root, port: (server.address() as AddressInfo).port };
}

function raw(port: number, opts: { method?: string; path: string; headers?: Record<string, string | number>; body?: string | Buffer }) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path, headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}
const json = { 'Content-Type': 'application/json' };
const enc = encodeURIComponent;

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

const RESERVED = ['CON.md', 'nul.md', 'aux.md', 'com1.md', 'PRN.MD', 'dir/NUL.md', 'CON/x.md', 'lpt9.md', 'Con.txt.md', 'x.md.', 'x.md ', 'x.md. .', 'CON .md'];
const BAD_STREAM = ['a.md:x.md', 'docs/a.md:stream.md', 'docs:x/a.md', 'C:/x.md', 'C:x.md'];

describe('isWindowsReserved', () => {
  it('예약 이름과 끝 점·공백을 판정한다', () => {
    for (const s of ['CON', 'con.md', 'NUL.md', 'aux', 'COM1.md', 'LPT3.x.md', 'PRN.MD', 'CON .md', 'x.md.', 'x.md ']) expect(isWindowsReserved(s), s).toBe(true);
    for (const s of ['console.md', 'com10.md', 'a.md', 'nullable.md', 'com.md', '한글.md']) expect(isWindowsReserved(s), s).toBe(false);
  });
});

describe('Windows 예약 장치 이름·끝 점/공백', () => {
  it('/api/file·create·rename·upload·works 가 모두 거부한다', async () => {
    const { root, port } = await boot();
    for (const p of RESERVED) {
      expect((await raw(port, { path: `/api/file?path=${enc(p)}` })).status, `GET ${p}`).toBeGreaterThanOrEqual(400);
      const put = await raw(port, { method: 'PUT', path: `/api/file?path=${enc(p)}`, headers: json, body: '{"content":"x"}' });
      expect(put.status, `PUT ${p}`).toBe(400);
      const cr = await raw(port, { method: 'POST', path: '/api/create', headers: json, body: JSON.stringify({ path: p }) });
      expect(cr.status, `create ${p}`).toBe(400);
      const cd = await raw(port, { method: 'POST', path: '/api/create', headers: json, body: JSON.stringify({ path: p, type: 'dir' }) });
      expect(cd.status, `mkdir ${p}`).toBe(400);
      const rn = await raw(port, { method: 'POST', path: '/api/rename', headers: json, body: JSON.stringify({ from: 'docs/keep.md', to: p }) });
      expect(rn.status, `rename ${p}`).toBe(400);
      const up = await raw(port, { method: 'POST', path: `/api/upload?doc=${enc(p)}&ext=png`, body: 'x' });
      expect(up.status, `upload ${p}`).toBeGreaterThanOrEqual(400);
      const bd = await raw(port, { method: 'PUT', path: `/api/bundle/doc?path=${enc(p)}`, headers: json, body: '{"content":"x"}' });
      expect(bd.status, `bundle/doc ${p}`).toBe(400);
    }
    for (const p of ['CON/a/x.png', 'docs/assets/NUL/x.png', 'a/assets/x/aux.png', 'a/assets/x/x.png.']) {
      expect((await raw(port, { method: 'PUT', path: `/api/bundle/asset?path=${enc(p)}`, body: 'x' })).status, `asset ${p}`).toBe(400);
    }
    // 사이드카 파티션: 예약 이름 단독 파티션
    for (const part of ['CON', 'nul.md', 'aux']) {
      const r = await raw(port, { method: 'PUT', path: '/api/works', headers: json, body: JSON.stringify({ coll: 'versions', part, recs: [{ id: 'a', updatedAt: 1 }] }) });
      expect(r.status, `works ${part}`).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
    // 아무것도 만들어지지 않았다
    expect((await fs.readdir(root)).sort()).toEqual(['docs']);
    expect((await fs.readdir(path.join(root, 'docs'))).sort()).toEqual(['keep.md']);
  });

  it('예약 이름이 아닌 비슷한 이름은 계속 허용된다', async () => {
    const { port } = await boot();
    const cr = await raw(port, { method: 'POST', path: '/api/create', headers: json, body: JSON.stringify({ path: 'docs/console.md' }) });
    expect(cr.status).toBe(200);
  });
});

describe('대체 데이터 스트림·드라이브 문자', () => {
  it('콜론이 든 세그먼트는 모든 라우트에서 거부된다', async () => {
    const { root, port } = await boot();
    for (const p of BAD_STREAM) {
      const put = await raw(port, { method: 'PUT', path: `/api/file?path=${enc(p)}`, headers: json, body: '{"content":"x"}' });
      expect(put.status, `PUT ${p}`).toBeGreaterThanOrEqual(400);
      const cr = await raw(port, { method: 'POST', path: '/api/create', headers: json, body: JSON.stringify({ path: p }) });
      expect(cr.status, `create ${p}`).toBeGreaterThanOrEqual(400);
      const bd = await raw(port, { method: 'PUT', path: `/api/bundle/doc?path=${enc(p)}`, headers: json, body: '{"content":"x"}' });
      expect(bd.status, `bundle ${p}`).toBeGreaterThanOrEqual(400);
    }
    expect((await fs.readdir(path.join(root, 'docs'))).sort()).toEqual(['keep.md']);
    expect((await fs.readdir(root)).sort()).toEqual(['docs']);
  });
});

describe('끊어진(댕글링) symlink', () => {
  it('댕글링 symlink 를 통해 루트 밖에 파일을 만들 수 없다', async (ctx) => {
    const { base, root, port } = await boot();
    const outside = path.join(base, 'outside.md');
    const outDir = path.join(base, 'outdir');
    let canFile = true;
    let canDir = true;
    try { await fs.symlink(outside, path.join(root, 'docs', 'link.md'), 'file'); } catch { canFile = false; }
    try { await fs.symlink(outDir, path.join(root, 'docs', 'dlink'), 'junction'); } catch { canDir = false; }
    if (!canFile && !canDir) ctx.skip();
    if (canFile) {
      const r = await raw(port, { method: 'PUT', path: '/api/file?path=docs/link.md', headers: json, body: '{"content":"pwn"}' });
      expect(r.status).toBeGreaterThanOrEqual(400);
      await expect(fs.access(outside)).rejects.toThrow();
      const b = await raw(port, { method: 'PUT', path: '/api/bundle/doc?path=docs/link.md', headers: json, body: '{"content":"pwn"}' });
      expect(b.status).toBeGreaterThanOrEqual(400);
      await expect(fs.access(outside)).rejects.toThrow();
    }
    if (canDir) {
      const r = await raw(port, { method: 'PUT', path: '/api/file?path=docs/dlink/x.md', headers: json, body: '{"content":"pwn"}' });
      expect(r.status).toBeGreaterThanOrEqual(400);
      await expect(fs.access(path.join(outDir, 'x.md'))).rejects.toThrow();
    }
  });
});

describe('POST /api/backup 동시성·크기', () => {
  const zip = Buffer.concat([Buffer.from('PK'), Buffer.alloc(64)]);

  it('Content-Length 가 상한을 넘으면 본문을 읽기 전에 413', async () => {
    const { port } = await boot();
    const r = await raw(port, { method: 'POST', path: '/api/backup', headers: { 'Content-Length': 201 * 1024 * 1024 } });
    expect(r.status).toBe(413);
  });

  it('진행 중인 업로드가 있으면 두 번째는 429, 끝나면 다시 받는다', async () => {
    const { port } = await boot();
    // 첫 요청: 헤더만 보내고 본문을 천천히 보낸다
    const first = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/backup', headers: { 'Content-Length': zip.length } });
    const done = new Promise<number>((resolve, reject) => { first.on('response', (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); }); first.on('error', reject); });
    first.write(zip.subarray(0, 10));
    await new Promise((r) => setTimeout(r, 200));
    const second = await raw(port, { method: 'POST', path: '/api/backup', body: zip });
    expect(second.status).toBe(429);
    first.end(zip.subarray(10));
    expect(await done).toBe(200);
    expect((await raw(port, { method: 'POST', path: '/api/backup', body: zip })).status).toBe(200);
  });

  it('요청이 도중에 끊겨도 잠금이 풀린다', async () => {
    const { port } = await boot();
    const first = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/backup', headers: { 'Content-Length': 1000 } });
    first.on('error', () => {});
    first.write('PK');
    await new Promise((r) => setTimeout(r, 150));
    first.destroy();
    await new Promise((r) => setTimeout(r, 300));
    expect((await raw(port, { method: 'POST', path: '/api/backup', body: zip })).status).toBe(200);
  });
});

describe('PUT /api/bundle/doc mtime 상한', () => {
  it('1e13 초과·0 이하·비수치는 400, 상한 이하는 통과', async () => {
    const { port } = await boot();
    const put = (m: string) => raw(port, { method: 'PUT', path: `/api/bundle/doc?path=docs/m.md&mtime=${m}`, headers: json, body: '{"content":"x"}' });
    for (const m of ['10000000000001', '1e20', 'Infinity', '0', '-5', 'abc']) expect((await put(m)).status, m).toBe(400);
    expect((await put('1700000000000')).status).toBe(200);
    expect((await put('10000000000000')).status).toBe(200);
  });
});

describe('GET /api/works/one 단건 조회', () => {
  it('서버가 단건을 돌려주고, 없으면 null', async () => {
    const { port } = await boot();
    await raw(port, { method: 'PUT', path: '/api/works', headers: json, body: JSON.stringify({ coll: 'versions', part: 'docs/keep.md', recs: [{ id: 'r1', updatedAt: 5 }, { id: 'r2', updatedAt: 6 }] }) });
    const one = await raw(port, { path: `/api/works/one?coll=versions&part=${enc('docs/keep.md')}&id=r2` });
    expect(JSON.parse(one.text).record).toMatchObject({ id: 'r2', updatedAt: 6 });
    const none = await raw(port, { path: `/api/works/one?coll=versions&part=${enc('docs/keep.md')}&id=zz` });
    expect(none.status).toBe(200);
    expect(JSON.parse(none.text).record).toBeNull();
    expect((await raw(port, { path: `/api/works/one?coll=versions&part=${enc('docs/keep.md')}&id=${enc('../x')}` })).status).toBe(400);
  });

  it('sidecarStore.get 이 단건 엔드포인트를 쓴다', async () => {
    const { port } = await boot();
    const store = createSidecarStore(`http://127.0.0.1:${port}`);
    await store.putMany('versions', [{ id: 'a1', updatedAt: 1 } as never, { id: 'a2', updatedAt: 2 } as never], 'docs/keep.md');
    expect(await store.get('versions', 'a2', 'docs/keep.md')).toMatchObject({ id: 'a2' });
    expect(await store.get('versions', 'nope', 'docs/keep.md')).toBeUndefined();
  });
});
