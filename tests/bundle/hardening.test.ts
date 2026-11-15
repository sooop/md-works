// 번들 읽기·만들기 보강: 시각 상한(미래 시각), zip CRC32 검증, 이력 이미지 캐시 공유
import { describe, it, expect, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { BundleError, crc32, parseBundle } from '../../src/lib/bundle/parse';
import { applyBundleWith, buildBundleWith } from '../../src/lib/bundle/core';
import { MAX_FUTURE_MS, clampTime, cleanSnippet, cleanThread, cleanVersion } from '../../src/lib/bundle/records';
import { relinkImages, type ImageCache } from '../../src/lib/archive';
import type { BundleHost } from '../../src/lib/bundle/host';
import { standaloneDevice, serverDevice } from './helpers';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const manifest = JSON.stringify({ schema: 'md-works-bundle', version: 1, createdAt: NOW, mode: 'html', app: 'md-works' });
const zip = (files: Record<string, string | Uint8Array>, level: 0 | 6 = 6) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [typeof v === 'string' ? strToU8(v) : v, { level }] as [Uint8Array, { level: 0 | 6 }]])));

describe('시각 상한 (미래 시각은 now 로 자른다)', () => {
  it('clampTime: now + 1일까지는 그대로, 넘으면 now', () => {
    expect(MAX_FUTURE_MS).toBe(DAY);
    expect(clampTime(NOW + DAY, NOW)).toBe(NOW + DAY);
    expect(clampTime(NOW + DAY + 1, NOW)).toBe(NOW);
    expect(clampTime(NOW - 5, NOW)).toBe(NOW - 5);
  });

  it('레코드: updatedAt·deletedAt 둘 다 자른다', () => {
    const far = NOW + 30 * DAY;
    const v = cleanVersion({ id: 'v1', updatedAt: far, deletedAt: far, ts: far, content: 'x', enc: 'raw' }, 'a.md', NOW)!;
    expect(v.updatedAt).toBe(NOW);
    expect(v.deletedAt).toBe(NOW);
    expect(v.ts).toBe(far); // 이력 시각(ts)은 이번 범위가 아니다
    expect(cleanSnippet({ id: 's', updatedAt: far, body: 'b' }, NOW)!.updatedAt).toBe(NOW);
    expect(cleanThread({ id: 't', updatedAt: far, anchor: { quote: 'q' }, messages: [] }, 'a.md', NOW)!.updatedAt).toBe(NOW);
    expect(cleanSnippet({ id: 's', updatedAt: NOW + 3600_000, body: 'b' }, NOW)!.updatedAt).toBe(NOW + 3600_000);
  });

  it('parseBundle: docs.json·묘비·사이드카의 미래 시각을 now 인자 기준으로 자른다', () => {
    const far = NOW + 400 * DAY;
    const bytes = zip({
      'manifest.json': manifest,
      'a.md': '본문', 'b.md': '본문2',
      '.works/docs.json': JSON.stringify({ 'a.md': { updatedAt: far }, 'b.md': { updatedAt: NOW - 10 } }),
      '.works/tombstones.json': JSON.stringify({ docs: { 'gone.md': far, 'old.md': NOW - 99 } }),
      '.works/snippets/_/s1.json': JSON.stringify({ id: 's1', updatedAt: far, deletedAt: far, body: 'x' }),
      '.works/versions/a.md.json': JSON.stringify([{ id: 'v1', updatedAt: far, ts: NOW, content: 'x', enc: 'raw' }]),
    });
    const p = parseBundle(bytes, { now: NOW });
    expect(p.docs.get('a.md')!.updatedAt).toBe(NOW);
    expect(p.docs.get('b.md')!.updatedAt).toBe(NOW - 10);
    expect(p.tombstones.docs).toEqual({ 'gone.md': NOW, 'old.md': NOW - 99 });
    expect(p.snippets[0]).toMatchObject({ updatedAt: NOW, deletedAt: NOW });
    expect(p.versions.get('a.md')![0].updatedAt).toBe(NOW);
    // now 를 앞당기면 같은 번들의 시각이 그대로 남는다(= 기준이 인자다)
    expect(parseBundle(bytes, { now: far }).docs.get('a.md')!.updatedAt).toBe(far);
  });

  it('스탠드얼론·서버 호스트 모두 미래 updatedAt 을 저장하지 않는다', async () => {
    const far = NOW + 100 * DAY;
    const bytes = zip({ 'manifest.json': manifest, 'a.md': '내용', '.works/docs.json': JSON.stringify({ 'a.md': { updatedAt: far } }) });
    for (const mk of [standaloneDevice, serverDevice] as const) {
      const d = await mk();
      await applyBundleWith(d.host, bytes, {}, NOW);
      const info = (await d.host.listDocs()).find((x) => x.name === 'a.md')!;
      expect(info.updatedAt).toBe(NOW);
    }
  });
});

