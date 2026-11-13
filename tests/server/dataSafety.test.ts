// 서버 데이터 안전성 회귀 테스트: 원자적 쓰기, 외부 수정 충돌 검사, 이름 변경(이미지 링크·대소문자·스레드 docKey)
import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApi } from '../../server/api.js';
import { createSidecarStore } from '../../src/lib/works/sidecarStore';
import type { Thread } from '../../src/lib/works/types';

const servers: http.Server[] = [];
const dirs: string[] = [];

async function boot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'works-safe-'));
  dirs.push(root);
  const api = createApi(root);
  const server = http.createServer((req, res) => { void api(req, res); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { root, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

const json = { 'Content-Type': 'application/json' };
const enc = encodeURIComponent;
const putFile = (base: string, p: string, body: unknown) =>
  fetch(`${base}/api/file?path=${enc(p)}`, { method: 'PUT', headers: json, body: JSON.stringify(body) });
const rename = (base: string, from: string, to: string) =>
  fetch(`${base}/api/rename`, { method: 'POST', headers: json, body: JSON.stringify({ from, to }) });

describe('원자적 쓰기', () => {
  // 하드링크로 이어 둔 파일은 제자리 덮어쓰기면 같이 바뀌고, 임시 파일 + rename 이면 옛 내용이 그대로 남는다
  async function linked(root: string, rel: string, old: string) {
    const file = path.join(root, ...rel.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, old, 'utf8');
    const link = path.join(root, `link-${Math.random().toString(36).slice(2)}.bak`);
    await fs.link(file, link);
    return { file, link };
  }

  it('PUT /api/file 은 기존 파일을 제자리에서 덮어쓰지 않는다', async () => {
    const { base, root } = await boot();
    const { file, link } = await linked(root, 'a.md', '옛 내용');
    expect((await putFile(base, 'a.md', { content: '새 내용' })).status).toBe(200);
    expect(await fs.readFile(file, 'utf8')).toBe('새 내용');
    expect(await fs.readFile(link, 'utf8')).toBe('옛 내용');
  });

  it('PUT /api/comments 와 PUT /api/bundle/doc 도 마찬가지다', async () => {
    const { base, root } = await boot();
    const c = await linked(root, '.comments/a.md.json', '{"version":1,"comments":[]}');
    const comment = { id: 'c1', quote: '인용', text: '본문' };
    const r1 = await fetch(`${base}/api/comments?path=a.md`, { method: 'PUT', headers: json, body: JSON.stringify({ comments: [comment] }) });
    expect(r1.status).toBe(200);
    expect(await fs.readFile(c.link, 'utf8')).toBe('{"version":1,"comments":[]}');
    const d = await linked(root, 'b.md', '옛');
    const r2 = await fetch(`${base}/api/bundle/doc?path=b.md`, { method: 'PUT', headers: json, body: JSON.stringify({ content: '새' }) });
    expect(r2.status).toBe(200);
    expect(await fs.readFile(d.link, 'utf8')).toBe('옛');
    expect(await fs.readFile(d.file, 'utf8')).toBe('새');
  });

  it('같은 글에 대한 동시 저장은 끝까지 직렬화되고 임시 파일이 남지 않는다', async () => {
    const { base, root } = await boot();
    const texts = Array.from({ length: 20 }, (_, i) => `본문 ${i} ${'가'.repeat(20000)}`);
    const rs = await Promise.all(texts.map((content) => putFile(base, 'x.md', { content })));
    expect(rs.map((r) => r.status)).toEqual(texts.map(() => 200));
    expect(texts).toContain(await fs.readFile(path.join(root, 'x.md'), 'utf8'));
    expect(await fs.readdir(root)).toEqual(['x.md']);
  });

  it('쓰기에 실패하면 임시 파일을 남기지 않는다', async () => {
    const { base, root } = await boot();
    await fs.mkdir(path.join(root, 'dir.md')); // 폴더 위에는 덮어쓸 수 없다
    expect((await putFile(base, 'dir.md', { content: 'x' })).status).toBe(500);
    expect(await fs.readdir(root)).toEqual(['dir.md']);
  });
});

describe('PUT /api/file 외부 수정 충돌 검사', () => {
  it('baseMtime 이 디스크와 같으면 저장되고 새 mtime 을 돌려준다', async () => {
    const { base, root } = await boot();
    await fs.writeFile(path.join(root, 'a.md'), '옛', 'utf8');
    const { mtime } = await (await fetch(`${base}/api/file?path=a.md`)).json();
    const r = await putFile(base, 'a.md', { content: '새', baseMtime: mtime });
    expect(r.status).toBe(200);
    expect(typeof (await r.json()).mtime).toBe('number');
    expect(await fs.readFile(path.join(root, 'a.md'), 'utf8')).toBe('새');
  });

  it('디스크가 baseMtime 과 2ms 넘게 다르면 409 conflict(디스크 mtime 포함)이고 쓰지 않는다', async () => {
    const { base, root } = await boot();
    const file = path.join(root, 'a.md');
    await fs.writeFile(file, '외부 수정', 'utf8');
    const st = await fs.stat(file);
    const r = await putFile(base, 'a.md', { content: '내 수정', baseMtime: st.mtimeMs - 5000 });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error).toBe('conflict');
    expect(j.mtime).toBe(st.mtimeMs);
    expect(typeof j.message).toBe('string');
    expect(await fs.readFile(file, 'utf8')).toBe('외부 수정');
    // 2ms 이내 차이는 같은 것으로 본다
    expect((await putFile(base, 'a.md', { content: '내 수정', baseMtime: st.mtimeMs + 2 })).status).toBe(200);
  });

  it('force 면 충돌과 무관하게 덮어쓴다', async () => {
    const { base, root } = await boot();
    await fs.writeFile(path.join(root, 'a.md'), '외부', 'utf8');
    expect((await putFile(base, 'a.md', { content: '강제', baseMtime: 1, force: true })).status).toBe(200);
    expect(await fs.readFile(path.join(root, 'a.md'), 'utf8')).toBe('강제');
  });

  it('baseMtime 이 있는데 파일이 없으면 409 gone 이고 만들지 않는다', async () => {
    const { base, root } = await boot();
    const r = await putFile(base, 'gone.md', { content: 'x', baseMtime: 123 });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error).toBe('gone');
    expect(typeof j.message).toBe('string');
    expect(await fs.readdir(root)).toEqual([]);
    // force 면 새로 만든다
    expect((await putFile(base, 'gone.md', { content: 'x', baseMtime: 123, force: true })).status).toBe(200);
  });

  it('baseMtime 이 없으면 예전처럼 새 글을 만들고 덮어쓴다', async () => {
    const { base, root } = await boot();
    expect((await putFile(base, 'n/new.md', { content: '1' })).status).toBe(200);
    expect((await putFile(base, 'n/new.md', { content: '2' })).status).toBe(200);
    expect(await fs.readFile(path.join(root, 'n', 'new.md'), 'utf8')).toBe('2');
  });

  it('기존 오류 응답은 { error: 메시지 } 형태 그대로다', async () => {
    const { base } = await boot();
    const r = await putFile(base, 'a.txt', { content: 'x' });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: '.md 파일만 허용' });
  });
});

