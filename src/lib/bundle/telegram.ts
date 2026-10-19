// 텔레그램 Bot API 올리기. 쓰는 메서드는 getMe(토큰 확인), sendMessage(연결 테스트), sendDocument(번들 올리기)뿐이다.
// 가져오기는 자동화하지 않는다 — 사용자가 텔레그램에서 파일을 받아 앱에 끌어다 놓는다(봇 다운로드 한도 20MB).
//
// [미검증] 브라우저에서 api.telegram.org 를 직접 호출하는 CORS 동작은 이 개발 환경에서 확인하지 못했다.
// 코드는 fetch 를 주입받아 모의로 테스트한다. 실제 봇·네트워크에서의 동작은 사용자가 직접 확인해야 한다.
//
// 토큰·chat_id·자동 올리기 설정은 localStorage 'works.telegram' 에만 저장하고 번들·내보내기에는 절대 넣지 않는다.
import { isEncrypted } from './crypto';
import { CHUNK_LIMIT, partCaption, partFileName, splitBytes } from './backupLogic';

export const TG_UPLOAD_LIMIT = 50 * 1024 * 1024; // Bot API sendDocument 한도
const API = 'https://api.telegram.org';
const STORAGE_KEY = 'works.telegram';

export interface TelegramSettings {
  token: string;
  chatId: string;
  /** 자동 올리기 사용 여부 */
  auto: boolean;
  /** 자동 올리기 간격(분). 최소 MIN_AUTO_MINUTES */
  intervalMin: number;
}
export const MIN_AUTO_MINUTES = 5;
export const DEFAULT_AUTO_MINUTES = 30;

export const defaultTelegram = (): TelegramSettings => ({ token: '', chatId: '', auto: false, intervalMin: DEFAULT_AUTO_MINUTES });

export type TelegramErrorKind = 'config' | 'plaintext' | 'too-large' | 'network' | 'api';
export class TelegramError extends Error {
  constructor(readonly kind: TelegramErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = 'TelegramError';
  }
}

type FetchFn = typeof fetch;

// ---- 설정 저장(localStorage 'works.telegram') ----
export function loadTelegram(storage?: Pick<Storage, 'getItem'>): TelegramSettings {
  const d = defaultTelegram();
  try {
    const j = JSON.parse((storage ?? localStorage).getItem(STORAGE_KEY) ?? '{}');
    return {
      token: typeof j.token === 'string' ? j.token : d.token,
      chatId: typeof j.chatId === 'string' ? j.chatId : d.chatId,
      auto: j.auto === true,
      intervalMin: typeof j.intervalMin === 'number' && j.intervalMin >= MIN_AUTO_MINUTES ? Math.floor(j.intervalMin) : d.intervalMin,
    };
  } catch {
    return d;
  }
}
export function saveTelegram(s: TelegramSettings, storage?: Pick<Storage, 'setItem'>) {
  try { (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* 저장소를 못 쓰는 환경 */ }
}

// ---- 마스킹: 오류 메시지·로그에 토큰이 새지 않게 한다 ----
/** URL 속 `bot<토큰>` 과 토큰 문자열 자체를 가린다 */
export function maskSecrets(text: string, token = ''): string {
  let out = text.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot***');
  out = out.replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '***');
  if (token) out = out.split(token).join('***');
  return out;
}

function checkConfig(cfg: Pick<TelegramSettings, 'token' | 'chatId'>, needChat: boolean) {
  if (!cfg.token.trim()) throw new TelegramError('config', '봇 토큰을 입력하세요');
  if (needChat && !cfg.chatId.trim()) throw new TelegramError('config', 'chat_id 를 입력하세요');
}

/** 파일명 md-works-YYYYMMDD-HHmm.mwb (로컬 시각) */
export function bundleFileName(date: Date = new Date(), ext = 'mwb'): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `md-works-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.${ext}`;
}

const fmtMB = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;

function mapApiError(status: number, description: string, retryAfter?: number): string {
  const d = description || '';
  if (status === 401) return '토큰이 올바르지 않습니다 (401)';
  if (status === 404) return '토큰이 올바르지 않거나 봇이 없습니다 (404)';
  if (status === 403) return '봇이 차단되었거나 이 채팅에 보낼 권한이 없습니다 (403). 봇에게 먼저 말을 걸어 보세요';
  if (status === 429) return `요청이 너무 많습니다. ${retryAfter ?? '잠시'}초 뒤에 다시 시도하세요 (429)`;
  if (status === 413) return `파일이 텔레그램 한도(${fmtMB(TG_UPLOAD_LIMIT)})를 넘습니다 (413)`;
  if (status === 400 && /chat not found/i.test(d)) return 'chat_id 를 찾을 수 없습니다. 값을 확인하고 봇에게 먼저 말을 걸어 보세요 (400)';
  return `텔레그램 오류 (${status})${d ? `: ${d}` : ''}`;
}

async function call<T>(cfg: { token: string }, method: string, init: RequestInit | undefined, fetchFn: FetchFn): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(`${API}/bot${cfg.token.trim()}/${method}`, init);
  } catch (e) {
    // 브라우저는 CORS 차단과 오프라인을 같은 TypeError 로 알린다
    const why = maskSecrets(e instanceof Error ? e.message : String(e), cfg.token);
    throw new TelegramError('network', `텔레그램에 연결하지 못했습니다 (네트워크 오류 또는 브라우저 CORS 차단): ${why}`);
  }
  let body: { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } } = {};
  try { body = await res.json(); } catch { /* JSON 이 아닌 응답 */ }
  if (!res.ok || body.ok === false) {
    const msg = mapApiError(res.status, body.description ?? '', body.parameters?.retry_after);
    throw new TelegramError('api', maskSecrets(msg, cfg.token), res.status);
  }
  return body.result as T;
}

