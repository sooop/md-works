// 항목 암호화 코덱: JSON → UTF-8 → deflate(fflate) → AES-GCM(IV 12바이트, AAD = 항목 id) → base64(IV ‖ 암호문+태그).
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import { SyncCryptoError, type SyncCodec, type SyncPlain } from './protocol';

const IV_LEN = 12;
const TAG_LEN = 16;
const MIN_LEN = IV_LEN + TAG_LEN;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

// compress.ts 와 같은 방식: 인자 개수 한도를 피하려고 조각으로 나눈다
function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string): Uint8Array | null {
  if (b64.length % 4 !== 0 || !B64_RE.test(b64)) return null;
  let s: string;
  try {
    s = atob(b64);
  } catch {
    return null;
  }
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function createCodec(encKey: CryptoKey): SyncCodec {
  return {
    async encrypt(id: string, plain: SyncPlain): Promise<string> {
      const deflated = deflateSync(strToU8(JSON.stringify(plain)), { level: 6 });
      const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
      const ct = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: iv as BufferSource, additionalData: strToU8(id) as BufferSource },
          encKey,
          deflated as BufferSource,
        ),
      );
      const out = new Uint8Array(IV_LEN + ct.length);
      out.set(iv, 0);
      out.set(ct, IV_LEN);
      return toB64(out);
    },

    async decrypt(id: string, blob: string): Promise<SyncPlain> {
      const bytes = fromB64(blob);
      if (bytes === null || bytes.length < MIN_LEN) {
        throw new SyncCryptoError('bad-format', '암호문 형식이 올바르지 않습니다');
      }
      const iv = bytes.slice(0, IV_LEN);
      const ct = bytes.slice(IV_LEN);

      let deflated: ArrayBuffer;
      try {
        deflated = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as BufferSource, additionalData: strToU8(id) as BufferSource },
          encKey,
          ct as BufferSource,
        );
      } catch {
        throw new SyncCryptoError('bad-key', '복호화에 실패했습니다 — 다른 키이거나 내용이 변조되었습니다');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(strFromU8(inflateSync(new Uint8Array(deflated))));
      } catch {
        throw new SyncCryptoError('bad-format', '암호문 내용을 풀 수 없습니다');
      }
      if (typeof parsed !== 'object' || parsed === null || (parsed as { v?: unknown }).v !== 1) {
        throw new SyncCryptoError('bad-format', '지원하지 않는 평문 버전입니다');
      }
      return parsed as SyncPlain;
    },
  };
}
