import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { useWorksStore, worksStore } from '../../src/lib/works/store';
import { createIdbStore } from '../../src/lib/works/idbStore';
import { listSnippets } from '../../src/lib/works/snippets';
import type { Thread } from '../../src/lib/works/types';
import type { Comment } from '../../src/lib/comments/anchor';
import {
  commentToThread, threadToComment, migrateLegacy, threadToSnippetBody, sendThreadToSnippet, saveThread, listThreads,
  addMessage, editMessage, removeMessage, deleteThread, type LegacyBackend,
} from '../../src/lib/comments/threads';

let n = 0;
beforeEach(() => useWorksStore(createIdbStore(`threads-test-${n++}`)));

const comment = (id: string, text = '본문', over: Partial<Comment> = {}): Comment => ({
  id, quote: '인용', prefix: '앞', suffix: '뒤', text, created: 100, updated: 200, resolved: false, ...over,
});
const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 't1', docKey: 'd1', anchor: { quote: '인용', prefix: '', suffix: '' },
  messages: [{ id: 'm1', text: '첫 메시지', ts: 1 }], resolved: false, createdAt: 1, updatedAt: 1, ...over,
});

/** 메모리 레거시 저장소 */
function legacyOf(data: Record<string, Comment[]>, failClear = false): LegacyBackend & { data: Record<string, Comment[]> } {
  return {
    data,
    load: async (k) => data[k] ?? [],
    clear: async (k) => { if (failClear) throw new Error('clear 실패'); delete data[k]; },
  };
}

describe('코멘트 → 스레드 변환', () => {
  it('첫 메시지가 코멘트 본문, 앵커·시각·해결 여부를 옮긴다', () => {
    const t = commentToThread(comment('c1', '내용', { resolved: true }), 'doc');
    expect(t).toMatchObject({
      id: 'c1', docKey: 'doc', anchor: { quote: '인용', prefix: '앞', suffix: '뒤' }, resolved: true, createdAt: 100, updatedAt: 200,
    });
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0]).toMatchObject({ text: '내용', ts: 100 });
    expect(t.messages[0].id).toBeTruthy();
  });

  it('스레드 → 레거시 코멘트(백업 어댑터): 메시지는 빈 줄로 합친다', () => {
    const t = thread({ messages: [{ id: 'a', text: 'Q', ts: 1 }, { id: 'b', text: 'A', ts: 2 }] });
    expect(threadToComment(t)).toEqual({ id: 't1', quote: '인용', prefix: '', suffix: '', text: 'Q\n\nA', created: 1, updated: 1, resolved: false });
  });
});

describe('이전 코멘트 이관', () => {
  it('스레드가 없고 레거시가 있으면 옮기고 레거시를 비운다', async () => {
    const legacy = legacyOf({ d1: [comment('c1'), comment('c2')] });
    expect(await migrateLegacy('d1', legacy)).toBe(2);
    expect((await listThreads('d1')).map((t) => t.id).sort()).toEqual(['c1', 'c2']);
    expect(legacy.data.d1).toBeUndefined();
  });

  it('이미 스레드가 있으면 건드리지 않는다(레거시도 그대로)', async () => {
    await saveThread(thread());
    const legacy = legacyOf({ d1: [comment('c1')] });
    expect(await migrateLegacy('d1', legacy)).toBe(0);
    expect((await listThreads('d1')).map((t) => t.id)).toEqual(['t1']);
    expect(legacy.data.d1).toHaveLength(1);
  });

  it('레거시가 비어 있으면 아무 일도 없다', async () => {
    expect(await migrateLegacy('d1', legacyOf({}))).toBe(0);
    expect(await listThreads('d1')).toEqual([]);
  });

  it('비우기가 실패해도 스레드는 저장돼 있고, 다음에 다시 열면 중복 없이 넘어간다', async () => {
    const legacy = legacyOf({ d1: [comment('c1')] }, true);
    await expect(migrateLegacy('d1', legacy)).rejects.toThrow('clear 실패');
    expect(await listThreads('d1')).toHaveLength(1);
    expect(legacy.data.d1).toHaveLength(1); // 저장분이 있으니 지워지지 않았다
    expect(await migrateLegacy('d1', legacy)).toBe(0);
    expect(await listThreads('d1')).toHaveLength(1);
  });

  it('저장이 실패하면 레거시를 비우지 않는다', async () => {
    const legacy = legacyOf({ d1: [comment('c1')] });
    const real = worksStore();
    useWorksStore({ ...real, putMany: async () => { throw new Error('쓰기 실패'); } });
    await expect(migrateLegacy('d1', legacy)).rejects.toThrow('쓰기 실패');
    expect(legacy.data.d1).toHaveLength(1);
  });

  it('다른 문서의 스레드는 영향이 없다', async () => {
    await saveThread(thread({ id: 'x', docKey: 'other' }));
    const legacy = legacyOf({ d1: [comment('c1')] });
    expect(await migrateLegacy('d1', legacy)).toBe(1);
  });
});

