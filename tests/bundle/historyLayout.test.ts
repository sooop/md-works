// 이력 묶음 배치(글당 파일 하나)와 옛 배치(버전당 파일)의 읽기·쓰기·호환·규모 테스트
import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { applyBundleWith, buildBundleWith, packVersions, previewBundleWith } from '../../src/lib/bundle/core';
import { BUNDLE_VERSION, BundleError, HISTORY_LAYOUT, MAX_ENTRIES, MAX_TEXT_ENTRY_BYTES, VERSION_CHUNK_BYTES, parseBundle } from '../../src/lib/bundle/parse';
import { encPart } from '../../src/lib/bundle/partName';
import { compress } from '../../src/lib/history/compress';
import { standaloneDevice, ver } from './helpers';
import type { Version, WorksRecord } from '../../src/lib/works/types';
import type { WorksStore } from '../../src/lib/works/store';

const T = 1_700_000_000_000;
const manifest = (extra: Record<string, unknown> = {}) => strToU8(JSON.stringify({ schema: 'md-works-bundle', version: 1, createdAt: T, mode: 'html', app: 'md-works', ...extra }));
const rec = (id: string, text: string, ts = T, extra: Record<string, unknown> = {}) => ({ id, docKey: '엉뚱한키', ts, updatedAt: ts, ...compress(text), ...extra });
const zip = (files: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])), { level: 0 });
/** 옛 배치 고정 픽스처: manifest 에 historyLayout 이 없고 버전마다 `.works/versions/<글>/<id>.json` */
const legacyBundle = (name: string, recs: ReturnType<typeof rec>[]) => {
  const f: Record<string, string | Uint8Array> = { 'manifest.json': manifest(), [name]: '본문', '.works/docs.json': JSON.stringify({ [name]: { updatedAt: T } }) };
  for (const r of recs) f[`.works/versions/${encPart(name)}/${r.id}.json`] = JSON.stringify(r);
  return zip(f);
};
const ids = (m: Map<string, Version[]>, name: string) => (m.get(name) ?? []).map((v) => v.id).sort();

describe('옛 배치(버전당 파일) 읽기', () => {
  it('옛 형식 번들을 파싱해 같은 내부 구조로 만든다', () => {
    const p = parseBundle(legacyBundle('폴더/글.md', [rec('v1', '하나', T, { name: '초고' }), rec('v2', '둘')]));
    expect(ids(p.versions, '폴더/글.md')).toEqual(['v1', 'v2']);
    expect(p.versions.get('폴더/글.md')![0]).toMatchObject({ docKey: '폴더/글.md', name: '초고' }); // docKey 는 파티션 이름으로 덮는다
  });

  it('옛 형식 번들을 가져오면 이력이 들어가고, 다시 가져와도 늘지 않는다', async () => {
    const dev = standaloneDevice();
    const bytes = legacyBundle('글.md', [rec('v1', '하나', T, { name: 'a' }), rec('v2', '둘', T + 1, { name: 'b' })]);
    expect((await previewBundleWith(dev.host, bytes, T + 5)).versions).toEqual({ add: 2, same: 0 });
    expect((await applyBundleWith(dev.host, bytes, {}, T + 5)).versions).toBe(2);
    expect((await dev.versions('글.md')).map((v) => v.text)).toEqual(['하나', '둘']);
    expect((await previewBundleWith(dev.host, bytes, T + 6)).versions).toEqual({ add: 0, same: 2 });
  });
});