describe('이름 변경: 이미지 링크 치환', () => {
  const setup = async (root: string, name: string, body: string, rel = '') => {
    const dir = path.join(root, rel);
    await fs.mkdir(path.join(dir, 'assets', name), { recursive: true });
    await fs.writeFile(path.join(dir, 'assets', name, '1.png'), 'png');
    await fs.writeFile(path.join(dir, `${name}.md`), body, 'utf8');
  };

  it('한글·공백을 그대로 둔 링크와 encodeURIComponent 링크, 부분 인코딩 링크를 각자의 형태로 치환한다', async () => {
    const { base, root } = await boot();
    const old = '옛 노트';
    const body = [
      `![a](assets/${old}/1.png)`,
      `![b](assets/${enc(old)}/1.png)`,
      '![c](assets/옛%20노트/1.png)',
      `<img src="assets/${old}/1.png">`,
      '![다른 글](assets/다른 글/1.png)',
    ].join('\n');
    await setup(root, old, body);
    expect((await rename(base, `${old}.md`, '새 (이름).md')).status).toBe(200);
    const lines = (await fs.readFile(path.join(root, '새 (이름).md'), 'utf8')).split('\n');
    expect(lines[0]).toBe('![a](assets/새 %28이름%29/1.png)');
    expect(lines[1]).toBe(`![b](assets/${enc('새 (이름)')}/1.png)`);
    expect(lines[2]).toBe(`![c](assets/${enc('새 (이름)')}/1.png)`);
    expect(lines[3]).toBe('<img src="assets/새 %28이름%29/1.png">');
    expect(lines[4]).toBe('![다른 글](assets/다른 글/1.png)');
    await expect(fs.access(path.join(root, 'assets', '새 (이름)', '1.png'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, 'assets', old))).rejects.toThrow();
  });

  it('폴더 안의 글을 같은 폴더에서 바꾸거나 다른 폴더로 옮겨도 링크와 이미지가 맞는다', async () => {
    const { base, root } = await boot();
    await setup(root, '글', '![](assets/글/1.png)', '폴더');
    expect((await rename(base, '폴더/글.md', '폴더/새 글.md')).status).toBe(200);
    expect(await fs.readFile(path.join(root, '폴더', '새 글.md'), 'utf8')).toBe('![](assets/새 글/1.png)');
    expect((await rename(base, '폴더/새 글.md', '다른/새 글.md')).status).toBe(200);
    expect(await fs.readFile(path.join(root, '다른', '새 글.md'), 'utf8')).toBe('![](assets/새 글/1.png)');
    await expect(fs.access(path.join(root, '다른', 'assets', '새 글', '1.png'))).resolves.toBeUndefined();
  });

  it('폴더째 옮기면 안의 글·이미지·링크는 그대로 유효하다', async () => {
    const { base, root } = await boot();
    await setup(root, '글', '![](assets/글/1.png)', '옛폴더');
    expect((await rename(base, '옛폴더', '새폴더')).status).toBe(200);
    expect(await fs.readFile(path.join(root, '새폴더', '글.md'), 'utf8')).toBe('![](assets/글/1.png)');
    await expect(fs.access(path.join(root, '새폴더', 'assets', '글', '1.png'))).resolves.toBeUndefined();
  });
});

