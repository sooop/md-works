// 번들 암호화(AES-256-GCM). 파일 형식: 'MWB1'(4바이트) + 무작위 iv(12바이트) + 암호문·태그.
//
// [중요] 키는 빌드 시 .env 의 VITE_BUNDLE_KEY 로 주입되어 코드(번들 JS·단일 HTML)에 그대로 포함된다.
// 앱 파일을 가진 사람은 누구나 복호화할 수 있으므로 이것은 보안이 아니라 '난독화' 수준이다.
// (전송 중 우연히 열람되는 것을 막는 정도로만 의미가 있다.) 저장소에는 키를 넣지 않는다 — .env 는 gitignore 대상.

export const MAGIC = new Uint8Array([0x4d, 0x57, 0x42, 0x31]); // 'MWB1'
const IV_LEN = 12;
const HEADER_LEN = MAGIC.length + IV_LEN;
const TAG_LEN = 16;

export type CryptoErrorCode =
  | 'no-key' | 'not-encrypted' | 'truncated' | 'auth-failed'
  // MWB2(비밀번호): 비밀번호가 필요함 / 비밀번호가 다르거나 손상됨(GCM 은 둘을 구분할 수 없다) / 헤더가 깨짐(반복 횟수 범위 밖 등)
  | 'password-required' | 'password-failed' | 'bad-header';

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

// ---- MWB2: 비밀번호 암호화 ----
// 'MWB2'(4) + salt(16) + PBKDF2 반복 횟수(uint32 BE, 4) + iv(12) + 암호문·태그. 키는 PBKDF2-HMAC-SHA256 → AES-256-GCM.
// 사용자가 직접 내려받는 번들에만 쓴다. 비밀번호·유도한 키는 어디에도 저장하지 않고(캐시 없음) 호출이 끝나면 참조를 버린다.
// 자동 백업·텔레그램은 위의 MWB1(빌드 키)을 그대로 쓴다 — 사람이 없는 자리에서는 비밀번호를 물을 수 없기 때문이다.

export const MAGIC2 = new Uint8Array([0x4d, 0x57, 0x42, 0x32]); // 'MWB2'
const SALT_LEN = 16;
const ITER_OFF = MAGIC2.length + SALT_LEN;
const IV2_OFF = ITER_OFF + 4;
const HEADER2_LEN = IV2_OFF + IV_LEN;

/** 새로 만들 때의 기본 반복 횟수(OWASP 2023 의 PBKDF2-HMAC-SHA256 권고) */
export const PBKDF2_ITERATIONS = 600_000;
/** 복호화 때 헤더 값의 허용 범위 — 조작된 헤더로 탭이 멈추거나(상한) 약한 키로 풀리게 하는(하한) 것을 막는다 */
export const PBKDF2_MIN_ITERATIONS = 100_000;
export const PBKDF2_MAX_ITERATIONS = 10_000_000;

/** 파일 앞 4바이트로 본 형식: MWB1(빌드 키) / MWB2(비밀번호) / 그 밖(평문 zip 등) */
export type BundleFormat = 'mwb1' | 'mwb2' | 'other';

const hasMagic = (bytes: Uint8Array, magic: Uint8Array) => {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic[i]) return false;
  return true;
};

export function detectFormat(bytes: Uint8Array): BundleFormat {
  if (hasMagic(bytes, MAGIC)) return 'mwb1';
  if (hasMagic(bytes, MAGIC2)) return 'mwb2';
  return 'other';
}

/** 비밀번호로 암호화된 번들(MWB2)인가 */
export const isPasswordEncrypted = (bytes: Uint8Array): boolean => hasMagic(bytes, MAGIC2);

/** 같은 비밀번호가 입력 방식(한글 조합 차이)으로 달라지지 않도록 NFC 로 맞춘 UTF-8 */
export function passwordBytes(password: string): Uint8Array {
  return new TextEncoder().encode(password.normalize('NFC'));
}

async function derivePasswordKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', passwordBytes(password) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

function requirePassword(password: string): void {
  if (!password) throw new BundleCryptoError('password-required', '비밀번호가 필요합니다');
}

/** 평문 번들을 비밀번호로 암호화한다. iterations 는 테스트용 주입(기본 600,000) */
export async function encryptBundleWithPassword(bytes: Uint8Array, password: string, iterations: number = PBKDF2_ITERATIONS): Promise<Uint8Array> {
  requirePassword(password);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_MAX_ITERATIONS) throw new RangeError('반복 횟수가 올바르지 않습니다');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ck = await derivePasswordKey(password, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ck, bytes as BufferSource));
  const out = new Uint8Array(HEADER2_LEN + ct.length);
  out.set(MAGIC2, 0);
  out.set(salt, MAGIC2.length);
  new DataView(out.buffer).setUint32(ITER_OFF, iterations, false);
  out.set(iv, IV2_OFF);
  out.set(ct, HEADER2_LEN);
  return out;
}

/**
 * MWB2 를 복호화한다. 반복 횟수는 파일 헤더의 값을 쓰되 [minIterations, 10,000,000] 밖이면 거부한다(minIterations 는 테스트 주입).
 * 오류: not-encrypted(MWB2 아님) / bad-header(헤더가 잘렸거나 반복 횟수가 범위 밖) / password-required / password-failed.
 * AES-GCM 은 '비밀번호가 다름'과 '내용이 손상됨'을 구별할 수 없어 둘은 같은 password-failed 로 보고한다.
 * 오류 메시지에는 비밀번호·키를 넣지 않는다.
 */
export async function decryptBundleWithPassword(bytes: Uint8Array, password: string, minIterations: number = PBKDF2_MIN_ITERATIONS): Promise<Uint8Array> {
  if (!isPasswordEncrypted(bytes)) throw new BundleCryptoError('not-encrypted', '비밀번호로 암호화된 번들(.mwb) 형식이 아닙니다');
  if (bytes.length < HEADER2_LEN + TAG_LEN) throw new BundleCryptoError('bad-header', '파일이 손상되었습니다 (헤더가 잘려 있습니다)');
  const iterations = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(ITER_OFF, false);
  if (iterations < minIterations || iterations > PBKDF2_MAX_ITERATIONS) throw new BundleCryptoError('bad-header', '파일이 손상되었습니다 (헤더 값이 올바르지 않습니다)');
  requirePassword(password);
  const salt = bytes.slice(MAGIC2.length, ITER_OFF);
  const iv = bytes.slice(IV2_OFF, HEADER2_LEN);
  const ck = await derivePasswordKey(password, salt, iterations);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, ck, bytes.slice(HEADER2_LEN) as BufferSource));
  } catch {
    throw new BundleCryptoError('password-failed', '비밀번호가 맞지 않거나 파일이 손상되었습니다');
  }
}
