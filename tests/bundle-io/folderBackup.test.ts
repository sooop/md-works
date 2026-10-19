// 서버 폴더 백업 라우트: 임시 폴더로 createApi 를 실제 http 서버에 얹어 호출한다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApi } from '../../server/api.js';

let root = '';
let server: http.Server;
let base = '';

const MWB = new Uint8Array([0x4d, 0x57, 0x42, 0x31, 1, 2, 3, 4, 5, 6]);
const ZIP = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9, 9]);
const post = (body: Uint8Array) => fetch(`${base}/api/backup`, { method: 'POST', body: body as BodyInit });
const list = async () => ((await (await fetch(`${base}/api/backups`)).json()) as { backups: { name: string; size: number; mtime: number }[] }).backups;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'works-backup-'));
  const api = createApi(root);
  server = http.createServer((req, res) => { api(req, res).then((h: boolean) => { if (!h) { res.writeHead(404); res.end(); } }); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await fs.rm(root, { recursive: true, force: true });
});

describe('POST /api/backup · GET /api/backups', () => {
  it('저장: .works-backup/md-works-YYYYMMDD-HHmmss.<mwb|zip>, 확장자는 내용으로 결정', async () => {
    const a = await (await post(MWB)).json();
    expect(a.name).toMatch(/^md-works-\d{8}-\d{6}(-\d+)?\.mwb$/);
    const b = await (await post(ZIP)).json();
    expect(b.name).toMatch(/\.zip$/);
    expect([...(await fs.readFile(path.join(root, '.works-backup', a.name)))]).toEqual([...MWB]);
    const names = (await list()).map((x) => x.name);
    expect(names).toContain(a.name);
    expect(names).toContain(b.name);
  });

  it('번들 형식이 아니거나 빈 본문은 400', async () => {
    expect((await post(new Uint8Array([1, 2, 3, 4, 5, 6]))).status).toBe(400);
    expect((await post(new Uint8Array())).status).toBe(400);
  });

  it('최근 10개만 남기고 오래된 것을 지운다(같은 초 충돌은 번호로 구분)', async () => {
    const dir = path.join(root, '.works-backup');
    await fs.rm(dir, { recursive: true, force: true });
    const names: string[] = [];
    for (let i = 0; i < 13; i++) names.push((await (await post(MWB)).json()).name);
    const left = await list();
    expect(left.length).toBe(10);
    // 최신순, 가장 오래된 3개는 삭제
    expect(left.map((x) => x.name)).toEqual(names.slice(3).reverse());
    expect((await fs.readdir(dir)).length).toBe(10);
  });

  it('목록은 이름 규칙에 맞는 파일만 보여 준다', async () => {
    await fs.writeFile(path.join(root, '.works-backup', 'memo.txt'), 'x');
    expect((await list()).some((x) => x.name === 'memo.txt')).toBe(false);
  });

  it('숨김 폴더라 트리에서 제외된다', async () => {
    const t = (await (await fetch(`${base}/api/tree`)).json()) as { children: { name: string }[] };
    expect(t.children.some((c) => c.name.startsWith('.works-backup'))).toBe(false);
  });
});

describe('GET /api/backup/file', () => {
  it('이름 검증 후 내용을 내려준다', async () => {
    const { name } = await (await post(MWB)).json();
    const res = await fetch(`${base}/api/backup/file?name=${encodeURIComponent(name)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(name);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...MWB]);
  });

  it('경로 탈출·규칙 위반 이름은 거부한다', async () => {
    await fs.writeFile(path.join(root, 'secret.md'), 'secret');
    for (const n of ['../secret.md', '..%2Fsecret.md', '../../etc/passwd', 'secret.md', 'md-works-20260101-000000.mwb/../../secret.md', '']) {
      const r = await fetch(`${base}/api/backup/file?name=${n}`);
      expect(r.status).toBe(400);
    }
  });

  it('없는 백업 파일은 404', async () => {
    expect((await fetch(`${base}/api/backup/file?name=md-works-19990101-000000.mwb`)).status).toBe(404);
  });
});
