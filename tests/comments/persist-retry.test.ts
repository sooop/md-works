// 코멘트 저장 실패 시 변경이 유실되지 않고(재큐잉), 항목 하나의 실패가 나머지를 막지 않으며, 백오프로 재시도하는지 확인한다
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Thread } from '../../src/lib/works/types';

const saves: string[] = [];
const fail = new Set<string>();
vi.mock('../../src/lib/comments/threads', () => ({
  saveThread: vi.fn(async (t: Thread) => { if (fail.has(t.id)) throw new Error('디스크 오류'); saves.push(t.id); }),
  deleteThread: vi.fn(async () => {}),
  listThreads: vi.fn(async () => []),
  migrateLegacy: vi.fn(async () => {}),
  sendThreadToSnippet: vi.fn(),
  withMessageAdded: vi.fn(), withMessageEdited: vi.fn(), withMessageRemoved: vi.fn(),
}));
vi.mock('../../src/lib/store.svelte', () => ({ toast: vi.fn(), errMsg: (e: unknown) => String(e), askConfirm: vi.fn() }));
vi.mock('../../src/lib/works/tabSync', () => ({ notifyTabs: vi.fn(), onTabMessage: vi.fn() }));
vi.mock('../../src/lib/comments/anchor', () => ({ anchorOf: vi.fn(), flatten: vi.fn(() => ({})), locate: vi.fn(() => null), MAX_QUOTE: 100 }));
vi.mock('../../src/lib/comments/pmComments', () => ({
  attachComments: vi.fn(() => ({ doc: () => ({}), set: vi.fn(), destroy: vi.fn(), selection: vi.fn(), setActive: vi.fn(), reveal: vi.fn() })),
}));

const T = (id: string): Thread => ({
  id, docKey: 'a.md', anchor: { quote: 'q', prefix: '', suffix: '' },
  messages: [{ id: `${id}m`, text: 'x', ts: 1 }], resolved: false, createdAt: 1, updatedAt: 1,
});

async function setup() {
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} });
  const mod = await import('../../src/lib/comments/store.svelte');
  mod.bindComments({} as never, 'a.md');
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
  mod.cm.items = [T('t1'), T('t2'), T('t3')];
  mod.cm.loaded = true;
  return mod;
}

beforeEach(() => { vi.useFakeTimers(); saves.length = 0; fail.clear(); vi.resetModules(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('코멘트 저장 재시도', () => {
  it('실패한 항목만 되돌려 놓고 나머지는 저장한다 (flushComments 는 false)', async () => {
    const m = await setup();
    fail.add('t2');
    for (const id of ['t1', 't2', 't3']) m.toggleResolved(id);
    expect(await m.flushComments()).toBe(false);
    expect(saves).toEqual(['t1', 't3']); // t2 의 실패가 t3 을 막지 않았다
  });

  it('백오프 시간이 지나면 실패한 항목만 다시 저장하고 성공하면 true', async () => {
    const m = await setup();
    fail.add('t2');
    m.toggleResolved('t2');
    expect(await m.flushComments()).toBe(false);
    saves.length = 0;
    await vi.advanceTimersByTimeAsync(1500);
    expect(saves).toEqual([]); // 첫 재시도는 2초 뒤
    fail.clear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves).toEqual(['t2']);
    expect(await m.flushComments()).toBe(true);
  });

  it('연속 실패하면 재시도 간격이 늘어난다(2·4·8초… 최대 60초)', async () => {
    const m = await setup();
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(m.retryDelay)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  });
});
