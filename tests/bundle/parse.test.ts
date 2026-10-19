import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { BundleError, MAX_ENTRIES, parseBundle, safeEntryPath, isDocName } from '../../src/lib/bundle/parse';
import { applyBundleWith, previewBundleWith } from '../../src/lib/bundle/core';
import { encPart, decPart } from '../../src/lib/bundle/partName';
import { encPart as serverEnc, decPart as serverDec } from '../../server/worksStore.js';
import { standaloneDevice, serverDevice, PNG } from './helpers';

const manifest = JSON.stringify({ schema: 'md-works-bundle', version: 1, createdAt: 1, mode: 'html', app: 'md-works' });
const zip = (files: Record<string, string | Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));
const withManifest = (files: Record<string, string | Uint8Array>) => zip({ 'manifest.json': manifest, ...files });

/** 첫 중앙 디렉터리 항목의 '압축 풀린 크기' 필드를 조작한다 */
function forgeSize(bytes: Uint8Array, size: number): Uint8Array {
  const out = bytes.slice();
  const dv = new DataView(out.buffer);
  for (let i = out.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x02014b50) { dv.setUint32(i + 24, size, true); return out; }
  }
  throw new Error('중앙 디렉터리를 찾지 못했습니다');
}

describe('safeEntryPath', () => {
  it('정상 경로는 그대로', () => {
    for (const p of ['a.md', '폴더/글 이름.md', 'assets/글/1.png', '.works/docs.json', '.works/versions/dir%2fa.md/v1.json']) {
      expect(safeEntryPath(p)).toBe(p);
    }
  });
  it.each([
    ['../evil.md', '상위 폴더'], ['a/../../evil.md', '상위 폴더'], ['a/./b.md', '현재 폴더'], ['/etc/passwd', '절대 경로'],
    ['C:/win/x.md', '드라이브'], ['c:evil.md', '드라이브'], ['a\\b.md', '역슬래시'], ['..\\x.md', '역슬래시'], ['a//b.md', '빈 구간'],
    ['.git/config', '숨김'], ['.hidden/a.md', '숨김'], ['a/.ssh/x', '숨김'], ['.works/../x.md', '상위'], ['.worksx/a.json', '숨김'],
    ['a/.works/x', '숨김'], ['a.md:stream', '콜론'], ['a\0.md', '제어문자'], ['bad.md.', '끝 점'], ['dir /a.md', '끝 공백'], ['', '빈 경로'],
    ['x'.repeat(300) + '.md', '긴 구간'], ['/', '절대'],
  ])('%s 는 거부한다(%s)', (p) => {
    expect(() => safeEntryPath(p)).toThrow(BundleError);
  });
  it('글 이름 판정: .md 이고 .works·assets·node_modules 밖', () => {
    expect(isDocName('a/b.md')).toBe(true);
    expect(isDocName('a/b.MD')).toBe(true);
    for (const p of ['a.txt', '.works/a.md', 'assets/a.md', 'x/node_modules/a.md', '../a.md', 'a/assets/b/c.md']) expect(isDocName(p)).toBe(false);
  });
});

