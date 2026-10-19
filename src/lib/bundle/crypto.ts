// 번들 암호화(AES-256-GCM). 파일 형식: 'MWB1'(4바이트) + 무작위 iv(12바이트) + 암호문·태그.
//
// [중요] 키는 빌드 시 .env 의 VITE_BUNDLE_KEY 로 주입되어 코드(번들 JS·단일 HTML)에 그대로 포함된다.
// 앱 파일을 가진 사람은 누구나 복호화할 수 있으므로 이것은 보안이 아니라 '난독화' 수준이다.
// (전송 중 우연히 열람되는 것을 막는 정도로만 의미가 있다.) 저장소에는 키를 넣지 않는다 — .env 는 gitignore 대상.

export const MAGIC = new Uint8Array([0x4d, 0x57, 0x42, 0x31]); // 'MWB1'
const IV_LEN = 12;
const HEADER_LEN = MAGIC.length + IV_LEN;
const TAG_LEN = 16;

export type CryptoErrorCode = 'no-key' | 'not-encrypted' | 'truncated' | 'auth-failed';

export class BundleCryptoError extends Error {
  constructor(readonly code: CryptoErrorCode, message: string) {
    super(message);
    this.name = 'BundleCryptoError';
  }
}

/** 빌드 시 주입된 키 문자열(없으면 빈 문자열) */
export function bundleKey(): string {
  return String(import.meta.env?.VITE_BUNDLE_KEY ?? '').trim();
}

/** 암호화 가능 여부 — 키가 비어 있으면 false (이때 텔레그램 올리기는 거부하고 내보내기는 평문 zip 만 허용) */
export function hasBundleKey(key: string = bundleKey()): boolean {
  return key.length > 0;
}

/** 매직 바이트로 암호화된 번들(.mwb)인지 판별한다 */
export function isEncrypted(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length) return false;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) return false;
  return true;
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function deriveKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(secret))
      .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
    keyCache.set(secret, k);
  }
  return k;
}

function requireKey(key: string): string {
  if (!hasBundleKey(key)) {
    throw new BundleCryptoError('no-key', '암호화 키(VITE_BUNDLE_KEY)가 이 빌드에 설정되지 않았습니다');
  }
  return key;
}

/** 평문 번들(zip 바이트)을 암호화한다. key 는 테스트용 재정의 */
export async function encryptBundle(bytes: Uint8Array, key: string = bundleKey()): Promise<Uint8Array> {
  const ck = await deriveKey(requireKey(key));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ck, bytes as BufferSource));
  const out = new Uint8Array(HEADER_LEN + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(ct, HEADER_LEN);
  return out;
}

/**
 * .mwb 를 복호화한다. 오류는 code 로 구분한다:
 * no-key(이 빌드에 키 없음) / not-encrypted(형식 아님) / truncated(잘림) / auth-failed(키가 다르거나 변조됨).
 * AES-GCM 은 '키가 다름'과 '내용이 변조됨'을 구별할 수 없어 둘은 같은 auth-failed 로 보고한다.
 */
export async function decryptBundle(bytes: Uint8Array, key: string = bundleKey()): Promise<Uint8Array> {
  if (!isEncrypted(bytes)) throw new BundleCryptoError('not-encrypted', '암호화된 번들(.mwb) 형식이 아닙니다');
  if (bytes.length < HEADER_LEN + TAG_LEN) throw new BundleCryptoError('truncated', '번들 파일이 잘려 있습니다');
  const ck = await deriveKey(requireKey(key));
  const iv = bytes.slice(MAGIC.length, HEADER_LEN);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, ck, bytes.slice(HEADER_LEN) as BufferSource));
  } catch {
    throw new BundleCryptoError('auth-failed', '복호화에 실패했습니다 — 다른 키로 만든 파일이거나 내용이 변조되었습니다');
  }
}
