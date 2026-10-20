// 서버 버전용 WorksStore: 서버 API(`/api/works`)가 노트 폴더의 `.works/` 사이드카에 저장한다.
import { PARTITIONED, type Coll, type WorksRecord } from './types';
import type { WorksStore } from './store';
import { trackNet } from '../netBusy.svelte';

/** base: 테스트에서 서버 주소를 지정할 때만 쓴다(브라우저에서는 같은 출처의 빈 문자열) */
export function createSidecarStore(base = ''): WorksStore {
  function call<T>(path: string, init?: RequestInit): Promise<T> {
    return trackNet((async () => {
      const res = await fetch(base + path, init);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? `요청 실패 (${res.status})`);
      return j as T;
    })());
  }
  const q = (coll: Coll, part?: string, id?: string) => {
    const p = new URLSearchParams({ coll });
    if (PARTITIONED[coll] && part) p.set('part', part);
    if (id) p.set('id', id);
    return p.toString();
  };
  const json = (method: string, body: unknown): RequestInit => ({
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  return {
    async list<T extends WorksRecord>(coll: Coll, part?: string) {
      return (await call<{ records: T[] }>(`/api/works?${q(coll, part)}`)).records;
    },
    async get<T extends WorksRecord>(coll: Coll, id: string, part?: string) {
      const { record } = await call<{ record: T | null }>(`/api/works/one?${q(coll, part, id)}`);
      return record ?? undefined;
    },
    async put(coll, rec, part) { await this.putMany(coll, [rec], part); },
    async putMany(coll, recs, part) {
      await call('/api/works', json('PUT', { coll, part: PARTITIONED[coll] ? part : undefined, recs }));
    },
    async remove(coll, id, part) { await call(`/api/works?${q(coll, part, id)}`, { method: 'DELETE' }); },
    async parts(coll) { return (await call<{ parts: string[] }>(`/api/works/parts?${q(coll)}`)).parts; },
    async removePart(coll, part) { await call(`/api/works/part?${q(coll, part)}`, { method: 'DELETE' }); },
    async movePart(coll, from, to) { await call('/api/works/move-part', json('POST', { coll, from, to })); },
  };
}