describe('parseBundle: 악성·잘못된 zip 거부', () => {
  it.each([
    ['경로 탈출', { '../evil.md': 'x' }],
    ['깊은 경로 탈출', { 'a/../../evil.md': 'x' }],
    ['절대 경로', { '/abs/evil.md': 'x' }],
    ['드라이브 문자', { 'C:/evil.md': 'x' }],
    ['숨김 폴더', { '.git/config': 'x' }],
    ['.works 가 아닌 숨김 사이드카', { '.comments/a.md.json': '{}' }],
    ['역슬래시', { 'a\\..\\evil.md': 'x' }],
    ['.works 안의 탈출', { '.works/versions/../../../evil.md': 'x' }],
  ])('%s', (_n, files) => {
    expect(() => parseBundle(withManifest(files))).toThrow(BundleError);
  });

  it('manifest 가 없거나 형식이 다르면 거부', () => {
    expect(() => parseBundle(zip({ 'a.md': 'x' }))).toThrow(/md-works 번들이 아닙니다/);
    expect(() => parseBundle(zip({ 'manifest.json': '{"schema":"other","version":1}' }))).toThrow(/md-works 번들이 아닙니다/);
    expect(() => parseBundle(zip({ 'manifest.json': 'not json' }))).toThrow(BundleError);
    expect(() => parseBundle(zip({ 'manifest.json': JSON.stringify({ schema: 'md-works-bundle', version: 99 }) }))).toThrow(/더 새로운 버전/);
    expect(() => parseBundle(zip({ 'manifest.json': JSON.stringify({ schema: 'md-works-bundle', version: 0 }) }))).toThrow(BundleError);
  });

  it('zip 이 아니거나 잘린 데이터', () => {
    expect(() => parseBundle(new Uint8Array([1, 2, 3, 4]))).toThrow(BundleError);
    const good = withManifest({ 'a.md': 'x'.repeat(1000) });
    expect(() => parseBundle(good.slice(0, good.length - 30))).toThrow(BundleError);
    expect(() => parseBundle(new Uint8Array())).toThrow(BundleError);
  });

  it('압축 해제 합계 1GB 초과(선언 크기)는 풀기 전에 거부한다 — zip 폭탄', () => {
    const files = zip({ 'manifest.json': manifest, 'a.md': 'x' });
    // 중앙 디렉터리의 첫 항목(manifest)이 아니라 a.md 의 선언 크기를 2GB 로 속인다
    const forged = files.slice();
    const dv = new DataView(forged.buffer);
    let hit = 0;
    for (let i = forged.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x02014b50) { hit++; if (hit === 1) dv.setUint32(i + 24, 2 * 1024 ** 3, true); }
    }
    expect(() => parseBundle(forged)).toThrow(/1GB/);
  });

  it('여러 항목의 선언 크기 합이 1GB 를 넘으면 거부', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 3; i++) files[`assets/d/${i}.png`] = PNG;
    let b = withManifest(files);
    b = b.slice();
    const dv = new DataView(b.buffer);
    for (let i = b.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x02014b50 && dv.getUint32(i + 24, true) === PNG.length) dv.setUint32(i + 24, 400 * 1024 * 1024, true);
    expect(() => parseBundle(b)).toThrow(/1GB/);
  });

  it('선언 크기를 작게 속여도 메모리를 키우지 못한다(오류이거나 선언 크기로 잘린다)', () => {
    const big = 'x'.repeat(200_000);
    const forged = forgeSize(withManifest({ 'a.md': big }), 10);
    let outcome: 'error' | 'truncated' | 'full' = 'full';
    try {
      const p = parseBundle(forged);
      const n = [...p.docs.values()][0]?.content.length ?? 0;
      outcome = n < big.length ? 'truncated' : 'full';
    } catch (e) {
      expect(e).toBeInstanceOf(BundleError);
      outcome = 'error';
    }
    expect(outcome).not.toBe('full');
  });

  it('항목 수 상한: fflate(zip64 미지원)가 읽을 수 있는 65535 개로 정해 두고, 넘으면 거부', () => {
    expect(MAX_ENTRIES).toBe(65_535);
    const files: Record<string, Uint8Array> = { 'manifest.json': strToU8(manifest) };
    for (let i = 0; i < 100; i++) files[`n/${i}.md`] = new Uint8Array(0);
    const z = zipSync(files, { level: 0 });
    expect(() => parseBundle(z, { maxEntries: 100 })).toThrow(/항목이 너무 많/); // 101 개
    expect(parseBundle(z, { maxEntries: 101 }).docs.size).toBe(100);
  });

  it('모르는 파일·깨진 레코드는 무시하고 나머지는 읽는다', () => {
    const p = parseBundle(withManifest({
      'a.md': '본문', 'README.txt': '무시', 'run.exe': 'MZ', 'assets/a/1.png': PNG, 'assets/1.png': PNG, // 마지막은 assets/<폴더>/ 밖이라 무시
      '.works/docs.json': JSON.stringify({ 'a.md': { updatedAt: 7 } }),
      '.works/versions/a.md/v1.json': '{깨진 json',
      '.works/versions/a.md/v2.json': JSON.stringify({ id: 'v2', docKey: 'x', ts: 1, updatedAt: 1, content: 'c', enc: 'raw' }),
      '.works/versions/a.md/v3.json': JSON.stringify({ id: 'other', docKey: 'x', ts: 1, updatedAt: 1, content: 'c', enc: 'raw' }), // 파일 이름과 id 가 다르다
      '.works/versions/not-md/v4.json': JSON.stringify({ id: 'v4', ts: 1, updatedAt: 1, content: 'c', enc: 'raw' }), // 글 이름이 아닌 파티션
      '.works/snippets/_/s1.json': JSON.stringify({ id: 's1', updatedAt: 1, body: 'b', color: '없는색', attachedDocs: ['a.md', 3] }),
    }));
    expect([...p.docs.keys()]).toEqual(['a.md']);
    expect(p.docs.get('a.md')).toEqual({ content: '본문', updatedAt: 7 });
    expect([...p.assets.keys()]).toEqual(['assets/a/1.png']);
    expect(p.versions.get('a.md')!.map((v) => v.id)).toEqual(['v2']);
    expect(p.versions.get('a.md')![0].docKey).toBe('a.md'); // 레코드 안의 docKey 는 믿지 않고 파티션 이름으로 덮는다
    expect(p.versions.has('not-md')).toBe(false);
    expect(p.snippets).toHaveLength(1);
    expect(p.snippets[0]).toMatchObject({ id: 's1', color: 'yellow', attachedDocs: ['a.md'] });
  });
});

