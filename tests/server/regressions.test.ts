// 서버 결함 수정 회귀 테스트: 동시 create, rename(assets 충돌·숨김 거부), 항목 단위 순회 실패, JSON 본문 검증, 500 메시지, 휴지통 롤백·복구 보존
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApi } from '../../server/api.js';

const servers: http.Server[] = [];
const dirs: string[] = [];

async function boot() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'works-reg-'));
  const root = path.join(base, 'notes');
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  dirs.push(base);
  const api = createApi(root);
  const server = http.createServer((req, res) => { void api(req, res); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { root, port: (server.address() as AddressInfo).port };
}

function call(port: number, method: string, url: string, body?: string) {
  return new Promise<{ status: number; text: string; json: any }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { 'Content-Type': 'application/json' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: any = null;
        try { json = JSON.parse(text); } catch { /* 본문이 JSON 이 아님 */ }
        resolve({ status: res.statusCode ?? 0, text, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
const post = (port: number, url: string, obj: unknown) => call(port, 'POST', url, JSON.stringify(obj));
const present = (p: string) => fs.lstat(p).then(() => true, () => false);

afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('POST /api/create 배타 생성', () => {
  it('같은 글을 동시에 만들면 하나만 성공하고 나머지는 409, 내용은 보존된다', async () => {
    const { root, port } = await boot();
    const rs = await Promise.all(Array.from({ length: 8 }, () => post(port, '/api/create', { path: 'docs/race.md' })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(7);
    await fs.writeFile(path.join(root, 'docs', 'race.md'), '본문', 'utf8');
    expect((await post(port, '/api/create', { path: 'docs/race.md' })).status).toBe(409);
    expect(await fs.readFile(path.join(root, 'docs', 'race.md'), 'utf8')).toBe('본문');
  });

  it('폴더도 동시 생성 시 하나만 성공한다', async () => {
    const { port } = await boot();
    const rs = await Promise.all(Array.from({ length: 6 }, () => post(port, '/api/create', { path: 'a/b/dir', type: 'dir' })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(5);
  });
});

describe('POST /api/rename', () => {
  it('assets/<새 이름>/ 이 이미 있으면 409 로 거절하고 아무것도 옮기지 않는다', async () => {
    const { root, port } = await boot();
    await fs.mkdir(path.join(root, 'docs', 'assets', 'a'), { recursive: true });
    await fs.mkdir(path.join(root, 'docs', 'assets', 'b'), { recursive: true });
    await fs.writeFile(path.join(root, 'docs', 'a.md'), '![x](assets/a/x.png)', 'utf8');
    await fs.writeFile(path.join(root, 'docs', 'assets', 'a', 'x.png'), 'img');
    const r = await post(port, '/api/rename', { from: 'docs/a.md', to: 'docs/b.md' });
    expect(r.status).toBe(409);
    expect(await present(path.join(root, 'docs', 'a.md'))).toBe(true);
    expect(await present(path.join(root, 'docs', 'b.md'))).toBe(false);
    expect(await present(path.join(root, 'docs', 'assets', 'a', 'x.png'))).toBe(true);
  });

  it('assets 이동이 도중에 실패하면 옮긴 문서를 되돌린다', async () => {
    const { root, port } = await boot();
    await fs.mkdir(path.join(root, 'docs', 'assets', 'a'), { recursive: true });
    await fs.writeFile(path.join(root, 'docs', 'a.md'), '![x](assets/a/x.png)', 'utf8');
    const real = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from: any, to: any) => {
      if (String(from).includes(`${path.sep}assets${path.sep}a`)) throw Object.assign(new Error('boom'), { code: 'EPERM' });
      return real(from, to);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await post(port, '/api/rename', { from: 'docs/a.md', to: 'docs/b.md' });
    expect(r.status).toBe(500);
    expect(await present(path.join(root, 'docs', 'a.md'))).toBe(true);
    expect(await present(path.join(root, 'docs', 'b.md'))).toBe(false);
  });

  it('숨김 구성요소가 있는 from·to 는 400 이다', async () => {
    const { root, port } = await boot();
    await fs.mkdir(path.join(root, '.works'), { recursive: true });
    await fs.writeFile(path.join(root, '.works', 'x.md'), 'x', 'utf8');
    await fs.writeFile(path.join(root, 'docs', 'keep.md'), 'k', 'utf8');
    expect((await post(port, '/api/rename', { from: '.works/x.md', to: 'visible.md' })).status).toBe(400);
    expect((await post(port, '/api/rename', { from: '.works', to: 'visible' })).status).toBe(400);
    expect((await post(port, '/api/rename', { from: 'docs/keep.md', to: 'docs/.hidden.md' })).status).toBe(400);
    expect((await post(port, '/api/rename', { from: 'docs/keep.md', to: '.works/keep.md' })).status).toBe(400);
    expect(await present(path.join(root, '.works', 'x.md'))).toBe(true);
    expect(await present(path.join(root, 'docs', 'keep.md'))).toBe(true);
  });

  it('PUT 과 동시에 이름을 바꿔도 교착 없이 끝난다', async () => {
    const { root, port } = await boot();
    await fs.writeFile(path.join(root, 'docs', 'a.md'), 'old', 'utf8');
    const [put, rn] = await Promise.all([
      call(port, 'PUT', '/api/file?path=docs%2Fa.md', JSON.stringify({ content: 'new' })),
      post(port, '/api/rename', { from: 'docs/a.md', to: 'docs/b.md' }),
    ]);
    expect(put.status).toBe(200);
    expect(rn.status).toBe(200);
  });
});

describe('트리·검색·번들 목록은 항목 하나의 실패에 요청 전체가 죽지 않는다', () => {
  it('권한 없는 폴더·stat 실패 항목만 건너뛴다', async () => {
    const { root, port } = await boot();
    await fs.mkdir(path.join(root, 'bad'), { recursive: true });
    await fs.writeFile(path.join(root, 'bad', 'hidden.md'), '고유단어QQ', 'utf8');
    await fs.writeFile(path.join(root, 'docs', 'ok.md'), '고유단어QQ', 'utf8');
    await fs.writeFile(path.join(root, 'docs', 'gone.md'), '고유단어QQ', 'utf8');
    const realReaddir = fs.readdir.bind(fs) as any;
    vi.spyOn(fs, 'readdir').mockImplementation(((p: any, o: any) => (
      path.basename(String(p)) === 'bad' ? Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })) : realReaddir(p, o)
    )) as any);
    const realStat = fs.stat.bind(fs) as any;
    vi.spyOn(fs, 'stat').mockImplementation(((p: any, o: any) => (
      path.basename(String(p)) === 'gone.md' ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' })) : realStat(p, o)
    )) as any);

    const tree = await call(port, 'GET', '/api/tree');
    expect(tree.status).toBe(200);
    const docs = tree.json.children.find((c: any) => c.name === 'docs');
    expect(docs.children.map((c: any) => c.name)).toEqual(['ok.md']);
    expect(tree.json.children.some((c: any) => c.name === 'bad')).toBe(false);

    const idx = await call(port, 'GET', '/api/bundle/index');
    expect(idx.status).toBe(200);
    expect(idx.json.docs.map((d: any) => d.path)).toEqual(['docs/ok.md']);

    const found = await call(port, 'GET', `/api/search?q=${encodeURIComponent('고유단어QQ')}`);
    expect(found.status).toBe(200);
  });
});

describe('JSON 본문 검증과 500 응답', () => {
  it('null·배열·원시값 본문은 400 이다', async () => {
    const { port } = await boot();
    for (const body of ['null', '[]', '5', '"x"', 'true']) {
      for (const url of ['/api/create', '/api/rename', '/api/works/move-part', '/api/trash/restore']) {
        expect((await call(port, 'POST', url, body)).status, `${url} ${body}`).toBe(400);
      }
    }
  });

  it('예상 못 한 오류의 message 는 응답에 싣지 않는다', async () => {
    const { port } = await boot();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const realReaddir = fs.readdir.bind(fs) as any;
    vi.spyOn(fs, 'readdir').mockImplementation(((p: any, o: any) => (
      path.basename(String(p)) === 'notes' ? Promise.reject(new Error('SECRET-PATH-D:\\private')) : realReaddir(p, o)
    )) as any);
    const r = await call(port, 'GET', '/api/tree');
    expect(r.status).toBe(500);
    expect(r.text).not.toContain('SECRET');
    expect(typeof r.json.error).toBe('string');
  });
});

describe('휴지통 보존', () => {
  const mkTrashed = async (port: number, root: string) => {
    await fs.mkdir(path.join(root, 'docs', 'assets', 'a'), { recursive: true });
    await fs.writeFile(path.join(root, 'docs', 'a.md'), '귀한 글', 'utf8');
    await fs.writeFile(path.join(root, 'docs', 'assets', 'a', 'x.png'), 'img');
    const put = await call(port, 'PUT', '/api/works', JSON.stringify({ coll: 'versions', part: 'docs/a.md', recs: [{ id: 'v1', updatedAt: 1 }] }));
    expect(put.status).toBe(200);
  };

  it('이동 롤백이 실패하면 휴지통 폴더를 지우지 않는다', async () => {
    const { root, port } = await boot();
    await mkTrashed(port, root);
    const real = fs.rename.bind(fs);
    let n = 0;
    vi.spyOn(fs, 'rename').mockImplementation(async (from: any, to: any) => {
      if (n++ > 0) throw Object.assign(new Error('boom'), { code: 'EPERM' }); // 첫 조각(글)만 옮기고 이후(다음 조각·되돌리기)는 전부 실패
      return real(from, to);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await call(port, 'DELETE', '/api/file?path=docs%2Fa.md');
    expect(r.status).toBe(500);
    vi.restoreAllMocks();
    const list = await call(port, 'GET', '/api/trash');
    expect(list.json.items).toHaveLength(1);
    const td = path.join(root, '.works-trash', list.json.items[0].id);
    expect(await fs.readFile(path.join(td, 'item', 'a.md'), 'utf8')).toBe('귀한 글');
  });

  it('사이드카 이식이 실패하면 항목을 남기고 warnings 를 싣는다', async () => {
    const { root, port } = await boot();
    await mkTrashed(port, root);
    const del = await call(port, 'DELETE', '/api/file?path=docs%2Fa.md');
    expect(del.status).toBe(200);
    const real = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from: any, to: any) => {
      if (String(to).includes(`${path.sep}.works${path.sep}`)) throw Object.assign(new Error('boom'), { code: 'EPERM' });
      return real(from, to);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await post(port, '/api/trash/restore', { id: del.json.trashId });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, path: 'docs/a.md', type: 'file' });
    expect(r.json.warnings).toHaveLength(1);
    vi.restoreAllMocks();
    expect(await fs.readFile(path.join(root, 'docs', 'a.md'), 'utf8')).toBe('귀한 글');
    expect((await call(port, 'GET', '/api/trash')).json.items).toHaveLength(1);
  });
});
