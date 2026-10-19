import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { worksStoreContract } from './contract';
import { createSidecarStore } from '../../src/lib/works/sidecarStore';
import { createApi } from '../../server/api.js';

const servers: http.Server[] = [];
const dirs: string[] = [];

// 테스트마다 빈 임시 노트 폴더와 서버를 새로 띄운다
async function boot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'works-test-'));
  dirs.push(root);
  const api = createApi(root);
  const server = http.createServer((req, res) => { void api(req, res); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { root, base };
}

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

worksStoreContract('사이드카(서버)', async () => createSidecarStore((await boot()).base));

describe('사이드카 서버: 보안과 문서 연동', () => {
  const post = (base: string, p: string, body: unknown) =>
    fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('경로 탈출·잘못된 id·알 수 없는 컬렉션을 거부한다', async () => {
    const { base } = await boot();
    const put = (body: unknown) => fetch(base + '/api/works', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const rec = { id: 'a', updatedAt: 1 };
    expect((await put({ coll: 'versions', part: '../../evil', recs: [rec] })).status).toBe(200); // 인코딩되어 .works 안에 갇힌다
    expect((await put({ coll: 'versions', part: 'a.md', recs: [{ id: '../x', updatedAt: 1 }] })).status).toBe(400);
    expect((await put({ coll: 'nope', part: 'a.md', recs: [rec] })).status).toBe(400);
    expect((await put({ coll: 'versions', part: 'a.md', recs: [{ id: 'z' }] })).status).toBe(400);
  });

  it('인코딩된 파티션이 루트 밖에 파일을 만들지 않는다', async () => {
    const { base, root } = await boot();
    await fetch(base + '/api/works', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coll: 'versions', part: '../../evil', recs: [{ id: 'a', updatedAt: 1 }] }) });
    const outside = await fs.readdir(path.dirname(root));
    expect(outside.includes('evil')).toBe(false);
    expect((await fs.readdir(path.join(root, '.works', 'versions'))).length).toBe(1);
  });

  it('글 이름 변경·삭제 시 이력 파티션이 따라간다', async () => {
    const { base, root } = await boot();
    const store = createSidecarStore(base);
    await post(base, '/api/create', { path: 'dir/a.md' });
    await store.put('versions', { id: 'v1', docKey: 'dir/a.md', updatedAt: 1, ts: 1, content: 'x', enc: 'raw' }, 'dir/a.md');
    expect((await post(base, '/api/rename', { from: 'dir/a.md', to: 'dir/b.md' })).status).toBe(200);
    expect(await store.list('versions', 'dir/a.md')).toEqual([]);
    expect((await store.list('versions', 'dir/b.md')).length).toBe(1);
    // 폴더 이름 변경
    expect((await post(base, '/api/rename', { from: 'dir', to: 'dir2' })).status).toBe(200);
    expect((await store.list('versions', 'dir2/b.md')).length).toBe(1);
    // 삭제
    expect((await fetch(base + '/api/file?path=dir2/b.md', { method: 'DELETE' })).status).toBe(200);
    expect(await store.parts('versions')).toEqual([]);
    expect(await fs.readdir(root)).toContain('.works');
  });

  it('.works 는 트리에 나타나지 않는다', async () => {
    const { base } = await boot();
    const store = createSidecarStore(base);
    await store.put('snippets', { id: 's', updatedAt: 1 });
    const tree = await (await fetch(base + '/api/tree')).json();
    expect(JSON.stringify(tree)).not.toContain('.works');
  });
});
