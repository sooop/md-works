import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';

// store.ts 의 모듈 상태를 테스트마다 새로 얻는다
async function fresh() {
  const { vi } = await import('vitest');
  vi.resetModules();
  const store = await import('../../src/lib/works/store');
  const { createIdbStore } = await import('../../src/lib/works/idbStore');
  return { ...store, createIdbStore };
}

describe('onWorksReady', () => {
  it('등록 전에 걸어 둔 콜백은 등록되는 순간 한 번 호출된다', async () => {
    const { onWorksReady, useWorksStore, createIdbStore } = await fresh();
    let n = 0;
    onWorksReady(() => { n++; });
    expect(n).toBe(0);
    useWorksStore(createIdbStore('ready-a'));
    expect(n).toBe(1);
    useWorksStore(createIdbStore('ready-b')); // 다시 등록해도 한 번만
    expect(n).toBe(1);
  });

  it('이미 등록돼 있으면 바로 호출된다', async () => {
    const { onWorksReady, useWorksStore, createIdbStore, hasWorksStore } = await fresh();
    expect(hasWorksStore()).toBe(false);
    useWorksStore(createIdbStore('ready-c'));
    let n = 0;
    onWorksReady(() => { n++; });
    expect(n).toBe(1);
  });
});
