// 동기화 키: 생성(128비트 → Crockford base32 26자), 정규화, 표기, 공간 id·인증 토큰·암호화 키 파생.
import { APP_ID, SyncCryptoError, type DerivedKeys } from './protocol';

// Crockford base32 (I, L, O, U 제외)
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_LEN = 26;
const VALID_RE = new RegExp(`^[${ALPHABET}]{${KEY_LEN}}$`);

function encodeBase32(bytes: Uint8Array): string {
  let value = 0;
  let bits = 0;
  let out = '';
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  // 남은 비트는 오른쪽을 0으로 채워 한 글자로 만든다(128비트 → 26자)
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** 새 동기화 키를 만든다. 4자씩 '-' 로 끊은 표기(예: ABCD-EFGH-…, 마지막 그룹은 2자) */
export function generateSyncKey(): string {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  return formatSyncKey(encodeBase32(raw));
}

/**
 * 사용자 입력을 정규형(하이픈 없는 대문자 26자)으로 바꾼다.
 * 공백·하이픈 제거, 대문자화, I·L → 1, O → 0. 알파벳 밖 문자나 길이가 26이 아니면 null.
 */
export function normalizeSyncKey(input: string): string | null {
  const s = input
    .replace(/[\s-]+/g, '')
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  return VALID_RE.test(s) ? s : null;
}

/** 정규형을 4자 그룹 표기로 바꾼다 */
export function formatSyncKey(normalized: string): string {
  return normalized.match(/.{1,4}/g)?.join('-') ?? '';
}

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/**
 * 동기화 키에서 공간 id·인증 토큰·암호화 키를 만든다.
 * syncKey 는 정규형이 아니어도 되지만(표기·공백 포함 가능) normalizeSyncKey 로 바꾼 뒤 쓴다. 잘못된 키면 SyncCryptoError('bad-key').
 */
export async function deriveKeys(syncKey: string, appId: string = APP_ID): Promise<DerivedKeys> {
  const normalized = normalizeSyncKey(syncKey);
  if (normalized === null) throw new SyncCryptoError('bad-key', '동기화 키 형식이 올바르지 않습니다');

  const spaceId = await sha256Hex(`space:${appId}:${normalized}`);
  const authToken = await sha256Hex(`auth:${appId}:${normalized}`);

  const ikm = await crypto.subtle.importKey('raw', enc.encode(normalized) as BufferSource, 'HKDF', false, ['deriveKey']);
  const encKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode('sync-v1') as BufferSource,
      info: enc.encode(`enc:${appId}`) as BufferSource,
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  return { spaceId, authToken, encKey };
}
