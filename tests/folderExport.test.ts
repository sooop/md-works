import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import type { BundleHost, HostDocInfo } from '../src/lib/bundle/host';
import { bytesToBase64, base64ToBytes, collectFolder, exportFolderJson, exportFolderLinked, exportFolderZip, folderJsonToBundle, linkDocs, parseFolderJson } from '../src/lib/folderExport';
import { parseBundle } from '../src/lib/bundle/parse';
import { parseArchive } from '../src/lib/archive';
import { classifyBytes } from '../src/lib/bundle/backupLogic';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const T = 1_700_000_000_000;

interface FakeDoc { name: string; content: string; assets?: string[] }
function fakeHost(docs: FakeDoc[], threads: Record<string, unknown[]> = {}) {
  let prepared = 0;
  const infos: HostDocInfo[] = docs.map((d, i) => ({ name: d.name, key: `k${i}`, updatedAt: T + i }));
  const host = {
    mode: 'server',
    async prepare() { prepared++; },
    async listDocs() { return infos; },
    async readDoc(info: HostDocInfo) {
      const d = docs.find((x) => x.name === info.name)!;
      return { content: d.content, raw: d.content, assets: (d.assets ?? []).map((path) => ({ path, data: PNG })) };
    },
    store: { async list(_c: string, part?: string) { return (threads[part ?? ''] ?? []) as never[]; } },
  } as unknown as BundleHost;
  return { host, prepared: () => prepared };
}

const th = (id: string, docKey: string) => ({
  id, docKey, anchor: { quote: 'q', prefix: '', suffix: '' }, messages: [{ id: 'm1', text: '메모', ts: T }],
  resolved: false, createdAt: T, updatedAt: T,
});

const docs: FakeDoc[] = [
  { name: 'P/a.md', content: '# A\n![x](assets/a/1.png)\n', assets: ['P/assets/a/1.png'] },
  { name: 'P/sub/b.md', content: 'B 본문\n![y](assets/b/1.png)\n![z](https://e.com/z.png)\n', assets: ['P/sub/assets/b/1.png'] },
  { name: 'P/c.md', content: 'C 본문' },
  { name: 'Q/other.md', content: '다른 폴더' },
  { name: 'PP/x.md', content: '접두어만 같은 폴더' },
];

describe('폴더 내보내기', () => {
  it('base64 는 청크 경계를 넘어도 왕복한다', () => {
    const big = new Uint8Array(0x6000 * 2 + 5).map((_, i) => i % 251);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });

  it('대상은 폴더 접두어로 시작하는 글뿐이고 prepare 를 부른다', async () => {
    const f = fakeHost(docs);
    const d = await collectFolder(f.host, 'P');
    expect(d.docs.map((x) => x.rel)).toEqual(['a.md', 'c.md', 'sub/b.md']);
    expect([...d.assets.keys()].sort()).toEqual(['assets/a/1.png', 'sub/assets/b/1.png']);
    expect(f.prepared()).toBe(1);
  });

  it('백업 JSON: 상대 경로·코멘트·에셋', async () => {
    const f = fakeHost(docs, { k0: [th('t1', 'P/a.md')] });
    const { text, count } = await exportFolderJson(f.host, 'P', 5);
    expect(count).toBe(3);
    const j = JSON.parse(text);
    expect(j).toMatchObject({ schema: 'md-works-folder', version: 1, folder: 'P', exportedAt: 5 });
    const a = j.docs.find((d: { path: string }) => d.path === 'a.md');
    expect(a.threads[0].docKey).toBe('a.md');
    expect(Object.keys(j.assets).sort()).toEqual(['assets/a/1.png', 'sub/assets/b/1.png']);
    expect(base64ToBytes(j.assets['assets/a/1.png'])).toEqual(PNG);
  });

  it('MD zip: 기존 zip 가져오기가 읽는다', async () => {
    const f = fakeHost(docs);
    const { bytes, count } = await exportFolderZip(f.host, 'P');
    expect(count).toBe(3);
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual(['a.md', 'assets/a/1.png', 'c.md', 'sub/assets/b/1.png', 'sub/b.md']);
    const parsed = parseArchive(bytes);
    expect(parsed.map((p) => p.stem)).toEqual(['a', 'c', 'sub - b']);
    expect(parsed[0].image('assets/a/1.png')?.data).toEqual(PNG);
  });

  it('연결된 MD: 순서·제목·구분선·data URI', async () => {
    const f = fakeHost(docs);
    const data = await collectFolder(f.host, 'P');
    const text = linkDocs(data, ['P/sub/b.md', 'P/a.md']);
    const heads = [...text.matchAll(/^# (.+)$/gm)].map((m) => m[1]);
    expect(heads).toEqual(['sub/b', 'a', 'A', 'c']); // 본문 안의 '# A' 도 잡힌다
    expect(text).toContain('\n\n---\n\n');
    const b64 = bytesToBase64(PNG);
    expect(text).toContain(`![y](data:image/png;base64,${b64})`);
    expect(text).toContain('![z](https://e.com/z.png)');
    const miss = linkDocs({ ...data, assets: new Map() }, []);
    expect(miss).toContain('![x](assets/a/1.png)');
    const r = await exportFolderLinked(f.host, 'Nope', []);
    expect(r.count).toBe(0);
  });
});

describe('폴더 JSON → 번들', () => {
  it('원래 폴더 아래로 복원되는 번들이 된다', async () => {
    const f = fakeHost(docs, { k0: [th('t1', 'P/a.md')] });
    const { text } = await exportFolderJson(f.host, 'P');
    const bytes = new TextEncoder().encode(text);
    expect(classifyBytes('P.json', bytes)).toBe('folder-json');
    expect(classifyBytes('other.json', new TextEncoder().encode('{"a":1}'))).toBe('other');
    const bundle = folderJsonToBundle(parseFolderJson(bytes)!, 'P');
    const p = parseBundle(bundle);
    expect([...p.docs.keys()].sort()).toEqual(['P/a.md', 'P/c.md', 'P/sub/b.md']);
    expect(p.docs.get('P/a.md')?.updatedAt).toBe(T);
    expect([...p.assets.keys()].sort()).toEqual(['P/assets/a/1.png', 'P/sub/assets/b/1.png']);
    expect(p.threads.get('P/a.md')?.[0].docKey).toBe('P/a.md');
  });

  it('folder 값이 없으면 파일명을 접두어로 쓴다', () => {
    const j = { schema: 'md-works-folder', version: 1, folder: '', exportedAt: 1, docs: [{ path: 'a.md', content: 'x', updatedAt: 1, threads: [] }], assets: {} };
    const p = parseBundle(folderJsonToBundle(j as never, '내폴더'));
    expect([...p.docs.keys()]).toEqual(['내폴더/a.md']);
  });
});
