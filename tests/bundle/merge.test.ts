import { describe, it, expect } from 'vitest';
import { classifyDoc, mergeRecords, mergeVersions, preMergeName, preMergeVersion, remoteWins, contentHash } from '../../src/lib/bundle/merge';
import { decompress } from '../../src/lib/history/compress';
import { DAY, HOUR } from '../../src/lib/history/thinning';
import type { Snippet, Version } from '../../src/lib/works/types';
import { ver } from './helpers';

describe('classifyDoc: 글 병합 분류', () => {
  it('로컬에 없으면 add', () => {
    expect(classifyDoc(undefined, { content: 'x', updatedAt: 1 })).toEqual({ action: 'add', winner: 'remote' });
    expect(classifyDoc(undefined, { content: '' })).toEqual({ action: 'add', winner: 'remote' }); // 시각이 없어도
  });
  it('내용이 같으면 시각과 관계없이 same', () => {
    expect(classifyDoc({ content: 'a', updatedAt: 5 }, { content: 'a', updatedAt: 9 }).action).toBe('same');
    expect(classifyDoc({ content: 'a', updatedAt: 5 }, { content: 'a' }).action).toBe('same');
  });
  it('번들이 확실히 최신이면 update(번들이 이긴다)', () => {
    expect(classifyDoc({ content: 'a', updatedAt: 5 }, { content: 'b', updatedAt: 6 })).toEqual({ action: 'update', winner: 'remote' });
  });
  it('로컬이 확실히 최신이면 keep-local', () => {
    expect(classifyDoc({ content: 'a', updatedAt: 6 }, { content: 'b', updatedAt: 5 })).toEqual({ action: 'keep-local', winner: 'local' });
  });
  it('같은 시각이거나 번들에 시각이 없으면 conflict (로컬을 지킨다)', () => {
    expect(classifyDoc({ content: 'a', updatedAt: 5 }, { content: 'b', updatedAt: 5 })).toEqual({ action: 'conflict', winner: 'local' });
    expect(classifyDoc({ content: 'a', updatedAt: 5 }, { content: 'b' })).toEqual({ action: 'conflict', winner: 'local' });
  });
  it('줄바꿈만 달라도 다른 내용이다(정규화하지 않는다)', () => {
    expect(classifyDoc({ content: 'a\nb', updatedAt: 1 }, { content: 'a\r\nb', updatedAt: 2 }).action).toBe('update');
  });
});

const s = (id: string, updatedAt: number, over: Partial<Snippet> = {}): Snippet =>
  ({ id, body: id, color: 'yellow', createdAt: 1, updatedAt, attachedDocs: [], ...over });

describe('mergeRecords: 글감·스레드', () => {
  it('updatedAt 큰 쪽이 이긴다', () => {
    expect(remoteWins(s('a', 1), s('a', 2))).toBe(true);
    expect(remoteWins(s('a', 2), s('a', 1))).toBe(false);
  });
  it('같은 시각이면 deletedAt 있는 쪽이 이긴다(삭제가 되살아남을 이긴다)', () => {
    expect(remoteWins(s('a', 5), s('a', 5, { deletedAt: 5 }))).toBe(true);
    expect(remoteWins(s('a', 5, { deletedAt: 5 }), s('a', 5))).toBe(false);
    expect(remoteWins(s('a', 5), s('a', 5))).toBe(false);
  });
  it('없는 id 는 추가, 로컬에만 있는 것은 유지(keepLocal), 같은 것은 same', () => {
    const r = mergeRecords([s('a', 1), s('b', 5), s('c', 3), s('only', 1)], [s('a', 2), s('b', 4), s('c', 3), s('new', 1)]);
    expect(r.add.map((x) => x.id)).toEqual(['new']);
    expect(r.update.map((x) => x.id)).toEqual(['a']);
    expect(r.same).toBe(1); // c
    expect(r.keepLocal).toBe(2); // b(로컬이 최신) + only(로컬에만)
  });
  it('번들 안의 중복 id 는 한 번만 센다', () => {
    const r = mergeRecords([], [s('a', 1), s('a', 9)]);
    expect(r.add).toHaveLength(1);
  });
  it('묘비(purged)도 같은 규칙으로 이긴다 — 되살아나지 않는다', () => {
    const tomb = s('x', 10, { body: '', purged: true, deletedAt: 10 });
    const r = mergeRecords([s('x', 5)], [tomb]);
    expect(r.update).toEqual([tomb]);
    // 반대로 번들에 옛 레코드가 있어도 로컬 묘비가 이긴다
    const r2 = mergeRecords([tomb], [s('x', 5)]);
    expect(r2.update).toEqual([]);
    expect(r2.keepLocal).toBe(1);
  });
  it('빈 입력', () => {
    expect(mergeRecords([], [])).toEqual({ add: [], update: [], same: 0, keepLocal: 0 });
  });
});

