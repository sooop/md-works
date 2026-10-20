// 글감 도메인 API. UI·스레드→글감 변환·번들 가져오기가 모두 이 함수들을 거친다. 저장소는 worksStore() 가 정한다.
import { worksStore, type WorksStore } from './store';
import { newId, type Snippet, type SnippetColor, type SnippetSource } from './types';
import { topOrder, withOrder, withoutOrder, mapOrderKeys, type OrderChange } from './snippetOrder';

export interface NewSnippet {
  body: string;
  source?: SnippetSource;
  color?: SnippetColor;
  /** 만들면서 바로 붙일 글의 docKey */
  attachTo?: string[];
}

/** store: 기본은 앱의 worksStore(). 번들 가져오기처럼 호스트의 저장소에 쓸 때만 넘긴다 */
export async function createSnippet(input: NewSnippet, store: WorksStore = worksStore()): Promise<Snippet> {
  const now = Date.now();
  const attachedDocs = [...new Set(input.attachTo ?? [])];
  // 붙이는 글마다 맨 위에 놓는다
  const all = attachedDocs.length ? await store.list<Snippet>('snippets') : [];
  const orders = Object.fromEntries(attachedDocs.map((d) => [d, topOrder(all, d)]));
  const s: Snippet = {
    id: newId(), body: input.body, color: input.color ?? 'yellow', createdAt: now, updatedAt: now,
    attachedDocs,
    ...(attachedDocs.length ? { orders } : {}),
    ...(input.source ? { source: input.source } : {}),
  };
  await store.put('snippets', s);
  return s;
}

