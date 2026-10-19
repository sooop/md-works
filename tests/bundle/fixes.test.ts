// 독립 검증에서 발견된 결함(H3·H4·M2·M3·L3·L5)의 회귀 테스트
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { applyBundleWith, buildBundleWith, previewBundleWith } from '../../src/lib/bundle/core';
import { BundleError, parseBundle } from '../../src/lib/bundle/parse';
import { standaloneDevice, serverDevice, ver } from './helpers';
import type { Thread } from '../../src/lib/works/types';

const T = 1_700_000_000_000;
const manifest = JSON.stringify({ schema: 'md-works-bundle', version: 1, createdAt: 1, mode: 'html', app: 'md-works' });
const zip = (files: Record<string, string | Uint8Array>, opts: { level?: 0 | 6 } = {}) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [typeof v === 'string' ? strToU8(v) : v, { level: opts.level ?? 6 }]])) as never);
const withManifest = (files: Record<string, string | Uint8Array>, opts?: { level?: 0 | 6 }) => zip({ 'manifest.json': manifest, ...files }, opts);
const docsJson = (m: Record<string, number>) => JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { updatedAt: v }])));
const thread = (id: string, docKey: string): Thread => ({
  id, docKey, anchor: { quote: '인용', prefix: '', suffix: '' }, messages: [{ id: 'm' + id, text: '메시지', ts: T }],
  resolved: false, createdAt: T, updatedAt: T,
});

describe('H3: 서버 호스트의 대소문자 무시 이름 맞춤', () => {
  it('로컬 note.md 와 번들 Note.md 는 같은 글로 보고, 진 쪽 내용을 이력에 남긴다', async () => {
    const S = await serverDevice();
    await S.putDoc('note.md', '로컬 내용', T);
    const B = standaloneDevice();
    await B.putDoc('Note.md', '번들 내용', T + 1000);
    const bytes = (await buildBundleWith(B.host, T + 2000)).bytes;
    const pre = await previewBundleWith(S.host, bytes, T + 3000);
    expect(pre.docs).toEqual([{ name: 'note.md', action: 'update' }]);
    await applyBundleWith(S.host, bytes, {}, T + 3000);
    expect(await S.names()).toEqual(['note.md']);
    expect(await S.doc('note.md')).toBe('번들 내용');
    expect((await S.versions('note.md')).some((v) => v.text === '로컬 내용')).toBe(true);
  });

  it('번들 안에 대소문자만 다른 두 글이 있으면 미리보기가 충돌로 알리고 적용은 쓰기 전에 오류로 멈춘다', async () => {
    const S = await serverDevice();
    const bytes = withManifest({ 'A.md': '대문자', 'a.md': '소문자' });
    const pre = await previewBundleWith(S.host, bytes, T);
    expect(pre.nameCollisions?.length).toBe(1);
    await expect(applyBundleWith(S.host, bytes, {}, T)).rejects.toThrow(BundleError);
    expect(await S.names()).toEqual([]);
  });
});

describe('H4: 가져오기 중 만든 병합 전 버전은 솎아내기로 지워지지 않는다', () => {
  it('3일 전 같은 시간대에 양쪽이 고친 글: 로컬 수정이 이력에 남는다', async () => {
    const now = new Date(2026, 0, 13, 12, 0).getTime();
    const t1005 = new Date(2026, 0, 10, 10, 5).getTime();
    const t1020 = new Date(2026, 0, 10, 10, 20).getTime();
    const L = standaloneDevice();
    const R = standaloneDevice();
    const kl = (await L.putDoc('글.md', '로컬 수정', t1005), (await L.key('글.md'))!);
    await L.store.put('versions', ver('vA', kl, '로컬 수정', t1005), kl);
    const kr = (await R.putDoc('글.md', '번들 수정', t1020), (await R.key('글.md'))!);
    await R.store.put('versions', ver('vB', kr, '번들 수정', t1020), kr);
    const bytes = (await buildBundleWith(R.host, now)).bytes;
    await applyBundleWith(L.host, bytes, {}, now);
    expect(await L.doc('글.md')).toBe('번들 수정');
    expect((await L.versions('글.md')).some((v) => v.text === '로컬 수정')).toBe(true);
  });
});

