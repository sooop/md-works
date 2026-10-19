// 독립 검증(2026-10)에서 발견된 서버 보안 결함의 회귀 테스트
import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApi } from '../../server/api.js';
import { encPart, decPart } from '../../server/worksStore.js';
import { encPart as encPartClient, decPart as decPartClient } from '../../src/lib/bundle/partName';

const servers: http.Server[] = [];
const dirs: string[] = [];

async function boot() {
  const root = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'works-sec-')), 'notes');
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs', 'keep.md'), '지키기', 'utf8');
  dirs.push(path.dirname(root));
  const api = createApi(root);
  const server = http.createServer((req, res) => { void api(req, res); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { root, port: (server.address() as AddressInfo).port };
}

// fetch 는 Host 헤더를 바꿀 수 없어 http.request 를 쓴다
function raw(port: number, opts: { method?: string; path: string; headers?: Record<string, string>; body?: string }) {
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

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

const BS = String.fromCharCode(92); // 역슬래시 (도구 전달 중 이스케이프가 사라지는 일을 피한다)

describe('사이드카 part 의 역슬래시 경로 탈출', () => {
  it('encPart 는 역슬래시를 이스케이프하고 decPart 와 역함수다 (서버·클라이언트 동일)', () => {
    const s = `a${BS}..${BS}..${BS}docs`;
    for (const [e, d] of [[encPart, decPart], [encPartClient, decPartClient]] as const) {
      expect(e(s)).not.toContain(BS);
      expect(d(e(s))).toBe(s);
    }
    expect(encPart(s)).toBe(encPartClient(s));
  });

  it('역슬래시로 .works 밖에 쓰거나 지울 수 없다', async () => {
    const { root, port } = await boot();
    const part = ['a', '..', '..', '..', 'docs'].join(BS);
    const json = { 'Content-Type': 'application/json' };
    const put = await raw(port, { method: 'PUT', path: '/api/works', headers: json, body: JSON.stringify({ coll: 'versions', part, recs: [{ id: 'pwn', updatedAt: 1 }] }) });
    expect(put.status).toBe(200);
    await expect(fs.access(path.join(root, 'docs', 'pwn.json'))).rejects.toThrow(); // 밖에 파일이 생기지 않는다
    // 끝이 역슬래시인 part 로 지우기 시도
    const del = await raw(port, { method: 'DELETE', path: `/api/works/part?coll=versions&part=${encodeURIComponent(['a', '..', '..', '..', ''].join(BS))}` });
    expect([200, 400]).toContain(del.status);
    await expect(fs.access(path.join(root, 'docs', 'keep.md'))).resolves.toBeUndefined(); // 루트와 글은 그대로
    // 저장한 part 는 그대로 되읽힌다
    const list = await raw(port, { path: `/api/works?coll=versions&part=${encodeURIComponent(part)}` });
    expect(JSON.parse(list.text).records.length).toBe(1);
  });
});

describe('Host 헤더 검증 (DNS rebinding)', () => {
  it('허용 목록 밖의 Host 는 Origin 이 같아도 403', async () => {
    const { port } = await boot();
    const host = `evil.example:${port}`;
    const r = await raw(port, { path: '/api/info', headers: { Host: host, Origin: `http://${host}` } });
    expect(r.status).toBe(403);
    const d = await raw(port, { method: 'DELETE', path: '/api/file?path=docs/keep.md', headers: { Host: host, Origin: `http://${host}` } });
    expect(d.status).toBe(403);
  });

  it('127.0.0.1·localhost·[::1] 은 허용', async () => {
    const { port } = await boot();
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) {
      expect((await raw(port, { path: '/api/info', headers: { Host: host } })).status).toBe(200);
    }
  });

  it('Origin: null 은 500 이 아니라 403', async () => {
    const { port } = await boot();
    expect((await raw(port, { path: '/api/info', headers: { Origin: 'null' } })).status).toBe(403);
  });
});

describe('UNC 경로', () => {
  it('루트 밖 UNC 경로는 네트워크에 접근하기 전에 거부한다(빠르게 403)', async () => {
    const { port } = await boot();
    const t = Date.now();
    const unc = `${BS}${BS}192.0.2.1${BS}share${BS}a.md`;
    const r = await raw(port, { path: `/api/file?path=${encodeURIComponent(unc)}` });
    expect([400, 403]).toContain(r.status);
    expect(Date.now() - t).toBeLessThan(3000);
  });
});
