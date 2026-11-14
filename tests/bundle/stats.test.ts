import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate';
import { applyBundleWith, buildBundleWith, previewBundleWith } from '../../src/lib/bundle/core';
import { parseBundle } from '../../src/lib/bundle/parse';
import { MAX_ABS } from '../../src/lib/stats/logic';
import { readDays, STATS_KEY } from '../../src/lib/stats/store';
import { standaloneDevice } from './helpers';

const T = 1_700_000_000_000;
const manifest = JSON.stringify({ schema: 'md-works-bundle', version: 1, createdAt: 1, mode: 'html', app: 'md-works' });
const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

let mem: Map<string, string>;
beforeEach(() => {
  mem = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

const setLocal = (days: Record<string, number>) => mem.set(STATS_KEY, JSON.stringify({ days }));

describe('번들의 집필 통계', () => {
  it('내보낼 때 .works/stats.json 에 { days } 를 싣는다', async () => {
    setLocal({ '2026-11-14': 120, '2026-11-13': -4 });
    const dev = standaloneDevice();
    await dev.putDoc('글.md', '본문', T);
    const { bytes } = await buildBundleWith(dev.host, T + 1);
    const f = unzipSync(bytes);
    expect(JSON.parse(strFromU8(f['.works/stats.json']))).toEqual({ days: { '2026-11-14': 120, '2026-11-13': -4 } });
  });

  it('왕복: 싣기 → 읽기 → 병합 (날짜별 큰 값 우선)', async () => {
    setLocal({ '2026-11-14': 120, '2026-11-13': 10 });
    const a = standaloneDevice();
    await a.putDoc('글.md', '본문', T);
    const { bytes } = await buildBundleWith(a.host, T + 1);
    expect(parseBundle(bytes).stats).toEqual({ '2026-11-14': 120, '2026-11-13': 10 });

    // 다른 기기: 11-14 는 더 작고, 11-13 은 더 크고, 11-12 는 이 기기에만 있다
    setLocal({ '2026-11-14': 50, '2026-11-13': 99, '2026-11-12': 7 });
    const b = standaloneDevice();
    await applyBundleWith(b.host, bytes, {}, T + 2);
    expect(readDays()).toEqual({ '2026-11-14': 120, '2026-11-13': 99, '2026-11-12': 7 });
  });

  it('미리보기는 통계를 건수로 세지 않고 아무것도 쓰지 않는다', async () => {
    setLocal({ '2026-11-14': 120 });
    const a = standaloneDevice();
    await a.putDoc('글.md', '본문', T);
    const { bytes } = await buildBundleWith(a.host, T + 1);
    const b = standaloneDevice();
    setLocal({});
    const before = JSON.stringify(await previewBundleWith(b.host, bytes, T + 2));
    expect(before).not.toMatch(/stat/i);
    expect(readDays()).toEqual({});
  });

  it('통계 파일이 없는 옛 번들은 그대로 읽히고 로컬 통계를 건드리지 않는다', async () => {
    setLocal({ '2026-11-14': 5 });
    const bytes = zip({ 'manifest.json': manifest, '글.md': '옛 번들 본문' });
    const parsed = parseBundle(bytes);
    expect(parsed.stats).toBeUndefined();
    expect(parsed.docs.get('글.md')?.content).toBe('옛 번들 본문');
    const b = standaloneDevice();
    const r = await applyBundleWith(b.host, bytes, {}, T);
    expect(r.docsAdded).toBe(1);
    expect(readDays()).toEqual({ '2026-11-14': 5 });
  });

  it('잘못된 항목만 버리고 번들 전체는 거부하지 않는다', async () => {
    const bad = {
      '2026-11-14': 10, '2026-11-13': 1.5, '2026-11-12': '9', '2026-2-3': 4, '2026-02-30': 4, abc: 1,
      '2026-11-08': MAX_ABS + 1, '2026-11-07': -MAX_ABS - 1, '2026-11-06': MAX_ABS,
    };
    const bytes = zip({ 'manifest.json': manifest, '글.md': '본문', '.works/stats.json': JSON.stringify({ days: bad }) });
    expect(parseBundle(bytes).stats).toEqual({ '2026-11-14': 10, '2026-11-06': MAX_ABS });
    await applyBundleWith(standaloneDevice().host, bytes, {}, T);
    expect(readDays()).toEqual({ '2026-11-14': 10, '2026-11-06': MAX_ABS });
  });

  it('깨진 JSON 이나 엉뚱한 형태의 통계 파일도 글은 읽힌다', () => {
    for (const body of ['{깨짐', '[1,2,3]', '"문자열"', '{"days":"x"}', '{"days":[1]}']) {
      const bytes = zip({ 'manifest.json': manifest, '글.md': '본문', '.works/stats.json': body });
      const p = parseBundle(bytes);
      expect(p.docs.has('글.md')).toBe(true);
      expect(p.stats ?? {}).toEqual({});
    }
  });

  it('날짜 수 상한(2,000)을 넘으면 최근 날짜만 남긴다', () => {
    const days: Record<string, number> = {};
    const d0 = new Date(2018, 0, 1, 12);
    for (let i = 0; i < 2100; i++) {
      const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i, 12);
      days[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] = 1;
    }
    const bytes = zip({ 'manifest.json': manifest, '.works/stats.json': JSON.stringify({ days }) });
    const out = parseBundle(bytes).stats!;
    expect(Object.keys(out)).toHaveLength(2000);
    expect(out['2018-01-01']).toBeUndefined();
  });
});
