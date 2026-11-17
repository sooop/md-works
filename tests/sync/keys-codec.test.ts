import { describe, it, expect } from 'vitest';
import { createHash, createDecipheriv, hkdfSync } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { generateSyncKey, normalizeSyncKey, formatSyncKey, deriveKeys } from '../../src/lib/sync/keys';
import { createCodec } from '../../src/lib/sync/codec';
import { SyncCryptoError, type SyncPlain } from '../../src/lib/sync/protocol';

const KEY = '0123456789ABCDEFGHJKMNPQRS';
const APP = 'md-works';
const ALPHA = /^[0-9A-HJKMNP-TV-Z]+$/;

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof SyncCryptoError ? e.reason : `other:${e}`;
  }
  return 'none';
}

async function deriveEncKey(syncKey = KEY, appId = APP): Promise<CryptoKey> {
  return (await deriveKeys(syncKey, appId)).encKey;
}

const plainDoc = (name: string, content: string): SyncPlain => ({
  v: 1,
  kind: 'doc',
  updatedAt: 1_700_000_000_000,
  data: { name, content },
});

describe('동기화 키 생성·정규화', () => {
  it('생성 키는 26자 Crockford 문자이고 4자 그룹 표기다(마지막 그룹 2자)', () => {
    for (let i = 0; i < 20; i++) {
      const k = generateSyncKey();
      expect(k).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}-[0-9A-HJKMNP-TV-Z]{2}$/);
      expect(k.replace(/-/g, '')).toHaveLength(26);
      expect(normalizeSyncKey(k)).toHaveLength(26);
    }
  });

  it('생성 키는 매번 다르다', () => {
    const set = new Set(Array.from({ length: 50 }, () => generateSyncKey()));
    expect(set.size).toBe(50);
  });

  it('normalize → format → normalize 왕복', () => {
    const norm = KEY;
    const shown = formatSyncKey(norm);
    expect(shown).toBe('0123-4567-89AB-CDEF-GHJK-MNPQ-RS');
    expect(normalizeSyncKey(shown)).toBe(norm);
    expect(normalizeSyncKey(generateSyncKey())).not.toBeNull();
  });

  it('공백·하이픈 제거와 소문자 대문자화', () => {
    expect(normalizeSyncKey('  0123 4567-89abcdef-ghjk mnpq rs ')).toBe(KEY);
  });

  it('혼동 문자: I·L → 1, O → 0', () => {
    // 0 과 O, 1 과 I·L 을 섞어도 같은 정규형
    const confusing = 'OIL0-ILO1-OILO-ghjk-mnpq-rstv-wx';
    expect(normalizeSyncKey(confusing)).toBe('0110' + '1101' + '0110' + 'GHJKMNPQRSTVWX');
  });

  it('잘못된 입력은 null: 길이 불일치, 알파벳 밖 문자(U 등), 빈 문자열', () => {
    expect(normalizeSyncKey('')).toBeNull();
    expect(normalizeSyncKey(KEY.slice(0, 25))).toBeNull();
    expect(normalizeSyncKey(KEY + '0')).toBeNull();
    expect(normalizeSyncKey(KEY.slice(0, 25) + 'U')).toBeNull();
    expect(normalizeSyncKey(KEY.slice(0, 25) + '!')).toBeNull();
    expect(normalizeSyncKey('가'.repeat(26))).toBeNull();
  });
});

