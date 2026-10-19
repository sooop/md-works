// L2: 레거시 코멘트 id 가 저장소 id 규칙(ID_RE) 밖이어도 전부 이관된다
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { useWorksStore, worksStore } from '../../src/lib/works/store';
import { createIdbStore } from '../../src/lib/works/idbStore';
import type { Thread, WorksRecord } from '../../src/lib/works/types';
import type { WorksStore } from '../../src/lib/works/store';
import type { Comment } from '../../src/lib/comments/anchor';
import { migrateLegacy, listThreads, type LegacyBackend } from '../../src/lib/comments/threads';

let n = 0;
beforeEach(() => {
  // 서버 사이드카 저장소처럼 규칙 밖 id 를 받으면 거부하는 저장소
  const inner = createIdbStore(`threads-legacy-ids-${n++}`);
  const strict: WorksStore = {
    ...inner,
    list: inner.list.bind(inner), get: inner.get.bind(inner), remove: inner.remove.bind(inner),
    parts: inner.parts.bind(inner), removePart: inner.removePart.bind(inner), movePart: inner.movePart.bind(inner),
    put: (c, r, p) => strict.putMany(c, [r], p),
    putMany: async (c, recs: WorksRecord[], p) => {
      for (const r of recs) if (!/^[A-Za-z0-9_-]{1,80}$/.test(r.id)) throw new Error('잘못된 id');
      await inner.putMany(c, recs, p);
    },
  };
  useWorksStore(strict);
});

const comment = (id: string): Comment => ({ id, quote: '인용', prefix: '', suffix: '', text: `본문 ${id}`, created: 1, updated: 2, resolved: false });

describe('레거시 이관: 유효하지 않은 id', () => {
  it('새 id 를 부여해 전부 옮기고, 확인 뒤에 레거시를 비운다', async () => {
    const data: Record<string, Comment[]> = { d1: [comment('ok1'), comment('한글 id'), comment('a/b'), comment('ok1')] };
    const legacy: LegacyBackend = { load: async (k) => data[k] ?? [], clear: async (k) => { delete data[k]; } };
    expect(await migrateLegacy('d1', legacy)).toBe(4);
    const ts = await listThreads('d1');
    expect(ts).toHaveLength(4);
    expect(new Set(ts.map((t: Thread) => t.id)).size).toBe(4);
    expect(ts.map((t) => t.messages[0].text).sort()).toEqual(['본문 a/b', '본문 ok1', '본문 ok1', '본문 한글 id']);
    expect(data.d1).toBeUndefined();
    expect(worksStore()).toBeTruthy();
  });
});
