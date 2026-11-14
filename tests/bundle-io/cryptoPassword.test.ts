import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import {
  encryptBundle, encryptBundleWithPassword, decryptBundleWithPassword, decryptBundle, detectFormat, isEncrypted, isPasswordEncrypted,
  BundleCryptoError, MAGIC, MAGIC2, PBKDF2_ITERATIONS, PBKDF2_MIN_ITERATIONS, PBKDF2_MAX_ITERATIONS,
} from '../../src/lib/bundle/crypto';
import { classifyBytes } from '../../src/lib/bundle/backupLogic';
import { checkPasswordPair, PASSWORD_MIN_RECOMMENDED } from '../../src/lib/bundle/passwordInput';

// 테스트는 작은 반복 횟수를 주입한다(복호화 하한도 같은 값으로 낮춘다)
const IT = 1000;
const PW = 'correct horse battery';
const sample = () => zipSync({ 'manifest.json': new TextEncoder().encode('{"schema":"md-works-bundle"}') });

async function codeOf(p: Promise<unknown>) {
  try { await p; } catch (e) { return e instanceof BundleCryptoError ? e.code : `other:${e}`; }
  return 'none';
}
const setIter = (b: Uint8Array, n: number) => {
  const t = b.slice();
  new DataView(t.buffer).setUint32(20, n, false);
  return t;
};

describe('MWB2 비밀번호 암호화', () => {
  it('왕복 + 헤더 레이아웃(매직·salt 16·반복 횟수 BE·iv 12·암호문+태그)', async () => {
    const plain = sample();
    const enc = await encryptBundleWithPassword(plain, PW, IT);
    expect([...enc.slice(0, 4)]).toEqual([...MAGIC2]);
    expect(new DataView(enc.buffer).getUint32(20, false)).toBe(IT);
    expect(enc.length).toBe(4 + 16 + 4 + 12 + plain.length + 16);
    expect([...(await decryptBundleWithPassword(enc, PW, IT))]).toEqual([...plain]);
  });

  it('기본 반복 횟수는 600,000 이고 상·하한 상수가 맞다', () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    expect(PBKDF2_MIN_ITERATIONS).toBe(100_000);
    expect(PBKDF2_MAX_ITERATIONS).toBe(10_000_000);
  });

  it('틀린 비밀번호는 password-failed (메시지에 비밀번호가 없다)', async () => {
    const enc = await encryptBundleWithPassword(sample(), PW, IT);
    try {
      await decryptBundleWithPassword(enc, 'wrong-pass-word', IT);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BundleCryptoError);
      expect((e as BundleCryptoError).code).toBe('password-failed');
      expect((e as Error).message).toBe('비밀번호가 맞지 않거나 파일이 손상되었습니다');
      expect((e as Error).message).not.toContain('wrong-pass-word');
    }
  });

  it('빈 비밀번호는 password-required', async () => {
    expect(await codeOf(encryptBundleWithPassword(sample(), '', IT))).toBe('password-required');
    const enc = await encryptBundleWithPassword(sample(), PW, IT);
    expect(await codeOf(decryptBundleWithPassword(enc, '', IT))).toBe('password-required');
  });

  it('변조(salt·iv·암호문·태그 한 바이트)하면 password-failed', async () => {
    const enc = await encryptBundleWithPassword(sample(), PW, IT);
    for (const pos of [5, 30, 40, enc.length - 1]) {
      const t = enc.slice();
      t[pos] ^= 1;
      expect(await codeOf(decryptBundleWithPassword(t, PW, IT))).toBe('password-failed');
    }
  });

  it('잘린 헤더·최소 길이 미달은 bad-header', async () => {
    const enc = await encryptBundleWithPassword(sample(), PW, IT);
    expect(await codeOf(decryptBundleWithPassword(enc.slice(0, 10), PW, IT))).toBe('bad-header');
    expect(await codeOf(decryptBundleWithPassword(enc.slice(0, 36 + 15), PW, IT))).toBe('bad-header');
    expect(await codeOf(decryptBundleWithPassword(new Uint8Array([...MAGIC2]), PW, IT))).toBe('bad-header');
  });

  it('반복 횟수 상한·하한 위반 헤더는 키 유도 전에 bad-header (기본 하한 적용)', async () => {
    const enc = await encryptBundleWithPassword(sample(), PW, IT);
    // 하한 미달: 주입 없이 복호화하면(기본 하한 100,000) 거부
    expect(await codeOf(decryptBundleWithPassword(enc, PW))).toBe('bad-header');
    expect(await codeOf(decryptBundleWithPassword(setIter(enc, PBKDF2_MIN_ITERATIONS - 1), PW))).toBe('bad-header');
    expect(await codeOf(decryptBundleWithPassword(setIter(enc, 0), PW))).toBe('bad-header');
    // 상한 초과: 탭이 멈추지 않게 즉시 거부(주입 하한을 낮춰도 상한은 그대로)
    const t0 = Date.now();
    expect(await codeOf(decryptBundleWithPassword(setIter(enc, PBKDF2_MAX_ITERATIONS + 1), PW, 1))).toBe('bad-header');
    expect(await codeOf(decryptBundleWithPassword(setIter(enc, 0xffffffff), PW, 1))).toBe('bad-header');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('헤더 반복 횟수를 바꾸면(범위 안이라도) 다른 키라 password-failed', async () => {
    const enc = await encryptBundleWithPassword(sample(), PW, IT);
    expect(await codeOf(decryptBundleWithPassword(setIter(enc, IT + 1), PW, IT))).toBe('password-failed');
  });

  it('같은 입력을 두 번 암호화하면 salt·iv·암호문이 모두 다르다', async () => {
    const a = await encryptBundleWithPassword(sample(), PW, IT);
    const b = await encryptBundleWithPassword(sample(), PW, IT);
    expect([...a.slice(4, 20)]).not.toEqual([...b.slice(4, 20)]); // salt
    expect([...a.slice(24, 36)]).not.toEqual([...b.slice(24, 36)]); // iv
    expect([...a.slice(36)]).not.toEqual([...b.slice(36)]); // 암호문
  });

  it('NFC/NFD 한글 비밀번호는 같은 비밀번호로 취급한다', async () => {
    const nfc = '한글비밀번호'.normalize('NFC');
    const nfd = '한글비밀번호'.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    const enc = await encryptBundleWithPassword(sample(), nfc, IT);
    expect([...(await decryptBundleWithPassword(enc, nfd, IT))]).toEqual([...sample()]);
    const enc2 = await encryptBundleWithPassword(sample(), nfd, IT);
    expect([...(await decryptBundleWithPassword(enc2, nfc, IT))]).toEqual([...sample()]);
  });

  it('MWB2 가 아니면 not-encrypted', async () => {
    expect(await codeOf(decryptBundleWithPassword(sample(), PW, IT))).toBe('not-encrypted');
  });
});