describe('가져오기는 검증 전에 아무것도 쓰지 않는다', () => {
  it('악성 번들 → 스탠드얼론: 오류, 기존 데이터 그대로', async () => {
    const dev = standaloneDevice();
    await dev.putDoc('기존.md', '원본', 1);
    const evil = withManifest({ '기존.md': '덮어쓰기', '../evil.md': 'x' });
    await expect(applyBundleWith(dev.host, evil)).rejects.toBeInstanceOf(BundleError);
    await expect(previewBundleWith(dev.host, evil)).rejects.toBeInstanceOf(BundleError);
    expect(await dev.doc('기존.md')).toBe('원본');
    expect(await dev.names()).toEqual(['기존.md']);
    expect(dev.applied).toBe(0);
  });
  it('악성 번들 → 서버: 오류, 루트 밖·안 모두 쓰지 않는다', async () => {
    const dev = await serverDevice();
    const evil = withManifest({ 'ok.md': 'x', '../evil.md': 'x', '.works/versions/../../evil/a.json': '{}' });
    await expect(applyBundleWith(dev.host, evil)).rejects.toBeInstanceOf(BundleError);
    expect(await dev.names()).toEqual([]);
  });
  it('이 보관소에서 같은 이름이 되는 두 글은 오류(스탠드얼론: 폴더 펼치기 충돌)', async () => {
    const dev = standaloneDevice();
    const b = withManifest({ 'a/b.md': '1', 'a - b.md': '2' });
    await expect(applyBundleWith(dev.host, b)).rejects.toThrow(/같은 이름/);
    expect(await dev.names()).toEqual([]);
  });
  it('디자인 적용을 요청했는데 번들의 디자인이 깨졌으면 쓰기 전에 오류', async () => {
    const dev = standaloneDevice();
    const b = withManifest({ 'a.md': 'x', '.works/design.json': '{"schema":"wrong"}' });
    await expect(applyBundleWith(dev.host, b, { applyDesign: true })).rejects.toThrow(/디자인/);
    expect(await dev.names()).toEqual([]);
    // 적용을 요청하지 않으면 무시한다
    expect((await applyBundleWith(dev.host, b, {})).docsAdded).toBe(1);
  });
});

describe('파티션 이름 인코딩', () => {
  it('서버 사이드카(server/worksStore.js)와 같은 규칙이다', () => {
    for (const s of ['a.md', '폴더/글.md', '.hidden.md', 'x: y?.md', '100%/a.md', 'end .md', 'a|b<c>.md']) {
      expect(encPart(s)).toBe(serverEnc(s));
      expect(decPart(encPart(s))).toBe(s);
      expect(serverDec(encPart(s))).toBe(s);
    }
  });
});