describe('키 파생', () => {
  it('고정 벡터: spaceId·authToken 이 node:crypto 의 SHA-256 과 일치한다', async () => {
    const keys = await deriveKeys(KEY, APP);
    const refSpace = createHash('sha256').update(`space:${APP}:${KEY}`, 'utf8').digest('hex');
    const refAuth = createHash('sha256').update(`auth:${APP}:${KEY}`, 'utf8').digest('hex');
    expect(keys.spaceId).toBe('a953126f06a3774bd7aac60e51b2b17b40131c6c0ac01e9279b97d0683eaab32');
    expect(keys.authToken).toBe('6f2d6602ee725dc5d65502452e7ba28f35ebf4b3f20d103f3802b96d226eca38');
    expect(keys.spaceId).toBe(refSpace);
    expect(keys.authToken).toBe(refAuth);
  });

  it('표기 형태(하이픈 포함) 입력도 같은 결과', async () => {
    const a = await deriveKeys(formatSyncKey(KEY), APP);
    const b = await deriveKeys(KEY, APP);
    expect(a.spaceId).toBe(b.spaceId);
    expect(a.authToken).toBe(b.authToken);
  });

  it('잘못된 키는 bad-key', async () => {
    expect(await codeOf(deriveKeys('XYZ', APP))).toBe('bad-key');
  });

  it('서로 다른 appId 또는 키는 다른 spaceId', async () => {
    const base = (await deriveKeys(KEY, APP)).spaceId;
    expect((await deriveKeys(KEY, 'other-app')).spaceId).not.toBe(base);
    expect((await deriveKeys('0123456789ABCDEFGHJKMNPQRT', APP)).spaceId).not.toBe(base);
  });

  it('encKey 는 AES-GCM 256, 비추출, encrypt/decrypt 용도', async () => {
    const { encKey } = await deriveKeys(KEY, APP);
    expect(encKey.algorithm.name).toBe('AES-GCM');
    expect((encKey.algorithm as AesKeyAlgorithm).length).toBe(256);
    expect(encKey.extractable).toBe(false);
    expect(encKey.usages.sort()).toEqual(['decrypt', 'encrypt']);
  });

  it('encKey 는 node:crypto 의 HKDF 와 같은 키다(교차 검증)', async () => {
    const refKey = Buffer.from(hkdfSync('sha256', Buffer.from(KEY, 'utf8'), Buffer.from('sync-v1', 'utf8'), Buffer.from(`enc:${APP}`, 'utf8'), 32));
    const codec = createCodec(await deriveEncKey());
    const blob = await codec.encrypt('d1', plainDoc('a', '교차 검증'));
    const raw = Buffer.from(blob, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(raw.length - 16);
    const ct = raw.subarray(12, raw.length - 16);
    const dec = createDecipheriv('aes-256-gcm', refKey, iv);
    dec.setAAD(Buffer.from('d1', 'utf8'));
    dec.setAuthTag(tag);
    const deflated = Buffer.concat([dec.update(ct), dec.final()]);
    const json = inflateRawSync(deflated).toString('utf8');
    expect(JSON.parse(json)).toEqual(plainDoc('a', '교차 검증'));
  });
});

describe('항목 코덱', () => {
  it('왕복: 한글·이모지·긴 본문(300KB) 포함', async () => {
    const codec = createCodec(await deriveEncKey());
    const long = '가나다라 마바사 🎉 abc\n'.repeat(Math.ceil(300_000 / 24));
    const cases: SyncPlain[] = [
      plainDoc('글/한글 제목 🙂', '본문 **굵게** 이모지 😀👍 — 끝'),
      plainDoc('긴 글', long),
      { v: 1, kind: 'thread', updatedAt: 5, data: { docName: '글', anchor: { quote: 'q', prefix: 'p', suffix: 's' }, messages: [{ id: 'm1', text: '안녕 👋', ts: 1 }], resolved: false, createdAt: 1 } },
      { v: 1, kind: 'doc', updatedAt: 7, data: null },
    ];
    for (const c of cases) {
      const blob = await codec.encrypt('item-1', c);
      expect(await codec.decrypt('item-1', blob)).toEqual(c);
    }
  });

  it('같은 평문을 두 번 암호화하면 blob 이 다르다(IV 무작위)', async () => {
    const codec = createCodec(await deriveEncKey());
    const p = plainDoc('같음', '같은 본문');
    const a = await codec.encrypt('x', p);
    const b = await codec.encrypt('x', p);
    expect(a).not.toBe(b);
  });

  it('다른 id 로 복호화하면 bad-key (AAD)', async () => {
    const codec = createCodec(await deriveEncKey());
    const blob = await codec.encrypt('id-A', plainDoc('a', 'b'));
    expect(await codeOf(codec.decrypt('id-B', blob))).toBe('bad-key');
  });

  it('다른 키로 복호화하면 bad-key', async () => {
    const enc = createCodec(await deriveEncKey());
    const other = createCodec(await deriveEncKey('0123456789ABCDEFGHJKMNPQRT'));
    const blob = await enc.encrypt('id', plainDoc('a', 'b'));
    expect(await codeOf(other.decrypt('id', blob))).toBe('bad-key');
  });

  it('blob 한 바이트 변조하면 bad-key', async () => {
    const codec = createCodec(await deriveEncKey());
    const blob = await codec.encrypt('id', plainDoc('a', '변조 테스트'));
    const raw = Buffer.from(blob, 'base64');
    raw[raw.length >> 1] ^= 0x01;
    expect(await codeOf(codec.decrypt('id', raw.toString('base64')))).toBe('bad-key');
  });

  it('잘린 blob 은 bad-format', async () => {
    const codec = createCodec(await deriveEncKey());
    const blob = await codec.encrypt('id', plainDoc('a', 'b'));
    // 28바이트 미만(IV 12 + 태그 16)
    expect(await codeOf(codec.decrypt('id', Buffer.from('short').toString('base64')))).toBe('bad-format');
    expect(await codeOf(codec.decrypt('id', ''))).toBe('bad-format');
    // 길이 기준 미달로 잘린 base64
    expect(await codeOf(codec.decrypt('id', blob.slice(0, 36)))).toBe('bad-format');
    // 잘린 base64(4의 배수가 아님)
    expect(await codeOf(codec.decrypt('id', blob.slice(0, blob.length - 1)))).toBe('bad-format');
  });

  it('base64 가 아닌 문자열은 bad-format', async () => {
    const codec = createCodec(await deriveEncKey());
    expect(await codeOf(codec.decrypt('id', '!!!!'.repeat(10)))).toBe('bad-format');
  });

  it('한글 본문은 압축으로 평문 JSON 대비 크게 줄어든다', async () => {
    const codec = createCodec(await deriveEncKey());
    const body = '한글 문단을 반복해서 쓴 본문입니다. 마크다운 목록과 표도 있습니다.\n'.repeat(2000);
    const p = plainDoc('압축', body);
    const plainLen = new TextEncoder().encode(JSON.stringify(p)).length;
    const blob = await codec.encrypt('z', p);
    const blobBytes = Buffer.from(blob, 'base64').length;
    expect(blobBytes).toBeLessThan(plainLen / 5);
  });
});