/** 휴지통에 없는 글감을 최근 수정 순으로 */
export async function listSnippets(): Promise<Snippet[]> {
  return (await worksStore().list<Snippet>('snippets')).filter((s) => !s.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listTrashedSnippets(): Promise<Snippet[]> {
  return (await worksStore().list<Snippet>('snippets')).filter((s) => s.deletedAt && !s.purged).sort((a, b) => b.deletedAt! - a.deletedAt!);
}

async function mutate(id: string, fn: (s: Snippet) => Snippet): Promise<Snippet> {
  const cur = await worksStore().get<Snippet>('snippets', id);
  if (!cur) throw new Error('글감을 찾을 수 없습니다');
  const next = { ...fn(cur), updatedAt: Date.now() };
  await worksStore().put('snippets', next);
  return next;
}

export const updateSnippet = (id: string, patch: Partial<Pick<Snippet, 'body' | 'source' | 'color'>>) =>
  mutate(id, (s) => ({ ...s, ...patch }));

/** 글에 붙이기: 그 글의 맨 위에 놓인다 */
export async function attachSnippet(id: string, docKey: string): Promise<Snippet> {
  const top = topOrder(await worksStore().list<Snippet>('snippets'), docKey);
  return mutate(id, (s) => (s.attachedDocs.includes(docKey) ? s : {
    ...s, attachedDocs: [...s.attachedDocs, docKey], orders: withOrder(s.orders, docKey, top),
  }));
}

/** 글에서 떼기: 연결만 끊고 글감은 남는다. 그 글에서의 순서 값도 지운다 */
export const detachSnippet = (id: string, docKey: string) =>
  mutate(id, (s) => {
    const { orders: _o, ...rest } = s;
    void _o;
    const orders = withoutOrder(s.orders, docKey);
    return { ...rest, attachedDocs: s.attachedDocs.filter((d) => d !== docKey), ...(orders ? { orders } : {}) };
  });

/** 한 글에서의 순서를 바꾼다. 값이 바뀐 글감만 updatedAt 을 갱신하고, 한 번의 putMany 로 쓴다 */
export async function reorderSnippets(docKey: string, changes: OrderChange[]): Promise<number> {
  if (!changes.length) return 0;
  const by = new Map((await worksStore().list<Snippet>('snippets')).map((s) => [s.id, s]));
  const now = Date.now();
  const recs = changes.flatMap((c) => {
    const s = by.get(c.id);
    return s && !s.purged && !s.deletedAt ? [{ ...s, orders: withOrder(s.orders, docKey, c.order), updatedAt: now }] : [];
  });
  if (recs.length) await worksStore().putMany('snippets', recs);
  return recs.length;
}

/** 여러 글감의 색을 한 번에 바꾼다(휴지통·묘비는 건너뜀). 바꾼 개수를 돌려준다 */
export async function setSnippetColors(ids: string[], color: SnippetColor): Promise<number> {
  const want = new Set(ids);
  const now = Date.now();
  const recs = (await worksStore().list<Snippet>('snippets')).filter((s) => want.has(s.id) && !s.purged && !s.deletedAt)
    .map((s) => ({ ...s, color, updatedAt: now }));
  if (recs.length) await worksStore().putMany('snippets', recs);
  return recs.length;
}

/** 여러 글감을 한 번에 휴지통으로(trashSnippet 과 같은 규칙). 보낸 개수를 돌려준다 */
export async function trashSnippets(ids: string[]): Promise<number> {
  const want = new Set(ids);
  const now = Date.now();
  const recs = (await worksStore().list<Snippet>('snippets')).filter((s) => want.has(s.id) && !s.purged && !s.deletedAt)
    .map((s): Snippet => ({ ...s, deletedAt: now, trashedFrom: s.attachedDocs, attachedDocs: [], updatedAt: now }));
  if (recs.length) await worksStore().putMany('snippets', recs);
  return recs.length;
}

/** 글감함 휴지통으로. 붙어 있던 글은 기억해 두었다가 복구 때 되붙인다. */
export const trashSnippet = (id: string) =>
  mutate(id, (s) => ({ ...s, deletedAt: Date.now(), trashedFrom: s.attachedDocs, attachedDocs: [] }));

export const restoreSnippet = (id: string) =>
  mutate(id, ({ deletedAt: _d, trashedFrom, ...s }) => { void _d; return { ...s, attachedDocs: trashedFrom ?? [] }; });

/**
 * 휴지통에서 완전히 지운다. 레코드를 지우지 않고 묘비({purged:true})로 바꿔 둔다 —
 * 그래야 다른 기기의 번들을 가져와도 지운 글감이 되살아나지 않는다. 묘비는 목록·휴지통·검색에 나타나지 않는다.
 */
export async function purgeSnippet(id: string): Promise<void> {
  const cur = await worksStore().get<Snippet>('snippets', id);
  if (!cur) return;
  const now = Date.now();
  const tomb: Snippet = {
    id, body: '', color: cur.color, createdAt: cur.createdAt, attachedDocs: [],
    updatedAt: now, deletedAt: cur.deletedAt ?? now, purged: true,
  };
  await worksStore().put('snippets', tomb);
}

/**
 * 폴더 이름 변경·삭제 때 접두사(from + '/')로 붙은 글감을 정리한다 (서버 모드: docKey 가 경로).
 * to 가 없으면 연결만 끊고, 있으면 접두사를 치환한다.
 */
export async function reattachPrefix(from: string, to?: string): Promise<void> {
  const pre = from + '/';
  const swap = (d: string[]) => [...new Set(d.flatMap((x) => (x.startsWith(pre) ? (to ? [to + '/' + x.slice(pre.length)] : []) : [x])))];
  const key = (k: string) => (k.startsWith(pre) ? (to ? to + '/' + k.slice(pre.length) : undefined) : k);
  for (const s of await worksStore().list<Snippet>('snippets')) {
    if (![...s.attachedDocs, ...(s.trashedFrom ?? []), ...Object.keys(s.orders ?? {})].some((x) => x.startsWith(pre))) continue;
    await worksStore().put('snippets', rekeyed(s, swap, key));
  }
}

/** 글이 삭제·이름 변경될 때 붙은 글감의 연결을 정리한다 (to 가 없으면 연결만 끊는다). 순서 값(orders)의 키도 같이 옮기거나 지운다 */
export async function reattachDoc(from: string, to?: string): Promise<void> {
  const swap = (d: string[]) => [...new Set(d.flatMap((x) => (x === from ? (to ? [to] : []) : [x])))];
  const key = (k: string) => (k === from ? to : k);
  for (const s of await worksStore().list<Snippet>('snippets')) {
    if (!s.attachedDocs.includes(from) && !(s.trashedFrom ?? []).includes(from) && !(from in (s.orders ?? {}))) continue;
    await worksStore().put('snippets', rekeyed(s, swap, key));
  }
}

function rekeyed(s: Snippet, swap: (d: string[]) => string[], key: (k: string) => string | undefined): Snippet {
  const { orders: _o, ...rest } = s;
  void _o;
  const orders = mapOrderKeys(s.orders, key);
  return { ...rest, updatedAt: Date.now(), attachedDocs: swap(s.attachedDocs), ...(s.trashedFrom ? { trashedFrom: swap(s.trashedFrom) } : {}), ...(orders ? { orders } : {}) };
}
