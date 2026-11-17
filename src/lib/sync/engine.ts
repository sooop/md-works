// 동기화 엔진: 풀 → 변경 감지 → 푸시 → 풀. 설계: .docs/sync-plan.md
import { contentHash } from '../bundle/merge';
import {
  APP_ID, LIMITS, SyncCryptoError, SyncHttpError,
  type ItemKind, type LocalItem, type OversizeItem, type PushItem, type RemoteItem, type SyncCodec,
  type SyncEngine, type SyncEngineOptions, type SyncMeta, type SyncPlain, type SyncProblem,
  type SyncRequest, type SyncResponse, type SyncStatus, type SyncTransport,
} from './protocol';
import { createTransport, splitPushBatches } from './transport';

const POLL_MS = 180_000;
const DEBOUNCE_MS = 5_000;
const MIN_PUSH_INTERVAL_MS = 30_000;
const THROTTLED_PUSH_INTERVAL_MS = 300_000;
const THROTTLE_RATIO = 0.8;
const BACKOFF_BASE_SEC = 30;
const BACKOFF_MAX_MS = 600_000;
const CONFLICT_RETRIES = 3;
const MASS_DELETE_MIN = 6;

// ───────── 해시 ─────────
/** 객체 키를 정렬해 stringify 한다(키 순서에 흔들리지 않게). undefined 값은 JSON 과 같이 생략 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x === undefined ? null : x)).join(',')}]`;
  const o = v as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(o).sort()) {
    if (o[k] === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${stableStringify(o[k])}`);
  }
  return `{${parts.join(',')}}`;
}
export function hashItem(item: { deleted: boolean; data: SyncPlain['data'] }): string {
  return contentHash(stableStringify({ d: item.deleted, data: item.data }));
}
const DELETED_HASH = hashItem({ deleted: true, data: null });

function kindFromId(id: string): ItemKind {
  if (id.startsWith('s-')) return 'snippet';
  if (id.startsWith('t-')) return 'thread';
  return 'doc';
}
function labelOf(item: { id: string; data: SyncPlain['data'] }): string {
  const d = item.data as Record<string, unknown> | null;
  if (!d) return item.id;
  if (typeof d.name === 'string') return d.name;
  if (typeof d.docName === 'string') return `${d.docName} 스레드`;
  if (typeof d.body === 'string') return d.body.slice(0, 30) || item.id;
  return item.id;
}
function nextUtcMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

class PushStop extends Error {
  constructor(public problem: SyncProblem) { super(problem.kind); }
}

interface Cand { id: string; kind: ItemKind; baseRev: number; deleted: boolean; updatedAt: number; local?: LocalItem }
type Blocked = null | 'auth' | 'crypto' | 'mass';

export function createSyncEngine(opts: SyncEngineOptions): SyncEngine & { onInviteUsed?: () => void } {
  const { config, adapter, meta: metaStore } = opts;
  const now = opts.now ?? (() => Date.now());
  const auto = opts.autoSchedule ?? true;

  // ── 상태 ──
  let status: SyncStatus = { phase: 'idle', lastSyncAt: 0, oversize: [], throttled: false };
  const listeners = new Set<(s: SyncStatus) => void>();
  function set(patch: Partial<SyncStatus>) {
    status = { ...status, ...patch };
    for (const fn of [...listeners]) fn(status);
  }

  // ── 기본 코덱·전송(지연 생성) ──
  let defaultKeys: Promise<{ codec: SyncCodec; transport: SyncTransport }> | null = null;
  function getDefaults() {
    return (defaultKeys ??= (async () => {
      const { deriveKeys } = await import('./keys');
      const { createCodec } = await import('./codec');
      const keys = await deriveKeys(config.syncKey, APP_ID);
      return {
        codec: createCodec(keys.encKey),
        transport: createTransport({ workerUrl: config.workerUrl, appId: APP_ID, spaceId: keys.spaceId, authToken: keys.authToken }),
      };
    })());
  }
  const getCodec = async (): Promise<SyncCodec> => opts.codec ?? (await getDefaults()).codec;
  const getTransport = async (): Promise<SyncTransport> => opts.transport ?? (await getDefaults()).transport;

  // ── 내부 상태 ──
  let loaded = false;
  let cursor = 0;
  let metaMap = new Map<string, SyncMeta>();
  let localMap = new Map<string, LocalItem>();
  const pendingMap = new Map<string, { item: LocalItem; rev: number }>();
  const lastPushAt = new Map<string, number>();
  let blocked: Blocked = null;
  let inviteUsed = false;
  let pushBlockedUntil = 0;
  let failures = 0;
  let backoffUntil = 0;
  let guardBypass = false;
  let inFlight: Promise<void> | null = null;
  let dirtyDuring = false;
  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let waitTimer: ReturnType<typeof setTimeout> | null = null;
  let waitDue = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const engine: SyncEngine & { onInviteUsed?: () => void } = {
    get status() { return status; },
    onInviteUsed: undefined,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    start,
    stop,
    markDirty,
    syncNow: () => run(true),
    resolveResync,
    resolveMassDelete,
    resume,
  };

  // ── 저장소 보조 ──
  async function load() {
    if (!loaded) {
      const s = await metaStore.getState();
      cursor = s.cursor;
      if (s.lastSyncAt) set({ lastSyncAt: s.lastSyncAt });
      loaded = true;
    }
    metaMap = new Map((await metaStore.getAll()).map((m) => [m.id, m]));
    // 재시작으로 보류 사본을 잃었으면 처음부터 다시 받는다(보류 항목의 rev 는 갱신하지 않았으므로 다시 적용된다)
    if ([...metaMap.values()].some((m) => m.pending && !pendingMap.has(m.id))) {
      cursor = 0;
      await persistCursor();
    }
  }
  async function refreshLocal() {
    const list = await adapter.listLocal();
    localMap = new Map(list.filter((i) => !i.deleted).map((i) => [i.id, i]));
  }
  async function putMeta(m: SyncMeta) { metaMap.set(m.id, m); await metaStore.put(m); }
  async function removeMeta(id: string) { metaMap.delete(id); pendingMap.delete(id); await metaStore.remove(id); }
  async function persistCursor() { if (!status.resync) await metaStore.setState({ cursor }); }

  // ── 호출 ──
  async function call(req: SyncRequest): Promise<SyncResponse> {
    const inviteCode = !inviteUsed ? config.inviteCode : undefined;
    const t = await getTransport();
    const resp = await t.sync(req, inviteCode ? { inviteCode } : undefined);
    if (inviteCode) { inviteUsed = true; engine.onInviteUsed?.(); }
    if (resp.usage) {
      const throttled = resp.usage.dailyWrites >= LIMITS.MAX_DAILY_WRITES * THROTTLE_RATIO;
      const u = status.usage;
      if (!u || u.items !== resp.usage.items || u.bytes !== resp.usage.bytes || u.dailyWrites !== resp.usage.dailyWrites || throttled !== status.throttled) {
        set({ usage: resp.usage, throttled });
      }
    }
    return resp;
  }

  async function decodeRemote(r: RemoteItem): Promise<LocalItem> {
    if (!r.blob) {
      if (!r.deleted) throw new SyncCryptoError('bad-format', '본문이 없는 항목');
      // 서버가 삭제 항목의 blob 을 비워 저장한다. updatedAt 을 알 수 없으므로 0(충돌 시 로컬 수정이 이긴다)
      return { id: r.id, kind: kindFromId(r.id), updatedAt: 0, deleted: true, data: null };
    }
    const plain = await (await getCodec()).decrypt(r.id, r.blob);
    const deleted = r.deleted || plain.data === null;
    return { id: r.id, kind: plain.kind, updatedAt: plain.updatedAt, deleted, data: deleted ? null : plain.data };
  }

  // ── 원격 항목 적용·충돌 판정 ──
  async function applyRemote(id: string, rev: number, remote: LocalItem): Promise<'applied' | 'deferred'> {
    const m = metaMap.get(id);
    adapter.setApplying?.(true);
    let res: 'applied' | 'deferred';
    try { res = await adapter.apply(remote); } finally { adapter.setApplying?.(false); }
    if (res === 'applied') {
      pendingMap.delete(id);
      if (remote.deleted) localMap.delete(id); else localMap.set(id, remote);
      await putMeta({ id, rev, hash: hashItem(remote), updatedAt: remote.updatedAt || m?.updatedAt || now(), deleted: remote.deleted });
      return 'applied';
    }
    pendingMap.set(id, { item: remote, rev });
    await putMeta({ ...(m ?? { id, rev: 0, hash: '', updatedAt: 0, deleted: false }), pending: true });
    return 'deferred';
  }

  /** 원격 항목 하나를 로컬과 맞춘다. 'local' = 로컬이 이겨 다시 푸시해야 함(메타 rev 는 갱신됨) */
  async function reconcile(r: RemoteItem, remote: LocalItem): Promise<'applied' | 'deferred' | 'local' | 'skip'> {
    const m = metaMap.get(r.id);
    // 같은 rev 는 이미 아는 버전(자기 항목 에코). 서버 rev 가 더 낮으면 서버가 정리 뒤 다시 만든 항목이므로 건너뛰지 않는다
    if (m && m.rev === r.rev) return 'skip';
    const local = localMap.get(r.id);
    const rh = hashItem(remote);
    const lh = local ? hashItem(local) : DELETED_HASH;
    if (lh === rh) {
      pendingMap.delete(r.id);
      await putMeta({ id: r.id, rev: r.rev, hash: rh, updatedAt: remote.updatedAt || local?.updatedAt || m?.updatedAt || now(), deleted: remote.deleted });
      return 'applied';
    }
    const dirty = m ? (local ? lh !== m.hash : !m.deleted && !m.pending) : !!local;
    if (!dirty) return applyRemote(r.id, r.rev, remote);
    const localUpdated = local ? local.updatedAt : (m?.updatedAt ?? 0);
    if (remote.updatedAt >= localUpdated) {
      if (local && local.kind === 'doc') await adapter.preserveLoser(local);
      return applyRemote(r.id, r.rev, remote);
    }
    // 서버 사본이 진 쪽이다: 덮어쓰기 전에 그 본문을 로컬 이력에 남긴다(글만, 삭제 사본은 남길 본문이 없다)
    if (local && remote.kind === 'doc' && !remote.deleted) await adapter.preserveLoser(remote);
    pendingMap.delete(r.id);
    await putMeta({ id: r.id, rev: r.rev, hash: m?.hash ?? '', updatedAt: m?.updatedAt ?? 0, deleted: false });
    return 'local';
  }

  async function retryPending() {
    for (const [id, p] of [...pendingMap]) await applyRemote(id, p.rev, p.item);
  }

  // ── 풀 ──
  async function pullAll() {
    let isResync = false;
    const serverIds = new Set<string>();
    for (;;) {
      const resp = await call({ cursor, push: [] });
      if (resp.resyncRequired && !isResync) isResync = true;
      await refreshLocal();
      for (const r of resp.changes) {
        if (isResync) serverIds.add(r.id);
        const remote = await decodeRemote(r);
        await reconcile(r, remote);
      }
      cursor = resp.cursor;
      if (!isResync) await persistCursor();
      if (!resp.hasMore) break;
    }
    await retryPending();
    if (!isResync) return;
    // 서버에 없는 로컬 항목 판정
    await refreshLocal();
    const orphans: { id: string; kind: ItemKind; label: string }[] = [];
    for (const m of [...metaMap.values()]) {
      if (m.rev <= 0 || serverIds.has(m.id) || m.pending) continue;
      const local = localMap.get(m.id);
      if (local && !m.deleted) orphans.push({ id: m.id, kind: local.kind, label: labelOf(local) });
      else await removeMeta(m.id);
    }
    if (orphans.length) set({ resync: { orphans } });
    else await metaStore.setState({ cursor });
  }

  // ── 푸시 ──
  function rateProblem(): SyncProblem {
    return { kind: 'rate-limited', message: '오늘의 쓰기 한도에 도달했습니다. 내일(UTC 자정) 이후 다시 올립니다.', retryAt: pushBlockedUntil };
  }

  async function pushPhase(force: boolean): Promise<{ pushed: boolean; problem?: SyncProblem; halted?: boolean }> {
    if (pushBlockedUntil > now()) {
      armWait(pushBlockedUntil - now());
      return { pushed: false, problem: rateProblem() };
    }
    await refreshLocal();
    const metas = [...metaMap.values()];
    // 한 번도 올리지 않은 채 로컬에서 사라진 항목은 서버에 알릴 것이 없다
    for (const m of metas) if (m.rev === 0 && !m.pending && !localMap.has(m.id)) await removeMeta(m.id);
    const live = [...metaMap.values()].filter((m) => !m.deleted && !m.pending && m.rev > 0);
    const missing = live.filter((m) => !localMap.has(m.id));
    if (!guardBypass && missing.length >= MASS_DELETE_MIN && missing.length * 2 >= live.length) {
      blocked = 'mass';
      set({ massDelete: { missing: missing.length, total: live.length } });
      return {
        pushed: false, halted: true,
        problem: { kind: 'mass-delete', message: `로컬 항목 ${missing.length}개(전체 ${live.length}개 중)가 한꺼번에 사라져 보입니다. 확인이 필요합니다.` },
      };
    }
    if (status.massDelete) set({ massDelete: undefined });
    if (blocked === 'mass') blocked = null;

    const interval = status.throttled ? THROTTLED_PUSH_INTERVAL_MS : MIN_PUSH_INTERVAL_MS;
    let wait = Infinity;
    const cands: Cand[] = [];
    const consider = (c: Cand) => {
      const last = lastPushAt.get(c.id);
      if (!force && last !== undefined && now() - last < interval) { wait = Math.min(wait, interval - (now() - last)); return; }
      cands.push(c);
    };
    for (const local of localMap.values()) {
      const m = metaMap.get(local.id);
      if (m?.pending) continue;
      if (m && hashItem(local) === m.hash) continue;
      consider({ id: local.id, kind: local.kind, baseRev: m?.rev ?? 0, deleted: false, updatedAt: local.updatedAt, local });
    }
    for (const m of live) {
      if (localMap.has(m.id)) continue;
      consider({ id: m.id, kind: kindFromId(m.id), baseRev: m.rev, deleted: true, updatedAt: now() });
    }
    if (Number.isFinite(wait)) armWait(wait);

    const over = new Map<string, OversizeItem>();
    let pushed = false;
    let problem: SyncProblem | undefined;
    try {
      let queue = cands;
      for (let round = 0; round <= CONFLICT_RETRIES && queue.length; round++) {
        const next: Cand[] = [];
        const byId = new Map<string, Cand>();
        const items: PushItem[] = [];
        for (const c of queue) {
          const plain: SyncPlain = { v: 1, kind: c.kind, updatedAt: c.updatedAt, data: c.deleted ? null : c.local!.data };
          const blob = await (await getCodec()).encrypt(c.id, plain);
          if (!c.deleted && blob.length > LIMITS.MAX_ITEM_BYTES) {
            over.set(c.id, { id: c.id, label: labelOf(c.local!), bytes: blob.length });
            continue;
          }
          byId.set(c.id, c);
          items.push({ id: c.id, baseRev: c.baseRev, deleted: c.deleted, blob });
        }
        const sendBatch = async (batch: PushItem[]): Promise<void> => {
          let resp: SyncResponse;
          const ts = now();
          for (const it of batch) lastPushAt.set(it.id, ts);
          try {
            resp = await call({ cursor, push: batch });
          } catch (e) {
            if (e instanceof SyncHttpError) {
              if (e.status === 413 || e.code === 'item_too_large') {
                if (batch.length > 1) {
                  const mid = Math.ceil(batch.length / 2);
                  await sendBatch(batch.slice(0, mid));
                  await sendBatch(batch.slice(mid));
                  return;
                }
                const c = byId.get(batch[0].id)!;
                over.set(c.id, { id: c.id, label: c.local ? labelOf(c.local) : c.id, bytes: batch[0].blob.length });
                return;
              }
              if (e.code === 'item_limit') throw new PushStop({ kind: 'item-limit', message: '공간의 항목 수 한도에 도달해 더 올릴 수 없습니다.' });
              if (e.code === 'space_full') throw new PushStop({ kind: 'space-full', message: '공간 용량이 가득 차 더 올릴 수 없습니다.' });
              if (e.status === 429) {
                pushBlockedUntil = nextUtcMidnight(now());
                throw new PushStop(rateProblem());
              }
            }
            throw e;
          }
          pushed = true;
          for (const a of resp.accepted) {
            const c = byId.get(a.id);
            if (!c) continue;
            await putMeta({
              id: c.id, rev: a.rev, hash: c.deleted ? DELETED_HASH : hashItem(c.local!),
              updatedAt: c.updatedAt, deleted: c.deleted,
            });
          }
          for (const rc of resp.conflicts) {
            const c0 = byId.get(rc.id);
            if (rc.rev === 0 && rc.deleted && !rc.blob) {
              // 서버에 사본이 없다(baseRev>0 으로 올린 항목). 로컬을 지우지 않고 새 항목(baseRev 0)으로 다시 올린다
              if (c0 && !c0.deleted) {
                await putMeta({ id: c0.id, rev: 0, hash: '', updatedAt: metaMap.get(c0.id)?.updatedAt ?? 0, deleted: false });
                next.push({ ...c0, baseRev: 0 });
              } else if (c0) await removeMeta(c0.id); // 지우려던 항목이 이미 서버에 없다
              continue;
            }
            const remote = await decodeRemote(rc);
            const res = await reconcile(rc, remote);
            const c = byId.get(rc.id);
            if (res === 'local' && c) next.push({ ...c, baseRev: rc.rev });
          }
        };
        for (const batch of splitPushBatches(items)) await sendBatch(batch);
        queue = next;
      }
    } catch (e) {
      if (e instanceof PushStop) problem = e.problem; else throw e;
    }
    set({ oversize: [...over.values()] });
    if (!problem && over.size) {
      problem = { kind: 'item-too-large', message: `크기 한도를 넘어 동기화되지 않는 항목이 ${over.size}개 있습니다.` };
    }
    return { pushed, problem };
  }

  // ── 사이클 ──
  async function cycle(force: boolean) {
    set({ phase: 'syncing' });
    try {
      await load();
      await pullAll();
      let problem: SyncProblem | undefined;
      let halted = false;
      if (!status.resync) {
        const r = await pushPhase(force);
        problem = r.problem; halted = !!r.halted;
        if (r.pushed) await pullAll();
      }
      guardBypass = false;
      failures = 0;
      backoffUntil = 0;
      const lastSyncAt = now();
      await metaStore.setState({ lastSyncAt });
      const phase = halted ? 'paused' : problem && problem.kind !== 'item-too-large' ? 'error' : 'idle';
      set({ phase, lastError: problem, lastSyncAt });
    } catch (e) {
      guardBypass = false;
      handleError(e);
    }
  }

  function handleError(e: unknown) {
    if (e instanceof SyncCryptoError) {
      blocked = 'crypto';
      set({ phase: 'error', lastError: { kind: 'crypto', message: '데이터를 복호화하지 못했습니다. 동기화 키가 다르거나 데이터가 손상되었습니다.' } });
      return;
    }
    if (e instanceof SyncHttpError) {
      if (e.status === 401) {
        blocked = 'auth';
        set({ phase: 'paused', lastError: { kind: 'unauthorized', message: '인증에 실패했습니다. 동기화 키를 확인하세요.' } });
      } else if (e.status === 403) {
        blocked = 'auth';
        set({ phase: 'paused', lastError: { kind: 'forbidden', message: '이 서버에서 허용되지 않았습니다(초대 코드·허용 앱·공간 수 확인).' } });
      } else if (e.status === 0) {
        set({ phase: 'offline', lastError: { kind: 'network', message: '서버에 연결할 수 없습니다. 연결되면 다시 시도합니다.' } });
      } else if (e.status === 429) {
        pushBlockedUntil = Math.max(pushBlockedUntil, nextUtcMidnight(now()));
        set({ phase: 'error', lastError: rateProblem() });
      } else if (e.status >= 500) {
        failures++;
        const baseMs = (e.retryAfterSec ?? BACKOFF_BASE_SEC) * 1000;
        const delay = Math.min(baseMs * 2 ** (failures - 1), BACKOFF_MAX_MS);
        backoffUntil = now() + delay;
        set({ phase: 'error', lastError: { kind: 'unavailable', message: '서버가 일시적으로 응답하지 않습니다. 잠시 뒤 다시 시도합니다.', retryAt: backoffUntil } });
        armWait(delay);
      } else {
        set({ phase: 'error', lastError: { kind: 'unavailable', message: `서버 오류(${e.status} ${e.code})` } });
      }
      return;
    }
    set({ phase: 'error', lastError: { kind: 'unavailable', message: e instanceof Error ? e.message : String(e) } });
  }

  function run(force: boolean): Promise<void> {
    if (inFlight) return inFlight;
    const p: Promise<void> = cycle(force).finally(() => {
      inFlight = null;
      if (dirtyDuring) { dirtyDuring = false; if (auto && !stopped) armDebounce(); }
    });
    inFlight = p;
    return p;
  }
  /** 스케줄러가 부르는 실행: 중단 상태·백오프를 지킨다 */
  function autoRun(): Promise<void> {
    if (stopped || blocked) return Promise.resolve();
    if (now() < backoffUntil) { armWait(backoffUntil - now()); return Promise.resolve(); }
    return run(false);
  }

  // ── 타이머 ──
  function armDebounce() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; void autoRun(); }, DEBOUNCE_MS);
  }
  function armWait(delay: number) {
    if (!auto || stopped) return;
    delay = Math.max(delay, 0);
    const due = now() + delay;
    if (waitTimer && waitDue <= due) return;
    if (waitTimer) clearTimeout(waitTimer);
    waitDue = due;
    waitTimer = setTimeout(() => { waitTimer = null; void autoRun(); }, delay);
  }
  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  function onVisibility() {
    if (visible()) { void autoRun(); return; }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; void autoRun(); }
  }
  function onOnline() { void autoRun(); }

  function start() {
    stopped = false;
    if (!auto) return;
    void run(true);
    pollTimer ??= setInterval(() => { if (visible()) void autoRun(); }, POLL_MS);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
  }
  function stop() {
    stopped = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (waitTimer) clearTimeout(waitTimer);
    if (pollTimer) clearInterval(pollTimer);
    debounceTimer = waitTimer = null; pollTimer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
  }
  function markDirty() {
    if (inFlight) dirtyDuring = true;
    else if (status.phase === 'idle') set({ phase: 'pending' });
    if (auto && !stopped && !inFlight) armDebounce();
  }

  // ── 사용자 결정 ──
  async function settle() { if (inFlight) await inFlight.catch(() => {}); }

  async function resolveResync(choice: 'upload' | 'delete') {
    await settle();
    const prompt = status.resync;
    if (!prompt) return;
    await load();
    await refreshLocal();
    for (const o of prompt.orphans) {
      if (choice === 'delete') {
        const local = localMap.get(o.id);
        if (local) {
          adapter.setApplying?.(true);
          try { await adapter.removeLocal(local); } finally { adapter.setApplying?.(false); }
        }
      }
      await removeMeta(o.id);
    }
    set({ resync: undefined });
    await metaStore.setState({ cursor });
    await run(true);
  }

  async function resolveMassDelete(choice: 'proceed' | 'restore') {
    await settle();
    await load();
    if (choice === 'proceed') {
      guardBypass = true;
    } else {
      await refreshLocal();
      for (const m of [...metaMap.values()]) if (!m.deleted && !m.pending && m.rev > 0 && !localMap.has(m.id)) await removeMeta(m.id);
      cursor = 0;
      await metaStore.setState({ cursor: 0 });
    }
    blocked = null;
    set({ massDelete: undefined, lastError: undefined });
    await run(true);
  }

  function resume() {
    blocked = null;
    set({ phase: 'idle', lastError: undefined });
    void run(true);
  }

  return engine;
}
