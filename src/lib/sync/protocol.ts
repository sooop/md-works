// 동기화 공용 계약. 서버(sync-worker)·클라이언트 모듈(keys/codec/engine/adapter/state/UI)이 모두 이 파일의 형식을 따른다.
// 설계: .docs/sync-plan.md. 이 파일은 계약이므로 담당자가 임의로 고치지 않는다(필요하면 보고).

// ───────── 한도(서버 wrangler.toml [vars] 와 같은 값) ─────────
export const LIMITS = {
  MAX_ITEM_BYTES: 262_144, // blob 문자열 길이
  MAX_ITEMS_PER_SPACE: 1000,
  MAX_SPACE_BYTES: 5_242_880,
  MAX_SPACES: 60,
  MAX_DAILY_WRITES: 300,
  TOMBSTONE_DAYS: 30,
  MAX_BODY_BYTES: 524_288, // 요청 본문 상한
  SOFT_BODY_BYTES: 400_000, // 클라이언트가 나눠 보내는 기준
  MAX_PUSH_ITEMS: 20,
  PULL_MAX_ITEMS: 50,
  PULL_MAX_BYTES: 262_144,
} as const;

export const ITEM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const APP_ID_RE = /^[a-z0-9-]{1,32}$/;
/** md-works 의 appId */
export const APP_ID = 'md-works';

// ───────── 와이어 형식 (POST /v1/sync) ─────────
export interface PushItem { id: string; baseRev: number; deleted: boolean; blob: string }
export interface SyncRequest { cursor: number; push: PushItem[] }
export interface RemoteItem { id: string; rev: number; deleted: boolean; blob: string }
export interface SyncUsage { items: number; bytes: number; dailyWrites: number }
export interface SyncResponse {
  cursor: number;
  hasMore: boolean;
  accepted: { id: string; rev: number }[];
  conflicts: RemoteItem[];
  changes: RemoteItem[];
  usage: SyncUsage;
  /** 요청 cursor 가 서버의 purged_seq 보다 작았다. 서버는 cursor 0 으로 보고 changes 를 돌려주고 push 는 무시했다 */
  resyncRequired?: boolean;
}
export type SyncErrorCode =
  | 'bad_request' // 400 (본문 JSON·push 항목 형식 오류)
  | 'unauthorized' // 401
  | 'forbidden' // 403 (초대 코드 오류·허용되지 않은 앱·공간 수 초과)
  | 'body_too_large' // 413
  | 'item_too_large' | 'item_limit' | 'space_full' // 422
  | 'daily_write_limit' // 429
  | 'unavailable'; // 503 (Retry-After)
export interface SyncErrorBody { error: SyncErrorCode }

// 요청 헤더: X-App-Id, X-Space-Id, Authorization: Bearer <authToken>, X-Invite-Code(새 공간 첫 요청만)

// ───────── 평문(암호화 전) ─────────
export type ItemKind = 'doc' | 'snippet' | 'thread';
/** 암호화되는 평문. blob = base64(IV ‖ AES-GCM(deflate(JSON.stringify(SyncPlain)), AAD = 항목 id)) */
export interface SyncPlain {
  v: 1;
  kind: ItemKind;
  updatedAt: number;
  /** 삭제된 항목은 data 가 null */
  data: DocData | SnippetData | ThreadData | null;
}
/** 글: 이름은 폴더 포함 전체 경로(예: "폴더/글"). 평문 안에만 있다 */
export interface DocData { name: string; content: string }
/** 글감: 글 참조는 docKey 가 아니라 글 이름(소문자 비교용 원문)으로 보낸다 */
export interface SnippetData {
  body: string;
  color: string;
  createdAt: number;
  source?: { url: string; title?: string; excerpt?: string };
  attachedDocNames: string[];
  trashedFromNames?: string[];
  /** 키 = 글 이름 */
  ordersByName?: Record<string, number>;
  deletedAt?: number;
  purged?: boolean;
}
export interface ThreadData {
  docName: string;
  anchor: { quote: string; prefix: string; suffix: string };
  messages: { id: string; text: string; ts: number }[];
  resolved: boolean;
  createdAt: number;
  deletedAt?: number;
}