describe('메시지 추가·수정·삭제', () => {
  beforeEach(async () => { await saveThread(thread()); });

  it('답글은 순서대로 쌓이고 updatedAt 이 갱신된다', async () => {
    await addMessage('d1', 't1', '답1');
    const t = await addMessage('d1', 't1', '답2');
    expect(t.messages.map((m) => m.text)).toEqual(['첫 메시지', '답1', '답2']);
    expect(t.updatedAt).toBeGreaterThan(1);
    expect((await listThreads('d1'))[0].messages).toHaveLength(3);
  });

  it('수정은 해당 메시지만 바꾼다', async () => {
    const t = await addMessage('d1', 't1', '답1');
    const next = await editMessage('d1', 't1', t.messages[1].id, '답1 수정');
    expect(next.messages.map((m) => m.text)).toEqual(['첫 메시지', '답1 수정']);
  });

  it('답글 삭제는 그 메시지만, 첫 메시지 삭제는 스레드째 지운다', async () => {
    const t = await addMessage('d1', 't1', '답1');
    const after = await removeMessage('d1', 't1', t.messages[1].id);
    expect(after?.messages.map((m) => m.text)).toEqual(['첫 메시지']);
    expect(await removeMessage('d1', 't1', 'm1')).toBeNull();
    expect(await listThreads('d1')).toEqual([]);
  });

  it('스레드 삭제는 소프트 삭제 — 목록에서만 빠지고 묘비가 남는다(번들 병합이 삭제를 전하도록)', async () => {
    await deleteThread({ id: 't1', docKey: 'd1' });
    expect(await listThreads('d1')).toEqual([]);
    const raw = await worksStore().get<Thread>('threads', 't1', 'd1');
    expect(raw?.deletedAt).toBeGreaterThan(0);
    expect(raw!.updatedAt).toBe(raw!.deletedAt);
    await deleteThread({ id: 't1', docKey: 'd1' }); // 두 번째 삭제는 시각을 바꾸지 않는다
    expect((await worksStore().get<Thread>('threads', 't1', 'd1'))?.deletedAt).toBe(raw!.deletedAt);
    await deleteThread({ id: 'none', docKey: 'd1' }); // 없는 스레드는 무시
  });

  it('없는 스레드는 오류', async () => {
    await expect(addMessage('d1', 'nope', 'x')).rejects.toThrow();
  });
});

describe('스레드 → 글감', () => {
  it('여러 줄 인용은 줄마다 > , 메시지는 목록(줄바꿈은 2칸 들여쓰기)', () => {
    const body = threadToSnippetBody(thread({
      anchor: { quote: '첫 줄\n\n셋째 줄', prefix: '', suffix: '' },
      messages: [{ id: 'a', text: '질문입니다\n두 번째 줄', ts: 1 }, { id: 'b', text: '답', ts: 2 }],
    }));
    expect(body).toBe('> 첫 줄\n>\n> 셋째 줄\n\n- 질문입니다\n  두 번째 줄\n- 답');
  });

  it('보내기: 글감(파랑, 글에 붙음)이 생기고 스레드는 사라진다', async () => {
    const t = thread();
    await saveThread(t);
    await sendThreadToSnippet(t);
    const [s] = await listSnippets();
    expect(s).toMatchObject({ color: 'blue', attachedDocs: ['d1'], body: '> 인용\n\n- 첫 메시지' });
    expect(await listThreads('d1')).toEqual([]);
  });

  it('글감 생성이 실패하면 스레드는 남는다', async () => {
    const t = thread();
    await saveThread(t);
    const real = worksStore();
    useWorksStore({ ...real, put: async (coll, rec, part) => { if (coll === 'snippets') throw new Error('실패'); return real.put(coll, rec, part); } });
    await expect(sendThreadToSnippet(t)).rejects.toThrow('실패');
    expect(await listThreads('d1')).toHaveLength(1);
  });
});
