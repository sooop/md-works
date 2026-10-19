import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { applyBundleWith, buildBundleWith, previewBundleWith } from '../../src/lib/bundle/core';
import { standaloneDevice, serverDevice, ver, PNG, type Device } from './helpers';
import type { Snippet, Thread } from '../../src/lib/works/types';

const T = 1_700_000_000_000;
const snip = (id: string, over: Partial<Snippet> = {}): Snippet =>
  ({ id, body: `글감 ${id}`, color: 'yellow', createdAt: T, updatedAt: T, attachedDocs: [], ...over });
const thread = (id: string, docKey: string, over: Partial<Thread> = {}): Thread => ({
  id, docKey, anchor: { quote: '인용', prefix: '앞', suffix: '뒤' }, messages: [{ id: 'm' + id, text: '메시지', ts: T }],
  resolved: false, createdAt: T, updatedAt: T, ...over,
});
const bytesOf = (d: Device) => buildBundleWith(d.host, T + 1);
const files = (bytes: Uint8Array) => unzipSync(bytes);

/** 스탠드얼론 기기 하나에 글·이미지·이력·글감·스레드를 채운다 */
async function seed(dev: ReturnType<typeof standaloneDevice>) {
  const img = await dev.addImage!('첫 글.md', PNG);
  await dev.putDoc('첫 글.md', `# 첫 글\n\n본문 ![그림](${img})\n`, T + 10);
  await dev.putDoc('둘째.md', '둘째 글 본문', T + 20);
  const k1 = (await dev.key('첫 글.md'))!;
  const k2 = (await dev.key('둘째.md'))!;
  await dev.store.put('versions', ver('v1', k1, '# 첫 글\n초안', T + 5, { name: '초고' }), k1);
  await dev.store.put('versions', ver('v2', k1, `# 첫 글\n\n![그림](${img})\n옛 본문`, T + 6), k1);
  await dev.store.put('threads', thread('t1', k1), k1);
  await dev.store.put('snippets', snip('s1', { attachedDocs: [k1, k2], source: { url: 'https://x.test', title: '출처' } }));
  await dev.store.put('snippets', snip('s2', { deletedAt: T + 3, updatedAt: T + 3, trashedFrom: [k2] }));
  return { k1, k2, img };
}

describe('번들 만들기', () => {
  it('레이아웃: manifest, 글, 에셋, .works 사이드카(글 이름 파티션), 요약', async () => {
    const a = standaloneDevice();
    await seed(a);
    const { bytes, summary } = await bytesOf(a);
    const f = files(bytes);
    const names = Object.keys(f).sort();
    expect(names).toContain('manifest.json');
    expect(names).toContain('첫 글.md');
    expect(names).toContain('둘째.md');
    expect(names).toContain('assets/첫 글/1.png');
    expect(names).toContain('.works/docs.json');
    expect(names).toContain('.works/design.json');
    expect(names).toContain('.works/tombstones.json');
    expect(names).toContain('.works/versions/첫 글.md/v1.json');
    expect(names).toContain('.works/threads/첫 글.md/t1.json');
    expect(names).toContain('.works/snippets/_/s1.json');
    const manifest = JSON.parse(strFromU8(f['manifest.json']));
    expect(manifest).toMatchObject({ schema: 'md-works-bundle', version: 1, createdAt: T + 1, mode: 'html' });
    expect(JSON.parse(strFromU8(f['.works/docs.json']))['첫 글.md']).toEqual({ updatedAt: T + 10 });
    expect(strFromU8(f['첫 글.md'])).toContain('![그림](<assets/첫 글/1.png>)');
    // docKey 는 id 가 아니라 글 이름으로 바뀐다
    expect(JSON.parse(strFromU8(f['.works/versions/첫 글.md/v1.json'])).docKey).toBe('첫 글.md');
    expect(JSON.parse(strFromU8(f['.works/threads/첫 글.md/t1.json'])).docKey).toBe('첫 글.md');
    expect(JSON.parse(strFromU8(f['.works/snippets/_/s1.json'])).attachedDocs.sort()).toEqual(['둘째.md', '첫 글.md']);
    expect(JSON.parse(strFromU8(f['.works/snippets/_/s2.json'])).trashedFrom).toEqual(['둘째.md']);
    // 이력 버전 속 이미지도 상대 경로가 되고(이미지 id 파일명) 이미지는 번들에 들어간다
    const v2 = JSON.parse(strFromU8(f['.works/versions/첫 글.md/v2.json']));
    expect(v2.enc).toBe('deflate-b64');
    expect(summary).toMatchObject({ docs: 2, images: 2, versions: 2, snippets: 2, threads: 1 });
    expect(summary.bytes).toBe(bytes.length);
  });

  it('서버 노트 폴더의 상위 집합: 풀면 그대로 노트 폴더이고 사이드카는 서버 배치와 같다', async () => {
    const a = standaloneDevice();
    await seed(a);
    const f = files((await bytesOf(a)).bytes);
    const srv = await serverDevice();
    for (const [p, data] of Object.entries(f)) {
      const abs = path.join(srv.root, ...p.split('/'));
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, data);
    }
    // 서버 API 가 같은 사이드카를 그대로 읽는다
    expect((await srv.store.list('versions', '첫 글.md')).map((v) => v.id).sort()).toEqual(['v1', 'v2']);
    expect((await srv.store.list('threads', '첫 글.md')).length).toBe(1);
    expect((await srv.store.list('snippets')).length).toBe(2);
    expect(await srv.names()).toEqual(['둘째.md', '첫 글.md']);
  });
});

