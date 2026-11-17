// 동기화 엔진 테스트용 가짜: 서버·코덱·메모리 어댑터
import {
  LIMITS, SyncCryptoError, SyncHttpError,
  type LocalItem, type PushItem, type RemoteItem, type SyncAdapter, type SyncCodec, type SyncPlain,
  type SyncRequest, type SyncResponse, type SyncTransport,
} from '../../src/lib/sync/protocol';

/** 서버 규칙을 단순하게 흉내 낸다: rev·baseRev·seq·conflicts·purged_seq */
export class FakeServer {
  items = new Map<string, { rev: number; seq: number; deleted: boolean; blob: string }>();
  seq = 0;
  purgedSeq = 0;
  dailyWrites = 0;
  maxDailyWrites: number = LIMITS.MAX_DAILY_WRITES;
  maxBodyItems = Infinity; // 한 요청 push 건수가 넘으면 413
  maxItems = Infinity; // 새 항목 수가 넘으면 422 item_limit
  maxBytes = Infinity; // 합계가 넘으면 422 space_full
  pageSize = 50;
  requests: SyncRequest[] = [];
  invites: (string | undefined)[] = [];
  /** 요청마다 호출. SyncHttpError 를 돌려주면 그 오류를 던진다 */
  fail: ((req: SyncRequest, n: number) => SyncHttpError | undefined) | null = null;

  handle(req: SyncRequest, inviteCode?: string): SyncResponse {
    this.requests.push(JSON.parse(JSON.stringify(req)));
    this.invites.push(inviteCode);
    const err = this.fail?.(req, this.requests.length);
    if (err) throw err;
    let cursor = req.cursor;
    let resyncRequired: true | undefined;
    let push = req.push;
    if (cursor > 0 && cursor < this.purgedSeq) { resyncRequired = true; cursor = 0; push = []; }
    if (push.length > this.maxBodyItems) throw new SyncHttpError(413, 'body_too_large');
    const accepted: { id: string; rev: number }[] = [];
    const conflicts: RemoteItem[] = [];
    const stage = (it: PushItem) => {
      if (it.blob.length > LIMITS.MAX_ITEM_BYTES) throw new SyncHttpError(422, 'item_too_large');
    };
    push.forEach(stage);
    const cur = this.items.get.bind(this.items);
    for (const it of push) {
      const ex = cur(it.id);
      if (ex ? ex.rev !== it.baseRev : it.baseRev !== 0) {
        if (ex) { conflicts.push({ id: it.id, rev: ex.rev, deleted: ex.deleted, blob: ex.blob }); continue; }
      }
      if (!ex && this.items.size >= this.maxItems) throw new SyncHttpError(422, 'item_limit');
      const bytes = [...this.items.values()].reduce((a, x) => a + x.blob.length, 0) + it.blob.length;
      if (bytes > this.maxBytes) throw new SyncHttpError(422, 'space_full');
      if (this.dailyWrites >= this.maxDailyWrites) throw new SyncHttpError(429, 'daily_write_limit');
      this.dailyWrites++;
      const rev = (ex?.rev ?? 0) + 1;
      this.items.set(it.id, { rev, seq: ++this.seq, deleted: it.deleted, blob: it.blob });
      accepted.push({ id: it.id, rev });
    }
    const all = [...this.items.entries()].filter(([, v]) => v.seq > cursor).sort((a, b) => a[1].seq - b[1].seq);
    const page = all.slice(0, this.pageSize);
    const hasMore = all.length > page.length;
    const changes: RemoteItem[] = page.map(([id, v]) => ({ id, rev: v.rev, deleted: v.deleted, blob: v.blob }));
    const next = hasMore ? page[page.length - 1][1].seq : this.seq;
    return {
      cursor: next, hasMore, accepted, conflicts, changes, resyncRequired,
      usage: { items: this.items.size, bytes: 0, dailyWrites: this.dailyWrites },
    };
  }

  /** 보관 기간이 지난 삭제 항목 정리 */
  purgeDeleted() {
    for (const [id, v] of [...this.items]) {
      if (v.deleted) { this.purgedSeq = Math.max(this.purgedSeq, v.seq); this.items.delete(id); }
    }
  }
  /** 서버에서 항목 하나를 통째로 제거(다른 이유로 서버에 없는 상태를 만들기) */
  drop(id: string, purgedSeq?: number) {
    this.items.delete(id);
    if (purgedSeq !== undefined) this.purgedSeq = purgedSeq;
  }

  transport(): SyncTransport {
    return { sync: async (req, o) => this.handle(req, o?.inviteCode) };
  }
}

export function fakeCodec(key = 'k'): SyncCodec {
  return {
    async encrypt(id, plain) {
      return Buffer.from(JSON.stringify({ key, id, plain })).toString('base64');
    },
    async decrypt(id, blob) {
      let o: { key: string; id: string; plain: SyncPlain };
      try { o = JSON.parse(Buffer.from(blob, 'base64').toString()); } catch { throw new SyncCryptoError('bad-format'); }
      if (o.key !== key || o.id !== id) throw new SyncCryptoError('bad-key');
      return o.plain;
    },
  };
}

export type DocItem = LocalItem;
export class MemoryAdapter implements SyncAdapter {
  items = new Map<string, LocalItem>();
  applied: LocalItem[] = [];
  preserved: LocalItem[] = [];
  removed: LocalItem[] = [];
  deferIds = new Set<string>();
  failList = false;
  async listLocal() {
    if (this.failList) throw new Error('저장소 읽기 실패');
    return [...this.items.values()].map((i) => structuredClone(i));
  }
  async apply(item: LocalItem) {
    if (this.deferIds.has(item.id)) return 'deferred' as const;
    this.applied.push(structuredClone(item));
    if (item.deleted) this.items.delete(item.id); else this.items.set(item.id, structuredClone(item));
    return 'applied' as const;
  }
  async preserveLoser(item: LocalItem) { this.preserved.push(structuredClone(item)); }
  async removeLocal(item: LocalItem) { this.removed.push(item); this.items.delete(item.id); }

  putDoc(name: string, content: string, updatedAt: number) {
    const id = `d${name}`;
    this.items.set(id, { id, kind: 'doc', updatedAt, deleted: false, data: { name, content } });
    return id;
  }
  putThread(id: string, docName: string, updatedAt: number) {
    this.items.set(id, {
      id, kind: 'thread', updatedAt, deleted: false,
      data: { docName, anchor: { quote: 'q', prefix: '', suffix: '' }, messages: [], resolved: false, createdAt: 1 },
    });
  }
  del(id: string) { this.items.delete(id); }
  content(id: string) { return (this.items.get(id)?.data as { content?: string } | undefined)?.content; }
}