describe('zip CRC32 검증', () => {
  it('crc32: 표준 시험 벡터', () => {
    expect(crc32(strToU8('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('정상 번들은 통과, 저장 항목의 데이터가 손상되면(크기는 그대로) 거부한다', () => {
    const marker = '손상되지않은본문-ABCDEFGH';
    const good = zip({ 'manifest.json': manifest, 'a.md': marker }, 0); // 무압축이라 본문 바이트가 그대로 보인다
    expect(parseBundle(good, { now: NOW }).docs.get('a.md')!.content).toBe(marker);

    const at = Buffer.from(good).indexOf(Buffer.from(marker));
    expect(at).toBeGreaterThan(0);
    const bad = good.slice();
    bad[at + 3] ^= 0x01; // 한 비트만 바꾼다
    const e = (() => { try { parseBundle(bad, { now: NOW }); } catch (x) { return x; } })();
    expect(e).toBeInstanceOf(BundleError);
    expect((e as Error).message).toMatch(/CRC32/);
  });

  it('중앙 디렉터리의 CRC 가 틀려도 거부한다', () => {
    const good = zip({ 'manifest.json': manifest, 'a.md': 'x' }, 0);
    const bad = good.slice();
    const dv = new DataView(bad.buffer);
    for (let i = bad.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x02014b50) { dv.setUint32(i + 16, dv.getUint32(i + 16, true) ^ 0xffff, true); break; }
    }
    expect(() => parseBundle(bad, { now: NOW })).toThrow(/CRC32/);
  });

  it('압축 항목이 깨져도 BundleError 로만 알린다', () => {
    const good = zip({ 'manifest.json': manifest, 'a.md': '반복 '.repeat(500) });
    const bad = good.slice();
    bad[Math.floor(bad.length / 2)] ^= 0xff;
    expect(() => parseBundle(bad, { now: NOW })).toThrow(BundleError);
  });
});

describe('이미지 캐시 공유 (relinkImages)', () => {
  const ID1 = '11111111-1111-1111-1111-111111111111';
  const ID2 = '22222222-2222-2222-2222-222222222222';
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: 'image/png' });

  it('같은 캐시를 쓰는 여러 본문은 이미지를 한 번만 읽고, 각 본문의 링크·assets 는 그대로 만든다', async () => {
    const load = vi.fn(async (_id: string) => png);
    const cache: ImageCache = new Map();
    const a = await relinkImages('글', `![](idb:${ID1}) ![](idb:${ID2})`, load, true, cache);
    const b = await relinkImages('글', `이전 ![](idb:${ID1})`, load, true, cache);
    expect(load).toHaveBeenCalledTimes(2); // ID1, ID2 한 번씩 (캐시 없이는 3번)
    expect(a.assets.map((x) => x.path).sort()).toEqual([`assets/글/${ID1}.png`, `assets/글/${ID2}.png`]);
    expect(b.assets.map((x) => x.path)).toEqual([`assets/글/${ID1}.png`]);
    expect(b.text).toBe(`이전 ![](assets/글/${ID1}.png)`);
    expect(b.assets[0].data).toBe(a.assets.find((x) => x.path.includes(ID1))!.data);
  });

  it('캐시가 없으면 호출마다 읽는다(기존 동작)', async () => {
    const load = vi.fn(async (_id: string) => png);
    await relinkImages('글', `![](idb:${ID1})`, load, true);
    await relinkImages('글', `![](idb:${ID1})`, load, true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('이미지가 없으면(null) 링크를 그대로 두고 캐시도 null 로 기억한다', async () => {
    const load = vi.fn(async (_id: string) => null);
    const cache: ImageCache = new Map();
    const r1 = await relinkImages('글', `![](idb:${ID1})`, load, true, cache);
    await relinkImages('글', `![](idb:${ID1})`, load, true, cache);
    expect(r1.assets).toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('buildBundleWith 는 글·이력 변환에 같은 imageCache 를 넘긴다', async () => {
    const seen = new Set<unknown>();
    const body = `![](idb:${ID1})`;
    const { compress } = await import('../../src/lib/history/compress');
    const versions = [1, 2, 3].map((i) => ({ id: `v${i}`, docKey: 'k', ts: NOW - i, updatedAt: NOW - i, ...compress(body) }));
    const host = {
      mode: 'html', convertsImages: true,
      store: { list: async (coll: string) => (coll === 'versions' ? versions : []), parts: async () => [] },
      prepare: async () => {},
      listDocs: async () => [{ name: 'a.md', key: 'k', updatedAt: NOW }],
      readDoc: async (_i: unknown, ctx?: { imageCache: unknown }) => { seen.add(ctx?.imageCache); return { content: 'x', assets: [], raw: body }; },
      textToBundle: async (_s: string, t: string, ctx?: { imageCache: unknown }) => { seen.add(ctx?.imageCache); return { text: t, assets: [] }; },
      design: { current: () => '{}', apply: () => {} },
    } as unknown as BundleHost;
    await buildBundleWith(host, NOW);
    expect(seen.size).toBe(1);
    expect([...seen][0]).toBeInstanceOf(Map);
  });
});