describe('새 배치(글당 파일) 읽기·쓰기', () => {
  it('manifest: version 은 1 그대로(옛 빌드가 거부하지 않게)이고 historyLayout 으로 새 배치를 표시한다', async () => {
    const dev = standaloneDevice();
    await dev.putDoc('글.md', '본문', T);
    const { bytes } = await buildBundleWith(dev.host, T);
    const m = JSON.parse(strFromU8(unzipSync(bytes)['manifest.json']));
    expect(m).toMatchObject({ version: BUNDLE_VERSION, historyLayout: HISTORY_LAYOUT });
    expect(BUNDLE_VERSION).toBe(1);
    expect(HISTORY_LAYOUT).toBe(2);
  });

  it('manifest 버전 처리: version 1 은 historyLayout 이 있든 없든 받고, 더 새로운 version 은 거부한다', () => {
    const pack = JSON.stringify([rec('v1', '하나')]);
    const base = { 'a.md': '본문', '.works/versions/a.md.json': pack };
    for (const extra of [{}, { historyLayout: 2 }, { historyLayout: 99 }]) {
      const p = parseBundle(zip({ 'manifest.json': manifest(extra), ...base }));
      expect(ids(p.versions, 'a.md')).toEqual(['v1']); // 파일이 있으면 historyLayout 값과 무관하게 읽는다
    }
    expect(() => parseBundle(zip({ 'manifest.json': manifest({ version: 2 }), ...base }))).toThrow(/더 새로운 버전/);
  });

  it('글마다 `.works/versions/<글>.json` 하나에 배열로 담고, 빈 이력은 파일을 만들지 않는다', async () => {
    const dev = standaloneDevice();
    await dev.putDoc('폴더/글.md', '본문', T);
    await dev.putDoc('이력없음.md', '본문', T);
    const k = (await dev.key('폴더/글.md'))!;
    await dev.store.putMany('versions', [ver('v1', k, '하나', T, { name: '이름' }), ver('v2', k, '둘', T + 1)], k);
    const { bytes, summary } = await buildBundleWith(dev.host, T);
    const names = Object.keys(unzipSync(bytes)).filter((n) => n.startsWith('.works/versions/'));
    expect(names).toEqual(['.works/versions/폴더%2f글.md.json']); // 옛 파서가 보는 3단 경로(<글>/<id>.json) 항목은 없다
    expect(summary.versions).toBe(2);
    const p = parseBundle(bytes);
    expect(ids(p.versions, '폴더/글.md')).toEqual(['v1', 'v2']);
    expect(p.versions.has('이력없음.md')).toBe(false);
  });

  it('묶음의 깨진 항목·배열이 아닌 파일은 건너뛰고 나머지는 읽는다', () => {
    const p = parseBundle(zip({
      'manifest.json': manifest(), 'a.md': 'x', 'b.md': 'x', 'c.md': 'x',
      '.works/versions/a.md.json': JSON.stringify([rec('v1', '하나'), { id: 'bad' }, 7, null, rec('v2', '둘')]),
      '.works/versions/b.md.json': JSON.stringify(rec('v3', '배열 아님')),
      '.works/versions/c.md.json': '{깨진 json',
      '.works/versions/not-md.json': JSON.stringify([rec('v4', '글 이름이 아님')]),
    }));
    expect(ids(p.versions, 'a.md')).toEqual(['v1', 'v2']);
    expect(p.versions.has('b.md')).toBe(false);
    expect(p.versions.has('c.md')).toBe(false);
    expect(p.versions.size).toBe(1);
  });

  it('왕복: 내보낸 이력(이름·압축본·시각)이 다른 기기에 그대로 들어간다', async () => {
    const a = standaloneDevice();
    await a.putDoc('글.md', '본문', T);
    const k = (await a.key('글.md'))!;
    await a.store.putMany('versions', [ver('v1', k, '하나', T, { name: '이름' }), ver('v2', k, '둘', T + 1, { name: '둘째' })], k);
    const { bytes } = await buildBundleWith(a.host, T);
    const b = standaloneDevice();
    expect((await applyBundleWith(b.host, bytes, {}, T + 9)).versions).toBe(2);
    expect((await b.versions('글.md')).map((v) => [v.id, v.name, v.text, v.ts])).toEqual([['v1', '이름', '하나', T], ['v2', '둘째', '둘', T + 1]]);
  });
});

describe('섞인 번들(두 배치가 함께)', () => {
  it('같은 id 는 한 번만, 다른 id 는 모두 합친다', async () => {
    const bytes = zip({
      'manifest.json': manifest({ historyLayout: 2 }), 'a.md': '본문',
      '.works/versions/a.md.json': JSON.stringify([rec('v1', '묶음 하나', T, { name: '묶음' }), rec('v2', '둘')]),
      '.works/versions/a.md/v2.json': JSON.stringify(rec('v2', '둘(옛)')),
      '.works/versions/a.md/v3.json': JSON.stringify(rec('v3', '셋(옛)', T + 2, { name: '셋' })),
    });
    const p = parseBundle(bytes);
    expect(ids(p.versions, 'a.md')).toEqual(['v1', 'v2', 'v3']);
    expect(p.versions.get('a.md')!.find((v) => v.id === 'v1')!.name).toBe('묶음');
    const dev = standaloneDevice();
    expect((await previewBundleWith(dev.host, bytes, T + 5)).versions).toEqual({ add: 3, same: 0 });
    expect((await applyBundleWith(dev.host, bytes, {}, T + 5)).versions).toBe(3);
    expect((await previewBundleWith(dev.host, bytes, T + 6)).versions).toEqual({ add: 0, same: 3 });
  });
});