describe('왕복(내보내기 → 가져오기 후 동일)', () => {
  it('스탠드얼론 → 빈 스탠드얼론: 글·이미지·이력·글감·스레드가 같고, 연결은 새 id 로 매핑된다', async () => {
    const a = standaloneDevice();
    const { img } = await seed(a);
    const { bytes } = await bytesOf(a);
    const b = standaloneDevice();
    const pre = await previewBundleWith(b.host, bytes, T + 2);
    expect(pre.docs).toEqual([{ name: '둘째.md', action: 'add' }, { name: '첫 글.md', action: 'add' }]);
    expect(pre.snippets).toEqual({ add: 2, update: 0, same: 0, keepLocal: 0 });
    expect(pre.threads.add).toBe(1);
    expect(pre.versions.add).toBe(2);
    expect(await b.names()).toEqual([]); // 미리보기는 아무것도 쓰지 않는다

    const res = await applyBundleWith(b.host, bytes, {}, T + 2);
    expect(res).toEqual({ docsAdded: 2, docsUpdated: 0, conflicts: [], snippets: 2, threads: 1, versions: 2, designApplied: false });
    expect(b.applied).toBe(1);

    expect(await b.names()).toEqual(['둘째.md', '첫 글.md']);
    expect(await b.doc('둘째.md')).toBe('둘째 글 본문');
    const body = (await b.doc('첫 글.md'))!;
    expect(body).toMatch(/!\[그림\]\(idb:[0-9a-f-]{36}\)/);
    expect(body).not.toContain(img); // 새 이미지 id
    const kb1 = (await b.key('첫 글.md'))!;
    const kb2 = (await b.key('둘째.md'))!;
    // 이미지 바이트 보존
    const imgs = await (b as unknown as { images(): Promise<{ blob: Blob }[]> }).images();
    expect(imgs.length).toBeGreaterThanOrEqual(1);
    expect(new Uint8Array(await imgs[0].blob.arrayBuffer())).toEqual(PNG);
    // 이력·스레드는 새 docKey(id) 아래에
    expect((await b.versions('첫 글.md')).map((v) => [v.id, v.name])).toEqual([['v1', '초고'], ['v2', undefined]]);
    expect((await b.versions('첫 글.md'))[1].text).toMatch(/idb:[0-9a-f-]{36}/);
    expect((await b.store.list<Thread>('threads', kb1)).map((t) => [t.id, t.docKey])).toEqual([['t1', kb1]]);
    // 글감 연결과 휴지통 기억이 이름 → 새 id 로
    const s1 = (await b.store.get<Snippet>('snippets', 's1'))!;
    expect(s1.attachedDocs.sort()).toEqual([kb1, kb2].sort());
    expect(s1.source).toEqual({ url: 'https://x.test', title: '출처' });
    expect((await b.store.get<Snippet>('snippets', 's2'))!.trashedFrom).toEqual([kb2]);

    // 다시 내보내면 같은 번들 내용(이미지 id 와 생성 시각만 다르다)
    const again = files((await buildBundleWith(b.host, T + 1)).bytes);
    const orig = files(bytes);
    for (const p of ['첫 글.md', '둘째.md', 'assets/첫 글/1.png', '.works/docs.json', '.works/snippets/_/s1.json', '.works/snippets/_/s2.json', '.works/threads/첫 글.md/t1.json', '.works/versions/첫 글.md/v1.json']) {
      if (p.endsWith('.json')) expect(JSON.parse(strFromU8(again[p])), p).toEqual(JSON.parse(strFromU8(orig[p])));
      else expect(strFromU8(again[p]), p).toBe(strFromU8(orig[p]));
    }
    expect(again['assets/첫 글/1.png']).toEqual(PNG);
    // 같은 번들을 다시 가져와도 바뀌는 것이 없다
    const second = await applyBundleWith(b.host, bytes, {}, T + 3);
    expect(second).toMatchObject({ docsAdded: 0, docsUpdated: 0, conflicts: [], snippets: 0, threads: 0, versions: 0 });
  });

  it('서버 → 빈 서버: 글·에셋·사이드카·수정 시각이 같다', async () => {
    const a = await serverDevice();
    await a.putDoc('폴더/글.md', '# 글\n![x](assets/글/pic.png)', T + 100);
    await fs.mkdir(path.join(a.root, '폴더', 'assets', '글'), { recursive: true });
    await fs.writeFile(path.join(a.root, '폴더', 'assets', '글', 'pic.png'), PNG);
    await a.putDoc('루트.md', '루트 글', T + 50);
    await a.store.put('versions', ver('v1', '폴더/글.md', '옛 글', T + 90), '폴더/글.md');
    await a.store.put('threads', thread('t1', '폴더/글.md'), '폴더/글.md');
    await a.store.put('snippets', snip('s1', { attachedDocs: ['폴더/글.md'] }));
    const { bytes, summary } = await bytesOf(a);
    expect(summary).toMatchObject({ docs: 2, images: 1, versions: 1, snippets: 1, threads: 1 });
    expect(Object.keys(files(bytes))).toContain('폴더/assets/글/pic.png');
    expect(JSON.parse(strFromU8(files(bytes)['manifest.json'])).mode).toBe('server');

    const b = await serverDevice();
    const res = await applyBundleWith(b.host, bytes, {}, T + 200);
    expect(res).toMatchObject({ docsAdded: 2, snippets: 1, threads: 1, versions: 1 });
    expect(await b.names()).toEqual(['루트.md', '폴더/글.md']);
    expect(await b.doc('폴더/글.md')).toBe('# 글\n![x](assets/글/pic.png)');
    expect(new Uint8Array(await fs.readFile(path.join(b.root, '폴더', 'assets', '글', 'pic.png')))).toEqual(PNG);
    // 수정 시각이 번들의 updatedAt 으로 보존된다(가져온 시각으로 바뀌면 다음 병합에서 최신으로 오인한다)
    expect(Math.round((await fs.stat(path.join(b.root, '루트.md'))).mtimeMs)).toBe(T + 50);
    expect((await b.store.get<Snippet>('snippets', 's1'))!.attachedDocs).toEqual(['폴더/글.md']);
    expect((await b.store.list('threads', '폴더/글.md')).length).toBe(1);
    const again = await previewBundleWith(b.host, bytes, T + 300);
    expect(again.docs.every((d) => d.action === 'same')).toBe(true);
  });

  it('서버 → 스탠드얼론 → 서버: 폴더는 이름에 펼쳐지고 이미지는 보존된다', async () => {
    const a = await serverDevice();
    await a.putDoc('폴더/글.md', '# 글\n![x](assets/글/pic.png)', T + 100);
    await fs.mkdir(path.join(a.root, '폴더', 'assets', '글'), { recursive: true });
    await fs.writeFile(path.join(a.root, '폴더', 'assets', '글', 'pic.png'), PNG);
    await a.store.put('versions', ver('v1', '폴더/글.md', '옛 글', T + 90), '폴더/글.md');
    await a.store.put('snippets', snip('s1', { attachedDocs: ['폴더/글.md'] }));
    const s = standaloneDevice();
    await applyBundleWith(s.host, (await bytesOf(a)).bytes, {}, T + 200);
    expect(await s.names()).toEqual(['폴더 - 글.md']);
    expect(await s.doc('폴더 - 글.md')).toMatch(/!\[x\]\(idb:/);
    expect((await s.versions('폴더 - 글.md')).map((v) => v.id)).toEqual(['v1']);
    const k = (await s.key('폴더 - 글.md'))!;
    expect((await s.store.get<Snippet>('snippets', 's1'))!.attachedDocs).toEqual([k]);
    const back = await serverDevice();
    await applyBundleWith(back.host, (await bytesOf(s)).bytes, {}, T + 300);
    expect(await back.names()).toEqual(['폴더 - 글.md']);
    expect(new Uint8Array(await fs.readFile(path.join(back.root, 'assets', '폴더 - 글', '1.png')))).toEqual(PNG);
    expect(await back.doc('폴더 - 글.md')).toBe('# 글\n![x](<assets/폴더 - 글/1.png>)');
  });
});