describe('M2: 글 이름이 바뀐 뒤 옛 이름 번들을 가져와도 이력·스레드가 다른 글로 옮겨 가지 않는다', () => {
  it('다른 파티션에 이미 있는 id 는 건너뛴다', async () => {
    const A = standaloneDevice();
    const B = standaloneDevice();
    const ka = (await A.putDoc('옛이름.md', '본문', T), (await A.key('옛이름.md'))!);
    await A.store.put('versions', ver('v1', ka, '본문', T), ka);
    await A.store.put('threads', thread('t1', ka), ka);
    const kb = (await B.putDoc('새이름.md', '본문', T), (await B.key('새이름.md'))!); // B 는 같은 글의 이름을 바꾼 상태
    await B.store.put('versions', ver('v1', kb, '본문', T), kb);
    await B.store.put('threads', thread('t1', kb), kb);
    const bytes = (await buildBundleWith(A.host, T + 10)).bytes;
    await applyBundleWith(B.host, bytes, {}, T + 20);
    expect((await B.store.list('versions', kb)).map((v) => v.id)).toEqual(['v1']);
    expect((await B.store.list('threads', kb)).map((v) => v.id)).toEqual(['t1']);
  });
});

describe('M3: 서버 가져오기 사전 검증', () => {
  const expectRejected = async (bytes: Uint8Array) => {
    const S = await serverDevice();
    await expect(applyBundleWith(S.host, bytes, {}, T)).rejects.toThrow(BundleError);
    expect(await S.names()).toEqual([]);
  };
  it('서버가 거부할 문자(*?"<>|)가 든 이름은 쓰기 전에 중단', async () => {
    await expectRejected(withManifest({ 'a.md': '정상', 'b*c.md': '나쁨' }));
    await expectRejected(withManifest({ '질문?.md': '나쁨' }));
  });
  it('파티션(글 경로)이 200자를 넘으면 쓰기 전에 중단', async () => {
    await expectRejected(withManifest({ 'a.md': '정상', [`${'x'.repeat(198)}.md`]: '긴 이름' }));
  });
  it('글이 서버 JSON 상한(20MB)에 가까우면 쓰기 전에 중단', async () => {
    await expectRejected(withManifest({ 'a.md': '정상', 'big.md': 'a'.repeat(20 * 1024 * 1024) }));
  });
  it('mtime 이 너무 커도 가져온다(상한으로 맞춘다)', async () => {
    const S = await serverDevice();
    const bytes = withManifest({ 'a.md': '내용', '.works/docs.json': docsJson({ 'a.md': 9e15 }) });
    await applyBundleWith(S.host, bytes, {}, T);
    expect(await S.doc('a.md')).toBe('내용');
  });
});

describe('L3: 압축 해제 크기가 선언과 다르면 오류', () => {
  function forgeLast(bytes: Uint8Array, size: number): Uint8Array {
    const out = bytes.slice();
    const dv = new DataView(out.buffer);
    for (let i = out.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x02014b50) { dv.setUint32(i + 24, size, true); return out; }
    }
    throw new Error('중앙 디렉터리를 찾지 못했습니다');
  }
  const text = Array.from({ length: 400 }, (_, i) => `줄 ${i} ${'가나다'.repeat(i % 7)}`).join('\n');
  it.each([['작게', 5], ['크게', 1_000_000]])('선언 크기를 %s 속이면 BundleError', (_n, size) => {
    for (const level of [0, 6] as const) {
      const forged = forgeLast(withManifest({ 'z.md': text }, { level }), size);
      expect(() => parseBundle(forged)).toThrow(BundleError);
    }
  });
});

describe('L5: 이름이 너무 길거나 DEL 이 든 스탠드얼론 글은 건너뛰고 알린다', () => {
  it('나머지 글은 번들로 만들고 summary.skipped 에 이름을 남긴다', async () => {
    const A = standaloneDevice();
    await A.putDoc('정상.md', '본문', T);
    await A.putDoc(`${'x'.repeat(260)}.md`, '긴 이름', T);
    await A.putDoc('del\u007f.md', 'DEL', T);
    const { bytes, summary } = await buildBundleWith(A.host, T + 1);
    expect(summary.docs).toBe(1);
    expect(summary.skipped?.length).toBe(2);
    expect([...parseBundle(bytes).docs.keys()]).toEqual(['정상.md']);
  });
});