describe('큰 이력 분할(`<글>.N.json`)', () => {
  it('packVersions: 크기 목표를 넘기면 나누고, 빈 이력은 파일이 없으며, 하나가 혼자 넘어도 담는다', () => {
    expect(packVersions([])).toEqual([]);
    const r = ['"' + 'a'.repeat(100) + '"', '"' + 'b'.repeat(100) + '"', '"' + 'c'.repeat(100) + '"'];
    const out = packVersions(r, 250);
    expect(out.length).toBe(2);
    expect(out.flatMap((t) => JSON.parse(t) as string[])).toEqual(r.map((x) => JSON.parse(x)));
    expect(packVersions([r[0]], 10)).toHaveLength(1);
    expect(VERSION_CHUNK_BYTES).toBeLessThan(MAX_TEXT_ENTRY_BYTES); // 나눈 파일 하나가 항목 상한(100MB)을 넘지 않는다
  });

  it('만들 때 `<글>.json`, `<글>.2.json` … 으로 나뉘고 읽을 때 합쳐진다', async () => {
    const a = standaloneDevice();
    await a.putDoc('글.md', '본문', T);
    const k = (await a.key('글.md'))!;
    const vs = Array.from({ length: 30 }, (_, i) => ver(`v${i}`, k, `본문 ${i}`, T + i, { name: `n${i}` }));
    await a.store.putMany('versions', vs, k);
    const { bytes } = await buildBundleWith(a.host, T, { chunkBytes: 1500 });
    const names = Object.keys(unzipSync(bytes)).filter((n) => n.startsWith('.works/versions/')).sort();
    expect(names.length).toBeGreaterThan(2);
    expect(names).toContain('.works/versions/글.md.json');
    expect(names).toContain('.works/versions/글.md.2.json');
    expect(ids(parseBundle(bytes).versions, '글.md')).toEqual(vs.map((v) => v.id).sort());
  });

  it('묶음 파일이 항목 상한(100MB)을 넘는다고 선언되면 오류 문구로 거부한다', () => {
    const forged = zip({ 'manifest.json': manifest(), 'a.md': 'x', '.works/versions/a.md.json': '[]' }).slice();
    const dv = new DataView(forged.buffer);
    for (let i = forged.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x02014b50) {
        const nameLen = dv.getUint16(i + 28, true);
        if (new TextDecoder().decode(forged.subarray(i + 46, i + 46 + nameLen)) === '.works/versions/a.md.json') { dv.setUint32(i + 24, MAX_TEXT_ENTRY_BYTES + 1, true); break; }
      }
    }
    expect(() => parseBundle(forged)).toThrow(BundleError);
    expect(() => parseBundle(forged)).toThrow(/너무 큽니다/);
  });
});

/** 큰 규모 테스트용 메모리 저장소(가짜 IndexedDB 는 9만 건을 쓰는 데 수 분이 걸린다) */
function memStore(): WorksStore {
  const m = new Map<string, Map<string, { rec: WorksRecord; part: string }>>();
  const coll = (c: string) => m.get(c) ?? m.set(c, new Map()).get(c)!;
  return {
    async list(c, part) { return [...coll(c).values()].filter((x) => part === undefined || x.part === part).map((x) => x.rec) as never; },
    async get(c, id) { return coll(c).get(id)?.rec as never; },
    async put(c, rec, part = '_') { coll(c).set(rec.id, { rec, part }); },
    async putMany(c, recs, part = '_') { for (const r of recs) coll(c).set(r.id, { rec: r, part }); },
    async remove(c, id) { coll(c).delete(id); },
    async parts(c) { return [...new Set([...coll(c).values()].map((x) => x.part))]; },
    async removePart() { /* 쓰지 않는다 */ },
    async movePart() { /* 쓰지 않는다 */ },
  };
}

describe('규모: 옛 형식이면 항목 수 상한을 넘는 번들', () => {
  it('글 300편 × 버전 300개(옛 형식이면 90,000 항목)가 만들어지고 다시 읽혀 왕복이 맞는다', async () => {
    const DOCS = 300;
    const PER = 300;
    expect(DOCS * PER).toBeGreaterThan(MAX_ENTRIES); // 옛 형식이면 항목 수 초과로 실패했을 규모
    const a = standaloneDevice();
    const src = memStore();
    const tpl = ver('', '', 'v', T); // 본문은 아주 짧게, 압축은 한 번만
    for (let d = 0; d < DOCS; d++) {
      const name = `글${String(d).padStart(3, '0')}.md`;
      await a.putDoc(name, `본문 ${d}`, T + d);
      const k = (await a.key(name))!;
      // 이름이 붙은 버전은 솎아내기 대상이 아니라 그대로 남는다
      await src.putMany('versions', Array.from({ length: PER }, (_, i) => ({ ...tpl, id: `d${d}v${i}`, docKey: k, ts: T + i, updatedAt: T + i, name: `n${i}` })), k);
    }
    const { bytes, summary } = await buildBundleWith({ ...a.host, store: src }, T + 1);
    expect(summary).toMatchObject({ docs: DOCS, versions: DOCS * PER });
    expect(Object.keys(unzipSync(bytes)).length).toBeLessThan(DOCS * 3 + 10); // 글 + 이력 묶음 + 메타뿐
    const p = parseBundle(bytes);
    expect(p.versions.size).toBe(DOCS);
    expect([...p.versions.values()].reduce((n, l) => n + l.length, 0)).toBe(DOCS * PER);

    const dst = memStore();
    const b = standaloneDevice();
    const host = { ...b.host, store: dst };
    expect((await previewBundleWith(host, bytes, T + 5)).versions).toEqual({ add: DOCS * PER, same: 0 });
    expect((await applyBundleWith(host, bytes, {}, T + 5)).versions).toBe(DOCS * PER);
    const kb = (await b.key('글007.md'))!;
    expect((await dst.list<Version>('versions', kb)).map((v) => v.id).sort()).toEqual(Array.from({ length: PER }, (_, i) => `d7v${i}`).sort());
    expect((await previewBundleWith(host, bytes, T + 6)).versions).toEqual({ add: 0, same: DOCS * PER });
  }, 300_000);
});
