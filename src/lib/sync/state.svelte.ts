// 동기화 반응형 상태·설정 저장. 엔진·메타는 sync-kit 패키지, 어댑터(adapter.ts)는 동적 import 로 만든다(buildEngine 한 곳).
// 설정은 localStorage 'works.sync'({workerUrl, syncKey, inviteCode?, enabled})에만 둔다.
// 동기화 키·Worker 주소·초대 코드는 번들·내보내기·백업에 절대 포함하지 않는다(backupState 의 텔레그램 토큰과 같은 원칙).
import { bundleHost } from '../bundle/host';
import {
  createIdbMetaStore, createSyncEngine, expandWorkerUrl, formatSyncKey, generateSyncKey, normalizeSyncKey,
  type SyncAdapter, type SyncConfig, type SyncEngine, type SyncMetaStore, type SyncStatus,
} from 'sync-kit';
import { APP_ID } from './appTypes';

const KEY = 'works.sync';

const emptyStatus = (phase: SyncStatus['phase'] = 'off'): SyncStatus => ({ phase, lastSyncAt: 0, oversize: [], throttled: false });

/** 입력 검증 오류. field 는 화면에서 오류를 붙일 입력 칸 */
export class SyncInputError extends Error {
  constructor(public field: 'workerUrl' | 'inviteCode' | 'key', message: string) {
    super(message);
    this.name = 'SyncInputError';
  }
}

interface Persisted { workerUrl: string; syncKey: string; inviteCode?: string; enabled: boolean }

function load(): { config: SyncConfig | undefined; enabled: boolean } {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* 저장소를 못 쓰는 환경 */ }
  if (!raw) return { config: undefined, enabled: true };
  try {
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== 'object') return { config: undefined, enabled: true };
    const o = p as Partial<Persisted>;
    if (typeof o.workerUrl !== 'string' || typeof o.syncKey !== 'string' || !o.workerUrl || !o.syncKey) return { config: undefined, enabled: true };
    return {
      config: { workerUrl: o.workerUrl, syncKey: o.syncKey, ...(typeof o.inviteCode === 'string' && o.inviteCode ? { inviteCode: o.inviteCode } : {}) },
      enabled: o.enabled !== false,
    };
  } catch {
    return { config: undefined, enabled: true };
  }
}

const initial = load();

export const sync = $state<{ config: SyncConfig | undefined; status: SyncStatus; enabled: boolean }>({
  config: initial.config,
  status: emptyStatus(initial.config ? (initial.enabled ? 'idle' : 'paused') : 'off'),
  enabled: initial.enabled,
});

/** 동기화 대화상자의 열림 상태(명령·상태 배지가 연다) */
export const syncUi = $state<{ open: boolean }>({ open: false });

function persist() {
  try {
    if (!sync.config) { localStorage.removeItem(KEY); return; }
    const c = sync.config;
    const p: Persisted = { workerUrl: c.workerUrl, syncKey: c.syncKey, ...(c.inviteCode ? { inviteCode: c.inviteCode } : {}), enabled: sync.enabled };
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch { /* 저장소를 못 쓰는 환경 */ }
}

// ---- 엔진 ----
let engine: SyncEngine | undefined;
let unsubscribe: (() => void) | undefined;
let userStopped = false; // pause() 로 stop 했는가(resume 이 start 를 다시 불러야 한다)
let generation = 0; // 엔진을 만드는 중에 설정이 바뀌면 이전 요청을 버린다

/**
 * 다른 모듈이 만들어 주는 부품을 모아 엔진을 만든다. 시그니처를 가정한 곳은 여기뿐이다.
 *  - createSyncEngine(opts: SyncEngineOptions): SyncEngine                (sync-kit)
 *  - createSyncAdapter(deps: { host: BundleHost; store: WorksStore }): SyncAdapter  (./adapter)
 *  - createIdbMetaStore(dbName): SyncMetaStore                             (sync-kit; 기본 DB 이름 'works-sync' 를 명시해 기존 기기의 메타를 유지한다)
 */
async function buildEngine(config: SyncConfig): Promise<SyncEngine> {
  const { createSyncAdapter } = await import('./adapter');
  const host = bundleHost();
  const adapter: SyncAdapter = createSyncAdapter({ host, store: host.store });
  const meta: SyncMetaStore = createIdbMetaStore('works-sync');
  return createSyncEngine({ appId: APP_ID, config, adapter, meta });
}

function stopEngine() {
  unsubscribe?.();
  unsubscribe = undefined;
  engine?.stop();
  engine = undefined;
}

function onStatus(s: SyncStatus) {
  sync.status = { ...s };
  // 첫 요청이 성공했으면 초대 코드를 지운다
  if (sync.config?.inviteCode && s.lastSyncAt > 0 && (s.phase === 'idle' || s.phase === 'pending')) {
    delete sync.config.inviteCode;
    persist();
  }
}

async function startEngine(): Promise<void> {
  stopEngine();
  const config = sync.config;
  if (!config) { sync.status = emptyStatus('off'); return; }
  const gen = ++generation;
  try {
    const e = await buildEngine($state.snapshot(config));
    if (gen !== generation) { e.stop(); return; }
    engine = e;
    userStopped = false;
    unsubscribe = e.subscribe(onStatus);
    sync.status = { ...e.status };
    e.start();
  } catch (err) {
    if (gen !== generation) return;
    const message = err instanceof Error ? err.message : String(err);
    sync.status = { ...emptyStatus('error'), lastError: { kind: 'network', message: `동기화를 시작하지 못했습니다: ${message}` } };
  }
}

/** 설정이 있고 켜져 있으면 엔진을 만들어 시작한다(셸이 마운트될 때 한 번) */
export async function startSyncIfConfigured(): Promise<void> {
  if (!sync.config) return;
  if (!sync.enabled) { sync.status = { ...emptyStatus('paused') }; return; }
  if (engine) return;
  // 같은 브라우저의 탭이 여럿이면 한 탭만 엔진을 돌린다(탭끼리 rev 를 다투지 않게). 락을 쥔 탭이 닫히면 다른 탭이 이어받는다
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) { await startEngine(); return; }
  void locks.request('works-sync-engine', async () => {
    await startEngine();
    await new Promise<void>(() => { /* 탭이 닫힐 때까지 락을 쥔다 */ });
  });
}

