// 글 이름 변경으로 레코드의 docKey 가 파티션과 어긋난 기존 데이터를 불러올 때 요청한 키로 맞추는지 확인한다
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { useWorksStore, worksStore } from '../../src/lib/works/store';
import { createIdbStore } from '../../src/lib/works/idbStore';
import type { Thread } from '../../src/lib/works/types';
import { listThreads, addMessage, removeMessage, deleteThread, saveThread } from '../../src/lib/comments/threads';

let n = 0;
beforeEach(() => useWorksStore(createIdbStore(`threads-dockey-${n++}`)));

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 't1', docKey: 'old.md', anchor: { quote: '인용', prefix: '', suffix: '' },
  messages: [{ id: 'm1', text: '첫 메시지', ts: 1 }], resolved: false, createdAt: 1, updatedAt: 1, ...over,
});

describe('스레드 docKey 정규화', () => {
  it('레코드의 docKey 가 옛 경로여도 불러올 때 요청한 키로 맞춘다', async () => {
    await worksStore().put('threads', thread(), 'new.md');
    const [t] = await listThreads('new.md');
    expect(t.docKey).toBe('new.md');
  });

  it('어긋난 스레드에 메시지를 더해도 새 파티션에 저장되고 옛 파티션이 생기지 않는다', async () => {
    await worksStore().put('threads', thread(), 'new.md');
    const next = await addMessage('new.md', 't1', '답글');
    expect(next.docKey).toBe('new.md');
    expect(await worksStore().list('threads', 'old.md')).toEqual([]);
    expect((await worksStore().get<Thread>('threads', 't1', 'new.md'))?.docKey).toBe('new.md');
    expect((await listThreads('new.md'))[0].messages).toHaveLength(2);
  });

  it('어긋난 스레드도 삭제(소프트)가 새 파티션에서 이루어진다', async () => {
    await worksStore().put('threads', thread(), 'new.md');
    const [t] = await listThreads('new.md');
    await deleteThread(t);
    expect(await listThreads('new.md')).toEqual([]);
    expect(await worksStore().list('threads', 'old.md')).toEqual([]);
    const rec = await worksStore().get<Thread>('threads', 't1', 'new.md');
    expect(rec?.deletedAt).toBeTypeOf('number');
    expect(rec?.docKey).toBe('new.md');
  });

  it('첫 메시지 삭제(스레드 삭제)와 저장도 마찬가지다', async () => {
    await worksStore().put('threads', thread(), 'new.md');
    await saveThread({ ...(await listThreads('new.md'))[0], resolved: true });
    expect((await listThreads('new.md'))[0].resolved).toBe(true);
    expect(await removeMessage('new.md', 't1', 'm1')).toBeNull();
    expect(await listThreads('new.md')).toEqual([]);
    expect(await worksStore().list('threads', 'old.md')).toEqual([]);
  });
});