// ───────── 항목 id 규칙 (adapter.ts 가 구현) ─────────
// 글: 'd' + contentHash(name.toLowerCase())   (27자)
// 글감: 's-' + id, 스레드: 't-' + id           (총 길이 62 초과 시 접두 + contentHash(id))

// ───────── 키·설정 ─────────
export interface SyncConfig {
  /** 예: https://md-works-sync.<하위도메인>.workers.dev (끝 슬래시 없음) */
  workerUrl: string;
  /** 사용자에게 보이는 4자 그룹 표기("ABCD-EFGH-…") */
  syncKey: string;
  /** 새 공간을 만드는 첫 요청에만 쓴다. 성공하면 지운다 */
  inviteCode?: string;
}
export interface DerivedKeys {
  spaceId: string; // hex(SHA-256("space:"+appId+":"+syncKey))
  authToken: string; // hex(SHA-256("auth:"+appId+":"+syncKey))
  encKey: CryptoKey; // HKDF-SHA-256(syncKey, salt "sync-v1", info "enc:"+appId) → AES-GCM 256
}

// ───────── 코덱 (codec.ts, 담당 B) ─────────
export interface SyncCodec {
  /** 평문 → blob(base64). id 는 AAD */
  encrypt(id: string, plain: SyncPlain): Promise<string>;
  /** 실패하면 SyncCryptoError 를 던진다(키 불일치·변조·id 불일치) */
  decrypt(id: string, blob: string): Promise<SyncPlain>;
}

// ───────── 전송 (transport.ts, 담당 C) ─────────
export interface SyncTransport {
  /** HTTP 오류는 SyncHttpError 로 던진다(status, code, retryAfterSec) */
  sync(req: SyncRequest, opts?: { inviteCode?: string; signal?: AbortSignal }): Promise<SyncResponse>;
}

// ───────── 어댑터 (adapter.ts, 담당 D) ─────────
/** 로컬 저장소의 항목 한 개를 동기화 관점으로 본 것 */
export interface LocalItem {
  id: string;
  kind: ItemKind;
  updatedAt: number;
  deleted: boolean;
  /** deleted 면 null */
  data: SyncPlain['data'];
}
export interface SyncAdapter {
  /**
   * 로컬의 모든 항목(삭제되지 않은 것). 전부 읽거나 던진다 — 일부만 돌려주면 엔진이 삭제로 오해한다.
   * 휴지통 글감도 포함(deletedAt 은 data 에 담는다). 완전 삭제된 글감(purged)은 data.purged 로 남긴다.
   */
  listLocal(): Promise<LocalItem[]>;
  /**
   * 원격 항목을 로컬에 반영한다(삭제 포함). 글이 아직 없어 참조를 풀 수 없는 글감·스레드는 'deferred' 를 돌려준다
   * (엔진이 같은 동기화 안에서 글을 모두 적용한 뒤 한 번 더 시도한다).
   */
  apply(item: LocalItem): Promise<'applied' | 'deferred'>;
  /** 충돌에서 진 로컬 글을 이력에 '동기화 전(YYYY-MM-DD)' 이름으로 남긴다(글만 해당) */
  preserveLoser(item: LocalItem): Promise<void>;
  /** 로컬 항목 하나를 지운다(resync 에서 '서버에 없는 글 지우기'를 고른 경우) */
  removeLocal(item: LocalItem): Promise<void>;
  /** 적용 시작·끝 알림(앱이 이미지 gc 와 화면 갱신을 맞춘다) */
  setApplying?(on: boolean): void;
}

// ───────── 메타 저장소 (engine.ts 가 구현, IndexedDB 'works-sync') ─────────
export interface SyncMeta {
  id: string;
  rev: number; // 서버가 알려 준 마지막 rev. 한 번도 올리지 않았으면 0
  hash: string; // 마지막으로 동기화된 시점의 내용 해시(정규화 JSON 의 contentHash)
  updatedAt: number;
  deleted: boolean;
  /** 서버에서 받아 적용을 보류 중인 원격 사본(deferred) */
  pending?: boolean;
}
export interface SyncMetaStore {
  getAll(): Promise<SyncMeta[]>;
  put(m: SyncMeta): Promise<void>;
  putMany(ms: SyncMeta[]): Promise<void>;
  remove(id: string): Promise<void>;
  getState(): Promise<SyncState>;
  setState(s: Partial<SyncState>): Promise<void>;
  clear(): Promise<void>;
}
export interface SyncState {
  cursor: number;
  lastSyncAt: number; // 0 = 없음
}