describe('이름 변경: 대소문자만 바꾸기', () => {
  it('a.md → A.md 가 거부되지 않고 내용·코멘트·사이드카가 보존된다', async () => {
    const { base, root } = await boot();
    await fs.writeFile(path.join(root, 'a.md'), '본문', 'utf8');
    await fs.mkdir(path.join(root, '.comments'), { recursive: true });
    await fs.writeFile(path.join(root, '.comments', 'a.md.json'), '{"version":1,"comments":[{"id":"c","quote":"q","text":"t"}]}', 'utf8');
    const store = createSidecarStore(base);
    await store.put('versions', { id: 'v1', docKey: 'a.md', updatedAt: 1, ts: 1, content: 'x', enc: 'raw' } as never, 'a.md');
    const r = await rename(base, 'a.md', 'A.md');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ path: 'A.md' });
    expect((await fs.readdir(root)).filter((n) => /^a\.md$/i.test(n))).toEqual(['A.md']);
    expect(await fs.readFile(path.join(root, 'A.md'), 'utf8')).toBe('본문');
    expect((await (await fetch(`${base}/api/comments?path=A.md`)).json()).comments).toHaveLength(1);
    expect((await store.list('versions', 'A.md')).map((v) => v.id)).toEqual(['v1']);
  });

  it('서로 다른 두 파일 사이의 이름 변경은 여전히 409', async () => {
    const { base, root } = await boot();
    await fs.writeFile(path.join(root, 'x.md'), '1', 'utf8');
    await fs.writeFile(path.join(root, 'y.md'), '2', 'utf8');
    expect((await rename(base, 'y.md', 'x.md')).status).toBe(409);
    expect(await fs.readFile(path.join(root, 'x.md'), 'utf8')).toBe('1');
    expect(await fs.readFile(path.join(root, 'y.md'), 'utf8')).toBe('2');
  });

  it('폴더 이름의 대소문자만 바꿔도 안의 글과 사이드카가 남는다', async () => {
    const { base, root } = await boot();
    await fs.mkdir(path.join(root, 'dir'));
    await fs.writeFile(path.join(root, 'dir', 'a.md'), '본문', 'utf8');
    const store = createSidecarStore(base);
    await store.put('versions', { id: 'v1', docKey: 'dir/a.md', updatedAt: 1, ts: 1, content: 'x', enc: 'raw' } as never, 'dir/a.md');
    expect((await rename(base, 'dir', 'Dir')).status).toBe(200);
    expect(await fs.readFile(path.join(root, 'Dir', 'a.md'), 'utf8')).toBe('본문');
    expect((await store.list('versions', 'Dir/a.md')).map((v) => v.id)).toEqual(['v1']);
  });
});

