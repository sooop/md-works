import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import { encryptBundleWithPassword, BundleCryptoError } from '../../src/lib/bundle/crypto';
import { splitBytes, isBundleFile } from '../../src/lib/bundle/backupLogic';
import { readImportSource, needsPassword, decodeImportSource } from '../../src/lib/bundle/backupState.svelte';

const PW = '가져오기 비밀번호';
const IT = 1000;
const plain = () => zipSync({ 'manifest.json': new TextEncoder().encode('{"schema":"md-works-bundle"}') });
const file = (name: string, b: Uint8Array) => new File([b as BlobPart], name);

async function codeOf(p: Promise<unknown>) {
  try { await p; } catch (e) { return e instanceof BundleCryptoError ? e.code : `other:${e}`; }
  return 'none';
}

describe('MWB2 가져오기 흐름', () => {
  it('단일 .mwb: 비밀번호가 필요하다고 판별하고, 없으면 password-required, 맞으면 원본', async () => {
    const enc = await encryptBundleWithPassword(plain(), PW, IT);
    const src = await readImportSource([file('a.mwb', enc)]);
    expect(needsPassword(src)).toBe(true);
    expect(await codeOf(decodeImportSource(src))).toBe('password-required');
    expect(await codeOf(decodeImportSource(src, '틀림틀림틀림', IT))).toBe('password-failed');
    expect([...(await decodeImportSource(src, PW, IT))]).toEqual([...plain()]);
  });

  it('조각(.mwb.001…)을 이어 붙인 결과가 MWB2 면 같은 흐름을 탄다', async () => {
    const enc = await encryptBundleWithPassword(plain(), PW, IT);
    const chunks = splitBytes(enc, 40);
    expect(chunks.length).toBeGreaterThan(1);
    const files = chunks.map((c, i) => file(`md-works-x.mwb.${String(i + 1).padStart(3, '0')}`, c));
    const src = await readImportSource(files.reverse());
    expect(needsPassword(src)).toBe(true);
    expect([...(await decodeImportSource(src, PW, IT))]).toEqual([...plain()]);
  });

  it('평문 zip 은 비밀번호를 묻지 않는다', async () => {
    const src = await readImportSource([file('a.zip', plain())]);
    expect(needsPassword(src)).toBe(false);
    expect([...(await decodeImportSource(src))]).toEqual([...plain()]);
  });

  it('앱 전체 드롭 판정: MWB2 파일도 번들로 본다', async () => {
    const enc = await encryptBundleWithPassword(plain(), PW, IT);
    expect(await isBundleFile(file('a.mwb', enc))).toBe(true);
  });
});
