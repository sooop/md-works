// 글감 도메인 API. UI·스레드→글감 변환·번들 가져오기가 모두 이 함수들을 거친다. 저장소는 worksStore() 가 정한다.
import { worksStore } from './store';
import { newId, type Snippet, type SnippetColor, type SnippetSource } from './types';

export interface NewSnippet {
  body: string;
  source?: SnippetSource;
  color?: SnippetColor;
  /** 만들면서 바로 붙일 글의 docKey */
  attachTo?: string[];
}

export async function createSnippet(input: NewSnippet): Promise<Snippet> {
  const now = Date.now();
  const s: Snippet = {
    id: newId(), body: input.body, color: input.color ?? 'yellow', createdAt: now, updatedAt: now,
    attachedDocs: [...new Set(input.attachTo ?? [])],
    ...(input.source ? { source: input.source } : {}),
  };
  await worksStore().put('snippets', s);
  return s;
}

/** 휴지통에 없는 글감을 최근 수정 순으로 */
export async function listSnippets(): Promise<Snippet[]> {
  return (await worksStore().list<Snippet>('snippets')).filter((s) => !s.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listTrashedSnippets(): Promise<Snippet[]> {
  return (await worksStore().list<Snippet>('snippets')).filter((s) => s.deletedAt).sort((a, b) => b.deletedAt! - a.deletedAt!);
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

export const attachSnippet = (id: string, docKey: string) =>
  mutate(id, (s) => ({ ...s, attachedDocs: [...new Set([...s.attachedDocs, docKey])] }));

/** 글에서 떼기: 연결만 끊고 글감은 남는다 */
export const detachSnippet = (id: string, docKey: string) =>
  mutate(id, (s) => ({ ...s, attachedDocs: s.attachedDocs.filter((d) => d !== docKey) }));

/** 글감함 휴지통으로. 붙어 있던 글은 기억해 두었다가 복구 때 되붙인다. */
export const trashSnippet = (id: string) =>
  mutate(id, (s) => ({ ...s, deletedAt: Date.now(), trashedFrom: s.attachedDocs, attachedDocs: [] }));

export const restoreSnippet = (id: string) =>
  mutate(id, ({ deletedAt: _d, trashedFrom, ...s }) => { void _d; return { ...s, attachedDocs: trashedFrom ?? [] }; });

/** 휴지통에서 완전히 지운다 */
export const purgeSnippet = (id: string) => worksStore().remove('snippets', id);

/**
 * 폴더 이름 변경·삭제 때 접두사(from + '/')로 붙은 글감을 정리한다 (서버 모드: docKey 가 경로).
 * to 가 없으면 연결만 끊고, 있으면 접두사를 치환한다.
 */
export async function reattachPrefix(from: string, to?: string): Promise<void> {
  const pre = from + '/';
  const swap = (d: string[]) => [...new Set(d.flatMap((x) => (x.startsWith(pre) ? (to ? [to + '/' + x.slice(pre.length)] : []) : [x])))];
  for (const s of await worksStore().list<Snippet>('snippets')) {
    if (![...s.attachedDocs, ...(s.trashedFrom ?? [])].some((x) => x.startsWith(pre))) continue;
    await worksStore().put('snippets', {
      ...s, updatedAt: Date.now(), attachedDocs: swap(s.attachedDocs), ...(s.trashedFrom ? { trashedFrom: swap(s.trashedFrom) } : {}),
    });
  }
}

/** 글이 삭제·이름 변경될 때 붙은 글감의 연결을 정리한다 (to 가 없으면 연결만 끊는다) */
export async function reattachDoc(from: string, to?: string): Promise<void> {
  for (const s of await worksStore().list<Snippet>('snippets')) {
    const hit = (d: string[]) => d.includes(from);
    if (!hit(s.attachedDocs) && !hit(s.trashedFrom ?? [])) continue;
    const swap = (d: string[]) => [...new Set(d.flatMap((x) => (x === from ? (to ? [to] : []) : [x])))];
    await worksStore().put('snippets', {
      ...s, updatedAt: Date.now(), attachedDocs: swap(s.attachedDocs), ...(s.trashedFrom ? { trashedFrom: swap(s.trashedFrom) } : {}),
    });
  }
}