/** 로컬이 바뀌었음을 엔진에 알린다. onWorksWrite 는 단일 리스너라 배선은 호출하는 쪽(메인)이 한다 */
export function notifyLocalChange(): void {
  if (engine && sync.enabled) engine.markDirty();
}

// ---- 연결 ----
const WORKER_NAME = 'md-works-sync'; // sync-worker/wrangler.toml 의 name
const URL_ERR = 'Worker 주소를 https:// 로 시작하는 주소나 이름만 입력하세요 (예: 내이름 또는 https://md-works-sync.내이름.workers.dev)';

function normalizeWorkerUrl(input: string): string {
  const s = expandWorkerUrl(input, WORKER_NAME).replace(/\/+$/, '');
  if (!s) throw new SyncInputError('workerUrl', 'Worker 주소를 입력하세요');
  let u: URL;
  try { u = new URL(s); } catch { throw new SyncInputError('workerUrl', URL_ERR); }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new SyncInputError('workerUrl', URL_ERR);
  return `${u.origin}${u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '')}`;
}

async function apply(config: SyncConfig): Promise<void> {
  sync.config = config;
  sync.enabled = true;
  persist();
  await startEngine();
}

/** 이 기기에서 새로 시작: 새 키를 만들고 초대 코드로 새 공간을 연다. 만든 키를 돌려준다 */
export async function connectNew(workerUrl: string, inviteCode: string): Promise<string> {
  const url = normalizeWorkerUrl(workerUrl);
  const code = inviteCode.trim();
  if (!code) throw new SyncInputError('inviteCode', '초대 코드를 입력하세요. Worker 를 배포할 때 정한 코드입니다');
  const syncKey = generateSyncKey();
  await apply({ workerUrl: url, syncKey, inviteCode: code });
  return syncKey;
}

/** 다른 기기의 키로 연결. 키가 올바르지 않으면 SyncInputError('key') */
export async function connectExisting(workerUrl: string, keyInput: string): Promise<string> {
  const url = normalizeWorkerUrl(workerUrl);
  const normalized = normalizeSyncKey(keyInput);
  if (!normalized) throw new SyncInputError('key', '동기화 키가 올바르지 않습니다. 영문 대문자·숫자 26자(4자씩 끊어 표시)인지 확인하세요');
  const syncKey = formatSyncKey(normalized);
  await apply({ workerUrl: url, syncKey });
  return syncKey;
}

/** 이 기기의 키·설정만 지운다. 글은 그대로 남는다. 동기화 메타(clearSyncMeta)는 지우지 않는다 — 호출자가 확인을 받은 뒤 부른다 */
export function disconnect(): void {
  generation++;
  stopEngine();
  sync.config = undefined;
  sync.enabled = true;
  sync.status = emptyStatus('off');
  persist();
}

/** 로컬 동기화 메타(커서·항목별 rev)를 지운다. 다른 공간에 새로 연결하기 전에 쓴다 */
export async function clearSyncMeta(): Promise<void> {
  const meta: SyncMetaStore = createIdbMetaStore('works-sync');
  await meta.clear();
}

// ---- 일시 정지·재개·즉시 동기화 ----
export function pause(): void {
  if (!sync.config) return;
  sync.enabled = false;
  persist();
  engine?.stop();
  userStopped = true;
  sync.status = { ...sync.status, phase: 'paused', lastError: undefined };
}

export function resume(): void {
  if (!sync.config) return;
  sync.enabled = true;
  persist();
  if (!engine) { void startEngine(); return; }
  if (userStopped) { userStopped = false; engine.start(); } else engine.resume();
}

export async function syncNow(): Promise<void> {
  if (!sync.config) return;
  if (!sync.enabled) resume();
  await engine?.syncNow();
}

export async function resolveResync(choice: 'upload' | 'delete'): Promise<void> {
  await engine?.resolveResync(choice);
}

export async function resolveMassDelete(choice: 'proceed' | 'restore'): Promise<void> {
  await engine?.resolveMassDelete(choice);
}
