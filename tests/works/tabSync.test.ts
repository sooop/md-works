import { describe, expect, it } from 'vitest';
import { createTabSync, runExclusive, type TabMsg } from '../../src/lib/works/tabSync';

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('createTabSync', () => {
  it('한 탭의 알림이 같은 채널의 다른 탭에 전달된다(보낸 쪽에는 오지 않는다)', async () => {
    const name = `t-${Math.random()}`;
    const a = createTabSync(name);
    const b = createTabSync(name);
    const gotA: TabMsg[] = [];
    const gotB: TabMsg[] = [];
    a.on((m) => gotA.push(m));
    b.on((m) => gotB.push(m));
    a.notify({ t: 'docs' });
    a.notify({ t: 'threads', keys: ['x'] });
    await wait();
    expect(gotB).toEqual([{ t: 'docs' }, { t: 'threads', keys: ['x'] }]);
    expect(gotA).toEqual([]);
    a.close();
    b.close();
  });

  it('BroadcastChannel 이 없으면 조용히 건너뛴다', () => {
    const s = createTabSync('x', undefined);
    expect(() => s.notify({ t: 'docs' })).not.toThrow();
    s.close();
  });

  it('만들 수 없는 환경(예외)도 조용히 건너뛴다', () => {
    const s = createTabSync('x', () => { throw new Error('막힘'); });
    expect(() => s.notify({ t: 'docs' })).not.toThrow();
  });

  it('잘못된 메시지는 무시한다', async () => {
    const name = `t-${Math.random()}`;
    const rx = createTabSync(name);
    const raw = new BroadcastChannel(name);
    const got: TabMsg[] = [];
    rx.on((m) => got.push(m));
    raw.postMessage('문자열');
    raw.postMessage(null);
    raw.postMessage({ t: 'docs' });
    await wait();
    expect(got).toEqual([{ t: 'docs' }]);
    raw.close();
    rx.close();
  });
});

describe('runExclusive', () => {
  const fakeLocks = () => {
    const held = new Set<string>();
    return {
      request: async (name: string, _o: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<unknown> | unknown) => {
        if (held.has(name)) return cb(null);
        held.add(name);
        try { return await cb({ name }); } finally { held.delete(name); }
      },
    };
  };

  it('Web Locks 가 없으면 그냥 실행한다', async () => {
    let ran = 0;
    expect(await runExclusive('gc', async () => { ran++; }, undefined)).toBe(true);
    expect(ran).toBe(1);
  });

  it('다른 탭이 잠그고 있으면 건너뛴다', async () => {
    const locks = fakeLocks();
    let ran = 0;
    let release!: () => void;
    const first = runExclusive('gc', () => new Promise<void>((r) => { ran++; release = r; }), locks);
    await wait(1);
    expect(await runExclusive('gc', async () => { ran++; }, locks)).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(ran).toBe(1);
    expect(await runExclusive('gc', async () => { ran++; }, locks)).toBe(true); // 끝나면 다시 잡을 수 있다
    expect(ran).toBe(2);
  });
});
