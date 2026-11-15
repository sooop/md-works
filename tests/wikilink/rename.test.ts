import { describe, it, expect, vi } from 'vitest';
import { fixLinksAfterMove, movePairs } from '../../src/lib/wikilink/rename';
import type { LinkHost } from '../../src/lib/wikilink/host';

// 이동 뒤의 상태를 흉내 낸 호스트: files 는 key(=경로) → 본문
function fakeHost(files: Record<string, string>, opts: { failOn?: string[]; candidates?: string[] } = {}) {
  const writes: Record<string, string> = {};
  const host: LinkHost = {
    docs: () => Object.keys(files).map((k) => ({ key: k, path: k.replace(/\.md$/, '') })),
    current: () => null,
    open: () => {},
    create: async () => {},
    candidates: opts.candidates ? async () => opts.candidates : undefined,
    read: vi.fn(async (k: string) => files[k] ?? null),
    write: vi.fn(async (k: string, t: string) => { if (opts.failOn?.includes(k)) return false; writes[k] = t; return true; }),
  };
  return { host, writes };
}

describe('fixLinksAfterMove', () => {
  it('그 글을 가리키던 글만 고쳐 저장한다', async () => {
    const { host, writes } = fakeHost({
      '회의록.md': '새 이름',
      '일지.md': '오늘 [[회의]] 와 [[딴글|라벨]]',
      '딴글.md': '링크 없음',
    });
    const r = await fixLinksAfterMove(host, [{ from: '회의.md', to: '회의록.md' }]);
    expect(r).toEqual({ docs: 1, links: 1, failed: 0 });
    expect(writes).toEqual({ '일지.md': '오늘 [[회의록]] 와 [[딴글|라벨]]' });
  });

  it('가리키는 글이 하나도 없으면 아무 저장도 하지 않는다', async () => {
    const { host } = fakeHost({ 'a.md': '[[b]]', 'b.md': '', 'c.md': '글' });
    const r = await fixLinksAfterMove(host, [{ from: 'x.md', to: 'c.md' }]);
    expect(r).toEqual({ docs: 0, links: 0, failed: 0 });
    expect(host.write).not.toHaveBeenCalled();
  });

  it('이름이 그대로인 폴더 이동은 이름형 링크를 건드리지 않는다', async () => {
    const { host } = fakeHost({ 'b/기획.md': '', '일지.md': '[[기획]]' });
    const r = await fixLinksAfterMove(host, [{ from: 'a/기획.md', to: 'b/기획.md' }]);
    expect(r.links).toBe(0);
    expect(host.write).not.toHaveBeenCalled();
  });

  it('폴더 이름 변경: 여러 글의 경로형 링크를 한 번에 고친다', async () => {
    const { host, writes } = fakeHost({
      '새/가.md': '', '새/나.md': '',
      '일지.md': '[[옛/가]] [[옛/나|표시]] [[다]]',
      '다.md': '',
    });
    const r = await fixLinksAfterMove(host, [{ from: '옛/가.md', to: '새/가.md' }, { from: '옛/나.md', to: '새/나.md' }]);
    expect(r).toEqual({ docs: 1, links: 2, failed: 0 });
    expect(writes['일지.md']).toBe('[[새/가]] [[새/나|표시]] [[다]]');
  });

  it('저장하지 못한 글 수를 세고 나머지는 계속한다', async () => {
    const { host, writes } = fakeHost(
      { '회의록.md': '', 'a.md': '[[회의]]', 'b.md': '[[회의]]' },
      { failOn: ['a.md'] },
    );
    const r = await fixLinksAfterMove(host, [{ from: '회의.md', to: '회의록.md' }]);
    expect(r).toEqual({ docs: 1, links: 1, failed: 1 });
    expect(writes).toEqual({ 'b.md': '[[회의록]]' });
  });

  it('후보 목록이 있으면 그 글만 읽는다', async () => {
    const { host } = fakeHost({ '회의록.md': '', 'a.md': '[[회의]]', 'b.md': '[[회의]]' }, { candidates: ['b.md'] });
    await fixLinksAfterMove(host, [{ from: '회의.md', to: '회의록.md' }]);
    expect(host.read).toHaveBeenCalledTimes(1);
    expect(host.read).toHaveBeenCalledWith('b.md');
  });

  it('이름이 바뀐 글 자신의 자기 링크도 고친다', async () => {
    const { host, writes } = fakeHost({ '회의록.md': '나는 [[회의]]' });
    await fixLinksAfterMove(host, [{ from: '회의.md', to: '회의록.md' }]);
    expect(writes['회의록.md']).toBe('나는 [[회의록]]');
  });
});

describe('movePairs', () => {
  it('글 하나', () => expect(movePairs(['a/x.md'], 'a/x.md', 'b/x.md')).toEqual([{ from: 'a/x.md', to: 'b/x.md' }]));
  it('폴더 아래의 글(.md 만)', () => {
    expect(movePairs(['옛/가.md', '옛/하위/나.md', '옛/그림.png'], '옛', '새')).toEqual([
      { from: '옛/가.md', to: '새/가.md' }, { from: '옛/하위/나.md', to: '새/하위/나.md' },
    ]);
  });
});
