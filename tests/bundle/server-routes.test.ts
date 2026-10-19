import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { bootServer, PNG } from './helpers';

const putDoc = (base: string, p: string, body: unknown = { content: 'x' }, mtime?: string) =>
  fetch(`${base}/api/bundle/doc?path=${encodeURIComponent(p)}${mtime ? `&mtime=${mtime}` : ''}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
const putAsset = (base: string, p: string, data: Uint8Array = PNG) =>
  fetch(`${base}/api/bundle/asset?path=${encodeURIComponent(p)}`, { method: 'PUT', body: data as BodyInit });
const outside = async (root: string) => (await fs.readdir(path.dirname(root))).filter((n) => /evil/i.test(n));

describe('서버 번들 라우트: 경로 탈출 거부', () => {
  const bad = ['../evil.md', 'a/../../evil.md', '/abs/evil.md', 'C:/evil.md', 'c:evil.md', 'a\\..\\evil.md', '..\\evil.md', '.hidden/a.md',
    '.works/a.md', 'a/.git/x.md', 'assets/a.md', 'node_modules/a.md', 'a//b.md', 'x.txt', 'noext', 'a.md:stream', 'a/./b.md', '', 'bad.md.'];
  it.each(bad)('글 쓰기 %j 는 400 이고 아무것도 만들지 않는다', async (p) => {
    const { base, root } = await bootServer();
    const res = await putDoc(base, p);
    expect(res.status).toBe(400);
    expect((await fs.readdir(root)).filter((n) => n !== '.works')).toEqual([]);
    expect(await outside(root)).toEqual([]);
  });

  const badAssets = ['../assets/x/1.png', 'assets/1.png', 'a/assets/1.png', 'assets/x/1.exe', 'assets/x/1.md', 'assets/x/1', '/assets/x/1.png', 'C:/assets/x/1.png',
    'assets/x/../../evil.png', 'assets/.hid/1.png', '.works/assets/x/1.png', 'assets/x/y/1.png'];
  it.each(badAssets)('에셋 쓰기 %j 는 400', async (p) => {
    const { base, root } = await bootServer();
    expect((await putAsset(base, p)).status).toBe(400);
    expect((await fs.readdir(root))).toEqual([]);
    expect(await outside(root)).toEqual([]);
  });

  it('정상 경로는 쓰이고 수정 시각을 지정할 수 있다', async () => {
    const { base, root } = await bootServer();
    const t = 1_700_000_000_000;
    const r = await putDoc(base, '폴더/하위/글.md', { content: '본문 ✓' }, String(t));
    expect(r.status).toBe(200);
    expect((await r.json()).mtime).toBe(t);
    expect(await fs.readFile(path.join(root, '폴더', '하위', '글.md'), 'utf8')).toBe('본문 ✓');
    expect((await putAsset(base, '폴더/assets/글/1.png')).status).toBe(200);
    expect(new Uint8Array(await fs.readFile(path.join(root, '폴더', 'assets', '글', '1.png')))).toEqual(PNG);
    expect((await putAsset(base, 'assets/글/2.PNG')).status).toBe(200); // 대소문자 확장자
  });

  it('잘못된 본문·mtime 은 400', async () => {
    const { base } = await bootServer();
    expect((await putDoc(base, 'a.md', { content: 5 })).status).toBe(400);
    expect((await putDoc(base, 'a.md', {})).status).toBe(400);
    expect((await putDoc(base, 'a.md', { content: 'x' }, 'abc')).status).toBe(400);
    expect((await putDoc(base, 'a.md', { content: 'x' }, '-5')).status).toBe(400);
    expect((await fetch(`${base}/api/bundle/doc?path=a.md`, { method: 'PUT', body: '{깨진' })).status).toBe(400);
  });

  it('에셋 크기 상한(50MB)을 넘으면 413', async () => {
    const { base, root } = await bootServer();
    const res = await putAsset(base, 'assets/x/big.png', new Uint8Array(51 * 1024 * 1024));
    expect(res.status).toBe(413);
    await expect(fs.access(path.join(root, 'assets', 'x', 'big.png'))).rejects.toThrow();
  });

  it('다른 출처 페이지의 요청은 거부(403)', async () => {
    const { base } = await bootServer();
    const res = await fetch(`${base}/api/bundle/doc?path=a.md`, {
      method: 'PUT', headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' }, body: '{"content":"x"}',
    });
    expect(res.status).toBe(403);
  });

  it('루트 안의 심볼릭 링크가 루트 밖을 가리켜도 쓰지 못한다', async () => {
    const { base, root } = await bootServer();
    const target = await fs.mkdtemp(path.join(path.dirname(root), 'evil-target-'));
    try {
      try { await fs.symlink(target, path.join(root, 'link'), 'junction'); } catch { return; /* 링크를 만들 수 없는 환경은 건너뛴다 */ }
      expect((await putDoc(base, 'link/x.md')).status).toBe(403);
      expect((await putAsset(base, 'link/assets/x/1.png')).status).toBe(403);
      expect(await fs.readdir(target)).toEqual([]);
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });
});

describe('서버 번들 라우트: 목록', () => {
  it('글(.md)과 이미지 에셋만 나열하고 숨김·node_modules·assets 안의 .md 는 제외한다', async () => {
    const { base, root } = await bootServer();
    const w = async (rel: string, data: string | Uint8Array = 'x') => {
      await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await fs.writeFile(path.join(root, rel), data);
    };
    await w('a.md'); await w('dir/b.md'); await w('dir/assets/b/1.png', PNG); await w('assets/a/2.jpg', PNG);
    await w('dir/assets/b/note.md'); await w('dir/assets/b/run.exe'); await w('assets/loose.png', PNG);
    await w('.works/versions/x/v.json', '{}'); await w('.git/x.md'); await w('node_modules/m/x.md'); await w('c.txt');
    const idx = await (await fetch(`${base}/api/bundle/index`)).json();
    expect(idx.docs.map((d: { path: string }) => d.path).sort()).toEqual(['a.md', 'dir/b.md']);
    expect(idx.docs.every((d: { mtime: number }) => d.mtime > 0)).toBe(true);
    expect(idx.assets.sort()).toEqual(['assets/a/2.jpg', 'dir/assets/b/1.png']);
  });
});