describe('형식 판별과 MWB1 구분', () => {
  it('detectFormat: MWB1 / MWB2 / 그 밖', async () => {
    expect(detectFormat(await encryptBundle(sample(), 'k'))).toBe('mwb1');
    expect(detectFormat(await encryptBundleWithPassword(sample(), PW, IT))).toBe('mwb2');
    expect(detectFormat(sample())).toBe('other');
    expect(detectFormat(new Uint8Array([0x4d, 0x57]))).toBe('other');
    expect(detectFormat(new Uint8Array())).toBe('other');
    expect(detectFormat(new Uint8Array([...MAGIC]))).toBe('mwb1');
  });

  it('isEncrypted 는 MWB1 만, isPasswordEncrypted 는 MWB2 만 참 (텔레그램 가드는 MWB1 만 통과)', async () => {
    const v1 = await encryptBundle(sample(), 'k');
    const v2 = await encryptBundleWithPassword(sample(), PW, IT);
    expect([isEncrypted(v1), isPasswordEncrypted(v1)]).toEqual([true, false]);
    expect([isEncrypted(v2), isPasswordEncrypted(v2)]).toEqual([false, true]);
  });

  it('MWB1 복호화에 MWB2 를 넣으면 not-encrypted, 반대도 같다', async () => {
    const v1 = await encryptBundle(sample(), 'k');
    const v2 = await encryptBundleWithPassword(sample(), PW, IT);
    expect(await codeOf(decryptBundle(v2, 'k'))).toBe('not-encrypted');
    expect(await codeOf(decryptBundleWithPassword(v1, PW, IT))).toBe('not-encrypted');
  });

  it('classifyBytes: MWB2 는 bundle-password, MWB1 은 bundle-encrypted 그대로', async () => {
    const v1 = await encryptBundle(sample(), 'k');
    const v2 = await encryptBundleWithPassword(sample(), PW, IT);
    expect(classifyBytes('x.mwb', v1)).toBe('bundle-encrypted');
    expect(classifyBytes('x.mwb', v2)).toBe('bundle-password');
    expect(classifyBytes('이름바뀜.bin', v2)).toBe('bundle-password');
  });
});

describe('비밀번호 입력 검증', () => {
  it('비어 있으면 막는다', () => {
    expect(checkPasswordPair('', '').blocked).toBeTruthy();
  });
  it('확인 입력이 다르면 막고 이유를 준다', () => {
    const r = checkPasswordPair('abcdefgh1', 'abcdefgh2');
    expect(r.blocked).toContain('다릅니다');
    expect(r.warning).toBeNull();
  });
  it('같으면 통과, 8자 미만이면 경고만 한다(막지 않음)', () => {
    expect(checkPasswordPair('abcdefgh', 'abcdefgh')).toEqual({ blocked: null, warning: null });
    const short = checkPasswordPair('abc', 'abc');
    expect(short.blocked).toBeNull();
    expect(short.warning).toBe('짧은 비밀번호는 쉽게 풀릴 수 있습니다');
    expect(PASSWORD_MIN_RECOMMENDED).toBe(8);
  });
  it('짧으면서 다를 때는 둘 다 알린다', () => {
    const r = checkPasswordPair('abc', 'abd');
    expect(r.blocked).toBeTruthy();
    expect(r.warning).toBeTruthy();
  });
  it('NFC/NFD 차이는 같은 비밀번호로 보고, 길이는 NFC 글자 수로 센다', () => {
    const r = checkPasswordPair('한글암호입니다'.normalize('NFC'), '한글암호입니다'.normalize('NFD'));
    expect(r.blocked).toBeNull();
    expect(r.warning).toBeTruthy(); // 7자
    expect(checkPasswordPair('한글암호입니다요'.normalize('NFD'), '한글암호입니다요').warning).toBeNull(); // 8자
  });
});
