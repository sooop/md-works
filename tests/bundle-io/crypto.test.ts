import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import { encryptBundle, decryptBundle, isEncrypted, hasBundleKey, BundleCryptoError, MAGIC } from '../../src/lib/bundle/crypto';

const KEY = 'test-key-1';
const sample = () => zipSync({ 'manifest.json': new TextEncoder().encode('{"schema":"md-works-bundle"}') });

async function codeOf(p: Promise<unknown>) {
  try { await p; } catch (e) { return e instanceof BundleCryptoError ? e.code : `other:${e}`; }
  return 'none';
}

describe('번들 암호화', () => {
  it('왕복: 암호화 후 복호화하면 원본과 같다', async () => {
    const plain = sample();
    const enc = await encryptBundle(plain, KEY);
    expect(isEncrypted(enc)).toBe(true);
    expect([...enc.slice(0, 4)]).toEqual([...MAGIC]);
    expect(enc.length).toBe(4 + 12 + plain.length + 16);
    expect([...(await decryptBundle(enc, KEY))]).toEqual([...plain]);
  });

  it('iv 가 매번 달라 같은 입력도 결과가 다르다', async () => {
    const a = await encryptBundle(sample(), KEY);
    const b = await encryptBundle(sample(), KEY);
    expect([...a]).not.toEqual([...b]);
  });

  it('키가 다르면 auth-failed', async () => {
    const enc = await encryptBundle(sample(), KEY);
    expect(await codeOf(decryptBundle(enc, 'other-key'))).toBe('auth-failed');
  });

  it('변조(iv·암호문·태그 한 바이트)하면 auth-failed', async () => {
    const enc = await encryptBundle(sample(), KEY);
    for (const pos of [5, 20, enc.length - 1]) {
      const t = enc.slice();
      t[pos] ^= 1;
      expect(await codeOf(decryptBundle(t, KEY))).toBe('auth-failed');
    }
  });

  it('키가 없으면 no-key (암호화·복호화 모두)', async () => {
    expect(hasBundleKey('')).toBe(false);
    expect(await codeOf(encryptBundle(sample(), ''))).toBe('no-key');
    const enc = await encryptBundle(sample(), KEY);
    expect(await codeOf(decryptBundle(enc, ''))).toBe('no-key');
  });

  it('형식 판별: 매직이 없으면 not-encrypted, 너무 짧으면 truncated', async () => {
    expect(isEncrypted(sample())).toBe(false);
    expect(isEncrypted(new Uint8Array([1, 2]))).toBe(false);
    expect(await codeOf(decryptBundle(sample(), KEY))).toBe('not-encrypted');
    expect(await codeOf(decryptBundle(new Uint8Array([...MAGIC, 1, 2, 3]), KEY))).toBe('truncated');
  });
});
