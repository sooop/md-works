import { describe, it, expect } from 'vitest';
import { replaceEverywhere, previewReplace, outcomeText, type ReplaceHost, type DocRef } from '../../src/lib/search/replaceAll';

// 가짜 host: 글 = id → 내용. log 에 호출 순서를 남긴다
function fake(docs: Record<string, string>, o: { partial?: boolean; open?: string; failSnap?: string[]; failWrite?: string[]; failReload?: boolean } = {}) {
  const log: string[] = [];
  const files = new Map(Object.entries(docs));
  const host: ReplaceHost = {
    async list() { log.push('list'); return { refs: [...files.keys()].map((id) => ({ id, label: id })), partial: !!o.partial }; },
    async prepare() { log.push('prepare'); },
    async read(ref: DocRef) { log.push(`read:${ref.id}`); const c = files.get(ref.id); if (c === undefined) throw new Error('없음'); return { content: c, token: c }; },
    async write(ref, content, token) {
      log.push(`write:${ref.id}`);
      if (o.failWrite?.includes(ref.id)) throw new Error('충돌');
      if (files.get(ref.id) !== token) throw new Error('바뀜');
      files.set(ref.id, content);
    },
    async snapshot(ref, content) { log.push(`snap:${ref.id}:${content}`); if (o.failSnap?.includes(ref.id)) throw new Error('이력 실패'); },
    async reloadOpen(ref) { if (ref.id !== o.open) return; log.push(`reload:${ref.id}`); if (o.failReload) throw new Error('편집 중'); },
  };
  return { host, log, files };
}

describe('replaceEverywhere', () => {
  it('글마다 읽기 → 스냅샷(원본) → 쓰기 순서, 바뀐 곳 없는 글은 건드리지 않는다', async () => {
    const { host, log, files } = fake({ a: 'x 하나 x', b: '없음' });
    const out = await replaceEverywhere(host, 'x', {}, 'Y');
    expect(log).toEqual(['prepare', 'list', 'read:a', 'snap:a:x 하나 x', 'write:a', 'read:b']);
    expect(files.get('a')).toBe('Y 하나 Y');
    expect(files.get('b')).toBe('없음');
    expect(out).toMatchObject({ files: 1, replaced: 2, failed: [], reloadFailed: [] });
    expect(outcomeText(out)).toEqual({ text: '글 1개에서 2곳을 바꿨습니다', kind: 'info' });
  });

  it('스냅샷이 실패하면 그 글은 쓰지 않고 나머지는 계속한다', async () => {
    const { host, log, files } = fake({ a: 'x', b: 'x' }, { failSnap: ['a'] });
    const out = await replaceEverywhere(host, 'x', {}, 'Y');
    expect(log).not.toContain('write:a');
    expect(files.get('a')).toBe('x');
    expect(files.get('b')).toBe('Y');
    expect(out.files).toBe(1);
    expect(out.failed.map((f) => f.ref.id)).toEqual(['a']);
    expect(outcomeText(out)).toMatchObject({ kind: 'error', text: expect.stringContaining('1개는 바꾸지 못했습니다') });
  });

  it('쓰기 충돌(부분 실패)도 그 글만 실패로 센다', async () => {
    const { host, files } = fake({ a: 'x', b: 'x', c: 'x' }, { failWrite: ['b'] });
    const out = await replaceEverywhere(host, 'x', {}, 'Y');
    expect([files.get('a'), files.get('b'), files.get('c')]).toEqual(['Y', 'x', 'Y']);
    expect(out).toMatchObject({ files: 2, replaced: 2 });
    expect(out.failed).toEqual([{ ref: { id: 'b', label: 'b' }, error: '충돌' }]);
  });

  it('읽지 못한 글도 실패로 세고 계속한다', async () => {
    const { host, files } = fake({ a: 'x' });
    const h: ReplaceHost = { ...host, async list() { return { refs: [{ id: 'gone', label: 'gone' }, { id: 'a', label: 'a' }], partial: false }; } };
    const out = await replaceEverywhere(h, 'x', {}, 'Y');
    expect(files.get('a')).toBe('Y');
    expect(out.failed.map((f) => f.ref.id)).toEqual(['gone']);
  });

  it('열린 글은 쓴 뒤에 다시 읽게 한다. 다시 읽기가 실패해도 바꾼 것으로 센다', async () => {
    const ok = fake({ a: 'x', b: 'x' }, { open: 'a' });
    await replaceEverywhere(ok.host, 'x', {}, 'Y');
    expect(ok.log.indexOf('reload:a')).toBeGreaterThan(ok.log.indexOf('write:a'));
    expect(ok.log).not.toContain('reload:b');

    const bad = fake({ a: 'x' }, { open: 'a', failReload: true });
    const out = await replaceEverywhere(bad.host, 'x', {}, 'Y');
    expect(out).toMatchObject({ files: 1, replaced: 1, failed: [] });
    expect(out.reloadFailed.map((r) => r.id)).toEqual(['a']);
    expect(outcomeText(out).kind).toBe('error');
  });

  it('검색 상한으로 목록이 잘렸으면 partial 을 알리고 문구에 밝힌다', async () => {
    const { host } = fake({ a: 'x' }, { partial: true });
    const out = await replaceEverywhere(host, 'x', {}, 'Y');
    expect(out.partial).toBe(true);
    expect(outcomeText(out).text).toContain('일부 글만');
  });

  it('코드 블록 안은 바꾸지 않고, 바꿀 곳이 없으면 이력도 남기지 않는다', async () => {
    const { host, log } = fake({ a: '```\nx\n```' });
    const out = await replaceEverywhere(host, 'x', {}, 'Y');
    expect(out.files).toBe(0);
    expect(log.some((l) => l.startsWith('snap'))).toBe(false);
  });

  it('잘못된 정규식은 아무것도 쓰지 않고 실패로 모인다', async () => {
    const { host, log } = fake({ a: 'x' });
    const out = await replaceEverywhere(host, '(', { regex: true }, 'Y');
    expect(out.files).toBe(0);
    expect(log.some((l) => l.startsWith('write'))).toBe(false);
    expect(out.failed).toHaveLength(1);
  });
});

describe('previewReplace', () => {
  it('아무것도 쓰지 않고 글 수·곳 수를 센다', async () => {
    const { host, log } = fake({ a: 'x x', b: 'x', c: 'z' }, { partial: true });
    const p = await previewReplace(host, 'x', {}, 'Y');
    expect(p).toEqual({ files: 2, count: 3, partial: true });
    expect(log.some((l) => l.startsWith('write') || l.startsWith('snap'))).toBe(false);
    expect(log[0]).toBe('prepare');
  });

  it('잘못된 정규식은 error', async () => {
    const { host } = fake({ a: 'x' });
    expect((await previewReplace(host, '(', { regex: true }, '')).error).toBeTruthy();
  });
});
