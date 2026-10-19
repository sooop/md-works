// 코멘트 스레드 도메인: 레거시 코멘트 변환·이관, 메시지 추가/수정/삭제, 글감 본문 변환.
// 순수 함수(변환)와 worksStore() 위의 저장 함수를 한 파일에 둔다. UI 상태(store.svelte.ts)는 이 함수들만 호출한다.
import { worksStore } from '../works/store';
import { newId, type Thread, type ThreadMessage } from '../works/types';
import { createSnippet } from '../works/snippets';
import type { Comment } from './anchor';

// ---- 레거시 코멘트 <-> 스레드 (이관·zip 백업 어댑터) ----
/** 코멘트 한 건 → 스레드. 코멘트 id 를 그대로 쓰고, 본문은 첫 메시지가 된다 */
export function commentToThread(c: Comment, docKey: string): Thread {
  return {
    id: c.id, docKey,
    anchor: { quote: c.quote, prefix: c.prefix, suffix: c.suffix },
    messages: [{ id: newId(), text: c.text, ts: c.created }],
    resolved: c.resolved, createdAt: c.created, updatedAt: c.updated,
  };
}

/** 스레드 → 레거시 코멘트(zip 백업용). 답글은 빈 줄로 이어 붙여 본문 하나로 합친다 */
export function threadToComment(t: Thread): Comment {
  return {
    id: t.id, ...t.anchor, text: t.messages.map((m) => m.text).join('\n\n'),
    created: t.createdAt, updated: t.updatedAt, resolved: t.resolved,
  };
}

/** 이관 대상 레거시 저장소. 모드가 주입한다 */
export interface LegacyBackend {
  load(docKey: string): Promise<Comment[]>;
  clear(docKey: string): Promise<void>;
}

/**
 * 문서의 스레드가 하나도 없고 레거시 코멘트가 있으면 스레드로 옮긴다.
 * 새 저장소에 쓴 뒤 다시 읽어 전부 있는지 확인한 다음에만 레거시를 비운다(실패하면 레거시는 그대로).
 * 돌려주는 값은 이관한 건수.
 */
export async function migrateLegacy(docKey: string, legacy: LegacyBackend): Promise<number> {
  const store = worksStore();
  if ((await store.list<Thread>('threads', docKey)).length) return 0;
  const old = await legacy.load(docKey);
  if (!old.length) return 0;
  const threads = old.map((c) => commentToThread(c, docKey));
  await store.putMany('threads', threads, docKey);
  const saved = new Set((await store.list<Thread>('threads', docKey)).map((t) => t.id));
  if (!threads.every((t) => saved.has(t.id))) throw new Error('코멘트 이관을 확인하지 못했습니다');
  await legacy.clear(docKey);
  return threads.length;
}

// ---- 메시지 (순수 변환: 새 스레드를 돌려준다) ----
const touch = (t: Thread, patch: Partial<Thread>, now: number): Thread => ({ ...t, ...patch, updatedAt: now });

export function withMessageAdded(t: Thread, text: string, now = Date.now()): Thread {
  const m: ThreadMessage = { id: newId(), text, ts: now };
  return touch(t, { messages: [...t.messages, m] }, now);
}
export function withMessageEdited(t: Thread, msgId: string, text: string, now = Date.now()): Thread {
  return touch(t, { messages: t.messages.map((m) => (m.id === msgId ? { ...m, text } : m)) }, now);
}
/** 메시지를 뺀 스레드. 첫 메시지를 빼는 것은 스레드 삭제이므로 호출하는 쪽이 따로 처리한다 */
export function withMessageRemoved(t: Thread, msgId: string, now = Date.now()): Thread {
  return touch(t, { messages: t.messages.filter((m) => m.id !== msgId) }, now);
}

// ---- 저장 (worksStore 위) ----
export const listThreads = async (docKey: string) =>
  (await worksStore().list<Thread>('threads', docKey)).filter((t) => !t.deletedAt).sort((a, b) => a.createdAt - b.createdAt);

export const saveThread = (t: Thread) => worksStore().put('threads', t, t.docKey);
/**
 * 스레드 삭제는 소프트 삭제다(deletedAt 설정). 번들 병합이 '지워졌다'는 사실을 다른 기기에 전하려면 레코드가 남아 있어야 한다.
 * 목록(listThreads)과 UI 에서는 제외된다.
 */
export async function deleteThread(t: Pick<Thread, 'id' | 'docKey'>): Promise<void> {
  const cur = await worksStore().get<Thread>('threads', t.id, t.docKey);
  if (!cur || cur.deletedAt) return;
  const now = Date.now();
  await worksStore().put('threads', { ...cur, deletedAt: now, updatedAt: now }, t.docKey);
}

async function mutate(docKey: string, id: string, fn: (t: Thread) => Thread): Promise<Thread> {
  const cur = await worksStore().get<Thread>('threads', id, docKey);
  if (!cur) throw new Error('스레드를 찾을 수 없습니다');
  const next = fn(cur);
  await saveThread(next);
  return next;
}
export const addMessage = (docKey: string, id: string, text: string) => mutate(docKey, id, (t) => withMessageAdded(t, text));
export const editMessage = (docKey: string, id: string, msgId: string, text: string) => mutate(docKey, id, (t) => withMessageEdited(t, msgId, text));
/** 첫 메시지를 지우면 스레드째 지운다(null) */
export async function removeMessage(docKey: string, id: string, msgId: string): Promise<Thread | null> {
  const cur = await worksStore().get<Thread>('threads', id, docKey);
  if (!cur) throw new Error('스레드를 찾을 수 없습니다');
  if (cur.messages[0]?.id === msgId || cur.messages.length <= 1) { await deleteThread(cur); return null; }
  return mutate(docKey, id, (t) => withMessageRemoved(t, msgId));
}

// ---- 글감으로 보내기 ----
/** 스레드 → 글감 마크다운. 인용(앵커 원문)은 `> ` 블록, 메시지는 목록(메시지 안의 줄바꿈은 2칸 들여쓰기) */
export function threadToSnippetBody(t: Pick<Thread, 'anchor' | 'messages'>): string {
  const quote = t.anchor.quote.split(/\r?\n/).map((l) => (l ? `> ${l}` : '>')).join('\n');
  const items = t.messages.map((m) => `- ${m.text.split(/\r?\n/).join('\n  ')}`).join('\n');
  return `${quote}\n\n${items}`;
}

/** 글감을 만든 뒤에만 스레드를 지운다(실패하면 스레드는 그대로 남는다) */
export async function sendThreadToSnippet(t: Thread) {
  const s = await createSnippet({ body: threadToSnippetBody(t), color: 'blue', attachTo: [t.docKey] });
  await deleteThread(t);
  return s;
}