describe('mergeVersions: 이력 합집합 + 솎아내기', () => {
  const now = 100 * DAY;
  const v = (id: string, ts: number, extra: Partial<Version> = {}) => ver(id, 'd', id, ts, extra);

  it('id 합집합: 새 id 만 추가하고 같은 id 는 same', () => {
    const r = mergeVersions([v('a', now - 10), v('b', now - 5)], [v('b', now - 5), v('c', now - 1)], now);
    expect(r.put.map((x) => x.id)).toEqual(['c']);
    expect(r.add).toBe(1);
    expect(r.same).toBe(1);
    expect(r.remove).toEqual([]);
  });
  it('같은 id 라도 번들의 updatedAt 이 크면(이름 변경) 갱신한다', () => {
    const r = mergeVersions([v('a', now - 10)], [{ ...v('a', now - 10), name: '고정', updatedAt: now }], now);
    expect(r.put).toHaveLength(1);
    expect(r.put[0].name).toBe('고정');
    expect(r.add).toBe(0);
  });
  it('합친 뒤 솎아내기 규칙을 다시 돌린다 — 같은 시간대의 옛 버전은 지워진다', () => {
    const base = now - 2 * DAY; // 시간당 구간
    const local = [v('l1', base + 10 * 60_000), v('newest', now - 1)];
    const remote = [v('r1', base + 50 * 60_000)]; // 같은 시간대의 더 나중 버전
    const r = mergeVersions(local, remote, now);
    expect(r.remove).toEqual(['l1']);
    expect(r.put.map((x) => x.id)).toEqual(['r1']);
  });
  it('번들 쪽 버전이 솎아내기로 지워질 것이면 아예 쓰지 않는다', () => {
    const base = now - 2 * DAY;
    const local = [v('l', base + 50 * 60_000), v('newest', now - 1)];
    const r = mergeVersions(local, [v('r', base + 10 * 60_000)], now);
    expect(r.put).toEqual([]);
    expect(r.add).toBe(0);
    expect(r.remove).toEqual([]);
  });
  it('이름 붙은 버전은 솎아내지 않는다', () => {
    const base = now - 2 * DAY;
    const r = mergeVersions([v('l', base + 10 * 60_000, { name: '초고' }), v('newest', now - 1)], [v('r', base + HOUR - 1)], now);
    expect(r.remove).toEqual([]);
  });
  it('빈 입력과 로컬이 비어 있는 경우', () => {
    expect(mergeVersions([], [], now)).toEqual({ put: [], remove: [], add: 0, same: 0 });
    expect(mergeVersions([], [v('a', now)], now).add).toBe(1);
  });
});

describe('병합 전 버전', () => {
  it("이름은 '병합 전(YYYY-MM-DD)', 이력 본문은 압축되어 원문 그대로 복원된다", () => {
    const now = new Date(2026, 9, 5, 12).getTime();
    expect(preMergeName(now)).toBe('병합 전(2026-10-05)');
    const x = preMergeVersion('a.md', 'key', '진 쪽 본문 가나다', 123, now);
    expect(x).toMatchObject({ docKey: 'key', ts: 123, name: '병합 전(2026-10-05)', enc: 'deflate-b64' });
    expect(decompress(x.content, x.enc)).toBe('진 쪽 본문 가나다');
    expect(preMergeVersion('a.md', 'key', 't', undefined, now).ts).toBe(now);
  });
  it('id 는 글 이름과 내용에서 정해지고 서버 id 규칙에 맞는다(되풀이 가져오기가 버전을 늘리지 않는다)', () => {
    const a = preMergeVersion('a.md', 'k1', 'x', 1, 1);
    const b = preMergeVersion('a.md', 'k2', 'x', 2, 2);
    expect(a.id).toBe(b.id); // docKey·시각이 달라도 같은 글·같은 내용이면 같다
    expect(a.id).not.toBe(preMergeVersion('b.md', 'k1', 'x', 1, 1).id);
    expect(a.id).not.toBe(preMergeVersion('a.md', 'k1', 'y', 1, 1).id);
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{1,80}$/);
    expect(contentHash('가나다')).toHaveLength(26);
  });
});