// ───────── 상태 (state.svelte.ts·UI 가 읽는다) ─────────
export type SyncPhase =
  | 'off' // 설정 없음
  | 'idle' // 최신
  | 'pending' // 올릴 변경 대기(디바운스)
  | 'syncing'
  | 'offline'
  | 'error' // lastError 참조
  | 'paused'; // 사용자가 멈춤 또는 401/403 으로 자동 중단

export interface SyncProblem {
  kind: 'unauthorized' | 'forbidden' | 'rate-limited' | 'unavailable' | 'item-too-large' | 'space-full' | 'item-limit' | 'crypto' | 'network' | 'mass-delete';
  /** 사용자에게 보일 한국어 안내 */
  message: string;
  /** 자동 재개 시각(ms, 429 는 다음 00:00 UTC, 503 은 Retry-After). 없으면 수동 */
  retryAt?: number;
}
export interface OversizeItem { id: string; label: string; bytes: number }
export interface ResyncPrompt {
  /** 서버에 없는데 로컬에 있는 항목(글·글감·스레드) 요약 */
  orphans: { id: string; kind: ItemKind; label: string }[];
}
export interface SyncStatus {
  phase: SyncPhase;
  lastSyncAt: number;
  lastError?: SyncProblem;
  usage?: SyncUsage;
  /** 한도 때문에 동기화되지 않는 항목 */
  oversize: OversizeItem[];
  /** 서버 쓰기 한도 80% 이상이라 푸시 간격을 늘린 상태 */
  throttled: boolean;
  /** 사용자 결정을 기다리는 resync 묻기(없으면 undefined) */
  resync?: ResyncPrompt;
  /** 대량 삭제 가드가 멈춘 경우 사라진 항목 수 */
  massDelete?: { missing: number; total: number };
}

export interface SyncEngineOptions {
  config: SyncConfig;
  adapter: SyncAdapter;
  meta: SyncMetaStore;
  /** 기본: 설정으로 만든 코덱·전송. 테스트에서 주입한다 */
  codec?: SyncCodec;
  transport?: SyncTransport;
  now?: () => number;
  /** 기본 true. 테스트에서 타이머를 끄려면 false */
  autoSchedule?: boolean;
}
export interface SyncEngine {
  readonly status: SyncStatus;
  subscribe(fn: (s: SyncStatus) => void): () => void;
  /** 시작: 즉시 한 번 동기화하고 스케줄(화면 보임 3분 폴링, 숨김 시 푸시, 재접속)을 건다 */
  start(): void;
  stop(): void;
  /** 로컬이 바뀌었음을 알린다(디바운스 5초 뒤 푸시). 항목별 최소 푸시 간격 30초 */
  markDirty(): void;
  /** 지금 동기화(풀 → 푸시 → 풀). 진행 중이면 그 결과를 기다린다 */
  syncNow(): Promise<void>;
  /** resync 선택: 'upload' = 서버에 없는 로컬 항목을 새 항목(baseRev 0)으로 올림, 'delete' = 로컬에서 지움 */
  resolveResync(choice: 'upload' | 'delete'): Promise<void>;
  /** 대량 삭제 가드 해제: 'proceed' = 삭제를 서버에 반영, 'restore' = 서버 사본으로 되돌림 */
  resolveMassDelete(choice: 'proceed' | 'restore'): Promise<void>;
  /** 자동 동기화 재개(401 등 paused 에서 설정을 바꾼 뒤) */
  resume(): void;
}

// ───────── 오류 클래스 ─────────
export class SyncHttpError extends Error {
  constructor(public status: number, public code: SyncErrorCode | 'network' | 'unknown', public retryAfterSec?: number) {
    super(`sync ${status} ${code}`);
    this.name = 'SyncHttpError';
  }
}
export class SyncCryptoError extends Error {
  constructor(public reason: 'bad-key' | 'bad-format' | 'unsupported', message?: string) {
    super(message ?? reason);
    this.name = 'SyncCryptoError';
  }
}