describe('이름 변경: 스레드 docKey', () => {
  const thread = (id: string, docKey: string): Thread => ({
    id, docKey, anchor: { quote: 'q', prefix: '', suffix: '' }, messages: [{ id: 'm', text: 't', ts: 1 }],
    resolved: false, createdAt: 1, updatedAt: 1,
  });

  it('글 이름을 바꾸면 스레드 레코드의 docKey 도 새 경로가 된다', async () => {
    const { base, root } = await boot();
    await fs.writeFile(path.join(root, 'a.md'), '본문', 'utf8');
    const store = createSidecarStore(base);
    await store.put('threads', thread('t1', 'a.md'), 'a.md');
    expect((await rename(base, 'a.md', 'b.md')).status).toBe(200);
    expect(await store.list('threads', 'a.md')).toEqual([]);
    expect((await store.list<Thread>('threads', 'b.md')).map((t) => t.docKey)).toEqual(['b.md']);
  });

  it('폴더를 옮기면 안의 글 스레드 docKey 가 모두 새 경로가 된다', async () => {
    const { base, root } = await boot();
    await fs.mkdir(path.join(root, 'd', 'sub'), { recursive: true });
    await fs.writeFile(path.join(root, 'd', 'a.md'), '1', 'utf8');
    await fs.writeFile(path.join(root, 'd', 'sub', 'b.md'), '2', 'utf8');
    const store = createSidecarStore(base);
    await store.put('threads', thread('t1', 'd/a.md'), 'd/a.md');
    await store.put('threads', thread('t2', 'd/sub/b.md'), 'd/sub/b.md');
    expect((await rename(base, 'd', 'e')).status).toBe(200);
    expect((await store.list<Thread>('threads', 'e/a.md')).map((t) => t.docKey)).toEqual(['e/a.md']);
    expect((await store.list<Thread>('threads', 'e/sub/b.md')).map((t) => t.docKey)).toEqual(['e/sub/b.md']);
  });

  it('movePart 로 옮긴 스레드는 이후 put 이 새 파티션에서 동작한다', async () => {
    const { base } = await boot();
    const store = createSidecarStore(base);
    await store.put('threads', thread('t1', 'a.md'), 'a.md');
    await store.movePart('threads', 'a.md', 'b.md');
    const [t] = await store.list<Thread>('threads', 'b.md');
    expect(t.docKey).toBe('b.md');
    await store.put('threads', { ...t, resolved: true }, t.docKey);
    expect((await store.list<Thread>('threads', 'b.md'))[0].resolved).toBe(true);
    expect((await store.parts('threads')).sort()).toEqual(['b.md']);
  });
});
