// 동기화 전송: POST {workerUrl}/v1/sync. 쿠키·credentials 를 쓰지 않는다.
import {
  LIMITS, SyncHttpError,
  type PushItem, type SyncErrorCode, type SyncRequest, type SyncResponse, type SyncTransport,
} from './protocol';

export interface TransportConfig {
  workerUrl: string;
  appId: string;
  spaceId: string;
  authToken: string;
}

const KNOWN_CODES: readonly string[] = [
  'bad_request', 'unauthorized', 'forbidden', 'body_too_large', 'item_too_large', 'item_limit', 'space_full', 'daily_write_limit', 'unavailable',
];

export function createTransport(cfg: TransportConfig, fetchFn: typeof fetch = (...a) => fetch(...a)): SyncTransport {
  const url = `${cfg.workerUrl.replace(/\/+$/, '')}/v1/sync`;
  return {
    async sync(req: SyncRequest, opts?: { inviteCode?: string; signal?: AbortSignal }): Promise<SyncResponse> {
      const headers: Record<string, string> = {
        'X-App-Id': cfg.appId,
        'X-Space-Id': cfg.spaceId,
        Authorization: `Bearer ${cfg.authToken}`,
        'Content-Type': 'application/json',
      };
      if (opts?.inviteCode) headers['X-Invite-Code'] = opts.inviteCode;
      let res: Response;
      try {
        res = await fetchFn(url, {
          method: 'POST', headers, body: JSON.stringify(req), credentials: 'omit', signal: opts?.signal,
        });
      } catch (e) {
        if (e instanceof TypeError) throw new SyncHttpError(0, 'network');
        throw e;
      }
      if (!res.ok) {
        let code: SyncErrorCode | 'unknown' = 'unknown';
        try {
          const body = (await res.json()) as { error?: unknown };
          if (typeof body?.error === 'string' && KNOWN_CODES.includes(body.error)) code = body.error as SyncErrorCode;
        } catch { /* 본문 없음 */ }
        const ra = Number(res.headers.get('Retry-After'));
        throw new SyncHttpError(res.status, code, Number.isFinite(ra) && ra > 0 ? ra : undefined);
      }
      try {
        return (await res.json()) as SyncResponse;
      } catch {
        throw new SyncHttpError(res.status, 'unknown');
      }
    },
  };
}

/** 요청 본문이 softBytes 를 넘지 않고 건수가 MAX_PUSH_ITEMS 이하가 되게 나눈다. 단일 항목이 넘으면 그 항목만 단독 묶음 */
export function splitPushBatches(items: PushItem[], softBytes: number = LIMITS.SOFT_BODY_BYTES): PushItem[][] {
  const OVERHEAD = 64; // {"cursor":N,"push":[]}
  const out: PushItem[][] = [];
  let cur: PushItem[] = [];
  let bytes = OVERHEAD;
  for (const it of items) {
    const size = JSON.stringify(it).length + 1;
    if (cur.length > 0 && (cur.length >= LIMITS.MAX_PUSH_ITEMS || bytes + size > softBytes)) {
      out.push(cur); cur = []; bytes = OVERHEAD;
    }
    cur.push(it); bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}
