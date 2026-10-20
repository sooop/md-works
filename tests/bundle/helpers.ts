// 번들 테스트 공용 도구: 가짜 IndexedDB 위의 스탠드얼론 '기기'와 임시 폴더 위의 서버 '기기'
import 'fake-indexeddb/auto';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll } from 'vitest';
import { createApi } from '../../server/api.js';
import { createIdbStore } from '../../src/lib/works/idbStore';
import { createSidecarStore } from '../../src/lib/works/sidecarStore';
import { createStandaloneHost } from '../../src/lib/bundle/hosts/standalone';
import { createServerHost } from '../../src/lib/bundle/hosts/server';
import type { BundleHost } from '../../src/lib/bundle/host';
import type { WorksStore } from '../../src/lib/works/store';
import type { Version } from '../../src/lib/works/types';
import { compress, decompress } from '../../src/lib/history/compress';

let n = 0;
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

export interface Device {
  host: BundleHost;
  store: WorksStore;
  /** 글 만들기/덮어쓰기. 스탠드얼론은 id 를 돌려주고 서버는 경로를 돌려준다 */
  putDoc(name: string, content: string, updated: number): Promise<string>;
  /** 글 본문 */
  doc(name: string): Promise<string | undefined>;
  /** 글 이름 → docKey */
  key(name: string): Promise<string | undefined>;
  names(): Promise<string[]>;
  /** 이력 버전(평문) */
  versions(name: string): Promise<(Version & { text: string })[]>;
  /** 이미지 추가(스탠드얼론: idb: 참조, 서버: 에셋 파일 경로) */
  addImage?(docName: string, data: Uint8Array): Promise<string>;
}

// ---- 스탠드얼론 ----
function openAppDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 3); // standalone-mode.svelte.ts 와 같은 스키마
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('kv');
      for (const s of ['docs', 'images', 'comments']) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function standaloneDevice(extra: { design?: { current(): string; apply(d: never): void } } = {}): Device & { dbName: string; applied: number } {
  const dbName = `works-standalone-test-${n++}`;
  const store = createIdbStore(`${dbName}-data`);
  const dev = { applied: 0 };
  const host = createStandaloneHost({
    dbName, store: () => store, afterApply: async () => { dev.applied++; },
    ...(extra.design ? { design: extra.design as never } : {}),
  });
  const dbp = openAppDb(dbName);
  const tx = async <T>(s: string, mode: IDBTransactionMode, fn: (o: IDBObjectStore) => IDBRequest<T>) => {
    const db = await dbp;
    return new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(s, mode).objectStore(s));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  };
  // 단일 모드는 글을 folder + name 으로 보관하고, 번들·테스트의 글 이름은 '폴더/이름.md' 경로다
  type R = { id: string; name: string; folder?: string; content: string; updated: number };
  const full = (r: R) => (r.folder ? `${r.folder}/${r.name}` : r.name);
  const recs = async () => (await tx<R[]>('docs', 'readonly', (s) => s.getAll())).map((r) => ({ ...r, path: full(r) }));
  const device: Device & { dbName: string; applied: number } = {
    host, store, dbName,
    get applied() { return dev.applied; },
    async putDoc(name, content, updated) {
      const cur = (await recs()).find((r) => r.path === name);
      const id = cur?.id ?? crypto.randomUUID();
      const i = name.lastIndexOf('/');
      await tx('docs', 'readwrite', (s) => s.put({ id, name: name.slice(i + 1), ...(i >= 0 ? { folder: name.slice(0, i) } : {}), content, updated }));
      return id;
    },
    async doc(name) { return (await recs()).find((r) => r.path === name)?.content; },
    async key(name) { return (await recs()).find((r) => r.path === name)?.id; },
    async names() { return (await recs()).map((r) => r.path).sort(); },
    async versions(name) {
      const k = await device.key(name);
      if (!k) return [];
      return (await store.list<Version>('versions', k)).map((v) => ({ ...v, text: decompress(v.content, v.enc) })).sort((a, b) => a.ts - b.ts);
    },
    async addImage(_docName, data) {
      const id = crypto.randomUUID();
      await tx('images', 'readwrite', (s) => s.put({ id, blob: new Blob([data as BlobPart], { type: 'image/png' }), created: Date.now() }));
      return `idb:${id}`;
    },
    async images() { return tx<{ id: string; blob: Blob }[]>('images', 'readonly', (s) => s.getAll()); },
  } as Device & { dbName: string; applied: number; images(): Promise<{ id: string; blob: Blob }[]> };
  return device;
}

// ---- 서버 ----
const servers: http.Server[] = [];
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

export async function bootServer() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'works-bundle-'));
  dirs.push(root);
  const api = createApi(root);
  const server = http.createServer((req, res) => { void api(req, res); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { root, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

export async function serverDevice(): Promise<Device & { root: string; base: string }> {
  const { root, base } = await bootServer();
  const store = createSidecarStore(base);
  const host = createServerHost({ base, store: () => store });
  const abs = (name: string) => path.join(root, ...name.split('/'));
  const walk = async (dir: string, out: string[] = []) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) { if (e.name !== 'assets') await walk(path.join(dir, e.name), out); } else if (e.name.endsWith('.md')) out.push(path.relative(root, path.join(dir, e.name)).split(path.sep).join('/'));
    }
    return out;
  };
  const device: Device & { root: string; base: string } = {
    host, store, root, base,
    async putDoc(name, content, updated) {
      await fs.mkdir(path.dirname(abs(name)), { recursive: true });
      await fs.writeFile(abs(name), content, 'utf8');
      const t = new Date(updated);
      await fs.utimes(abs(name), t, t);
      return name;
    },
    async doc(name) { return fs.readFile(abs(name), 'utf8').catch(() => undefined); },
    async key(name) { return (await device.doc(name)) === undefined ? undefined : name; },
    async names() { return (await walk(root)).sort(); },
    async versions(name) {
      return (await store.list<Version>('versions', name)).map((v) => ({ ...v, text: decompress(v.content, v.enc) })).sort((a, b) => a.ts - b.ts);
    },
    async addImage(docName, data) {
      const dir = path.posix.dirname(docName);
      const rel = path.posix.join(dir === '.' ? '' : dir, 'assets', docName.replace(/^.*\//, '').replace(/\.md$/, ''), 'pic.png');
      await fs.mkdir(path.dirname(abs(rel)), { recursive: true });
      await fs.writeFile(abs(rel), data);
      return rel;
    },
  };
  return device;
}

/** 이력 버전 레코드 만들기 */
export const ver = (id: string, docKey: string, text: string, ts: number, extra: Partial<Version> = {}): Version =>
  ({ id, docKey, ts, updatedAt: ts, ...compress(text), ...extra });