/** 토큰 검증 — 봇 사용자 이름을 돌려준다 */
export async function getMe(cfg: { token: string }, fetchFn: FetchFn = fetch): Promise<{ id: number; username?: string; first_name?: string }> {
  checkConfig({ token: cfg.token, chatId: '' }, false);
  return call(cfg, 'getMe', undefined, fetchFn);
}

/** 연결 테스트용 한 줄 메시지 */
export async function sendMessage(cfg: Pick<TelegramSettings, 'token' | 'chatId'>, text: string, fetchFn: FetchFn = fetch): Promise<void> {
  checkConfig(cfg, true);
  const form = new FormData();
  form.append('chat_id', cfg.chatId.trim());
  form.append('text', text);
  await call(cfg, 'sendMessage', { method: 'POST', body: form }, fetchFn);
}

/**
 * 암호화된 번들(.mwb)을 sendDocument 로 올린다.
 * 평문(암호화되지 않은) 바이트는 거부한다 — 평문 업로드 금지. 50MB 초과도 전송 전에 거부한다.
 */
export async function sendDocument(
  cfg: Pick<TelegramSettings, 'token' | 'chatId'>,
  bytes: Uint8Array,
  opts: { filename?: string; caption?: string } = {},
  fetchFn: FetchFn = fetch,
): Promise<{ filename: string; size: number }> {
  checkConfig(cfg, true);
  if (!isEncrypted(bytes)) throw new TelegramError('plaintext', '암호화되지 않은 번들은 텔레그램에 올리지 않습니다');
  if (bytes.length > TG_UPLOAD_LIMIT) {
    throw new TelegramError('too-large', `번들 크기 ${fmtMB(bytes.length)} 가 텔레그램 업로드 한도 ${fmtMB(TG_UPLOAD_LIMIT)} 를 넘습니다`);
  }
  const filename = opts.filename ?? bundleFileName();
  const form = new FormData();
  form.append('chat_id', cfg.chatId.trim());
  if (opts.caption) form.append('caption', opts.caption);
  form.append('document', new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), filename);
  await call(cfg, 'sendDocument', { method: 'POST', body: form }, fetchFn);
  return { filename, size: bytes.length };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 전체 바이트의 SHA-256 앞 12자(hex) — 조각 caption 에 넣어 사람이 대조할 수 있게 한다 */
export async function sha256Prefix12(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...d.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SendBundleResult {
  /** 올린 파일명들(단일이면 1개) */
  filenames: string[];
  size: number;
  parts: number;
}

/**
 * 암호화된 번들을 올린다. limit(기본 45MB) 이하면 지금처럼 단일 파일, 넘으면 `.mwb.001…` 조각으로 순서대로 올린다.
 * 조각은 원본 바이트를 헤더 없이 자른 것이라 이어 붙이면(cat) 복원된다. 무결성은 복호화 시 GCM 태그가 보증한다.
 * 조각 업로드 실패는 1회 재시도 후 중단하며, 어디까지 올라갔는지 오류에 적는다(이어서 올리기는 없다).
 */
export async function sendBundle(
  cfg: Pick<TelegramSettings, 'token' | 'chatId'>,
  bytes: Uint8Array,
  opts: { filename?: string; caption?: string; limit?: number; retryDelayMs?: number; onProgress?: (done: number, total: number) => void } = {},
  fetchFn: FetchFn = fetch,
): Promise<SendBundleResult> {
  const limit = opts.limit ?? CHUNK_LIMIT;
  const filename = opts.filename ?? bundleFileName();
  checkConfig(cfg, true);
  if (!isEncrypted(bytes)) throw new TelegramError('plaintext', '암호화되지 않은 번들은 텔레그램에 올리지 않습니다');
  if (bytes.length <= limit) {
    opts.onProgress?.(0, 1);
    const r = await sendDocument(cfg, bytes, { filename, caption: opts.caption }, fetchFn);
    opts.onProgress?.(1, 1);
    return { filenames: [r.filename], size: r.size, parts: 1 };
  }
  let chunks: Uint8Array[];
  try {
    chunks = splitBytes(bytes, limit);
  } catch (e) {
    throw new TelegramError('too-large', e instanceof Error ? e.message : String(e));
  }
  const total = chunks.length;
  const sha = await sha256Prefix12(bytes);
  const filenames: string[] = [];
  opts.onProgress?.(0, total);
  for (let i = 0; i < total; i++) {
    const name = partFileName(filename, i + 1);
    const caption = partCaption(opts.caption ?? '', i + 1, total, bytes.length, sha);
    // 조각은 암호화 바이트의 일부라 매직이 없다 — 평문 검사는 위에서 전체에 대해 했으므로 call 을 직접 쓴다
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const form = new FormData();
        form.append('chat_id', cfg.chatId.trim());
        form.append('caption', caption);
        form.append('document', new Blob([chunks[i] as BlobPart], { type: 'application/octet-stream' }), name);
        await call(cfg, 'sendDocument', { method: 'POST', body: form }, fetchFn);
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        if (attempt === 0) await sleep(opts.retryDelayMs ?? 1500);
      }
    }
    if (lastErr) {
      const base = lastErr instanceof TelegramError ? lastErr : new TelegramError('network', String(lastErr));
      const where = i === 0 ? '첫 조각부터 실패했습니다' : `${i}/${total}개 조각(${filenames[0]} … ${filenames[i - 1]})까지만 올라갔습니다`;
      throw new TelegramError(base.kind, maskSecrets(`조각 ${i + 1}/${total} 업로드 실패 — ${where}. ${base.message}`, cfg.token), base.status);
    }
    filenames.push(name);
    opts.onProgress?.(i + 1, total);
  }
  return { filenames, size: bytes.length, parts: total };
}
