import { describe, it, expect, vi } from 'vitest';
import { searchBody, containsQuery, splitMarks, createBodyCache, searchVersions, type VersionRef } from '../../src/lib/history/search';

interface V extends VersionRef { body: string }
const mk = (id: string, body: string, ts = 0): V => ({ id, ts, body });
const run = (versions: V[], q: string, opts: Parameters<typeof searchVersions<V>>[3] = {}, read = (v: V) => v.body) =>
  searchVersions(versions, createBodyCache<V>(read), q, opts);
const slice = (text: string, r: [number, number]) => text.slice(r[0], r[1]);

describe('searchBody', () => {
  it('부분 문자열, 기본은 대소문자 무시', () => {
    expect(searchBody('Hello World', 'lo wo')?.count).toBe(1);
    expect(searchBody('Hello World', 'HELLO')?.count).toBe(1);
    expect(searchBody('abc', 'x')).toBeUndefined();
    expect(searchBody('abc', '')).toBeUndefined();
  });
  it('대소문자 구분 옵션', () => {
    expect(searchBody('Hello hello', 'hello', { caseSensitive: true })?.count).toBe(1);
    expect(searchBody('Hello', 'hello', { caseSensitive: true })).toBeUndefined();
  });
  it('한글은 NFC 로 맞춰 비교(분해형 입력도 찾는다)', () => {
    const nfd = '한글'.normalize('NFD');
    expect(nfd).not.toBe('한글');
    expect(searchBody('오늘의 한글 문장', nfd)?.count).toBe(1);
    expect(searchBody(`오늘의 ${nfd} 문장`, '한글')?.count).toBe(1);
    expect(containsQuery(`가${nfd}`, '한글')).toBe(true);
  });
  it('건수는 모든 일치(겹치지 않게), 발췌는 줄마다 최대 3개', () => {
    const body = ['aa aa', '없음', 'aa', 'aa', 'aa'].join('\n');
    const r = searchBody(body, 'aa')!;
    expect(r.count).toBe(5);
    expect(r.excerpts).toHaveLength(3);
    expect(r.excerpts.map((e) => e.line)).toEqual([1, 3, 4]);
    expect(r.excerpts[0].ranges).toEqual([[0, 2], [3, 5]]);
    expect(searchBody('aaaa', 'aa')?.count).toBe(2);
  });
  it('구간 위치가 text 안에서 정확하다', () => {
    const r = searchBody('앞 문장입니다. 지웠던 문장이 여기 있다. 뒤', '지웠던 문장')!;
    const e = r.excerpts[0];
    expect(e.ranges).toHaveLength(1);
    expect(slice(e.text, e.ranges[0])).toBe('지웠던 문장');
    const up = searchBody('Say HELLO now', 'hello')!.excerpts[0];
    expect(slice(up.text, up.ranges[0])).toBe('HELLO'); // 원문 글자 그대로
  });
  it('긴 줄은 앞뒤를 자르고 …를 붙이되 위치는 맞다', () => {
    const line = 'x'.repeat(200) + '찾는말' + 'y'.repeat(200);
    const e = searchBody(line, '찾는말')!.excerpts[0];
    expect(e.text.startsWith('…')).toBe(true);
    expect(e.text.endsWith('…')).toBe(true);
    expect(e.text.length).toBeLessThan(line.length / 2);
    expect(slice(e.text, e.ranges[0])).toBe('찾는말');
    // 앞쪽에서 시작하면 앞 …는 없다
    const head = searchBody('찾는말' + 'y'.repeat(300), '찾는말')!.excerpts[0];
    expect(head.text.startsWith('…')).toBe(false);
    expect(head.ranges[0]).toEqual([0, 3]);
    // 같은 줄의 뒤쪽 일치가 창 밖이면 구간에서 빠진다
    const far = searchBody('k' + 'y'.repeat(300) + 'k', 'k')!;
    expect(far.count).toBe(2);
    expect(far.excerpts[0].ranges).toHaveLength(1);
  });
  it('줄바꿈 종류와 상관없이 줄 번호를 센다', () => {
    expect(searchBody('a\r\nb\rc\nkey', 'key')!.excerpts[0].line).toBe(4);
  });
  it('소문자로 길이가 변하는 글자가 있어도 위치가 어긋나지 않는다', () => {
    const e = searchBody('İİ abc', 'abc')!.excerpts[0];
    expect(slice(e.text, e.ranges[0])).toBe('abc');
  });
});

describe('splitMarks', () => {
  it('일치/불일치 조각으로 나누고 이으면 원문', () => {
    const p = splitMarks('가나다 가나', '가나');
    expect(p.map((x) => x.t).join('')).toBe('가나다 가나');
    expect(p.filter((x) => x.hit).map((x) => x.t)).toEqual(['가나', '가나']);
    expect(splitMarks('abc', '').every((x) => !x.hit)).toBe(true);
    expect(splitMarks('', 'a')).toEqual([{ t: '', hit: false }]);
  });
});

describe('searchVersions', () => {
  const list = [mk('c', 'Alpha 문장\n둘째', 3), mk('b', '아무것도 없음', 2), mk('a', 'alpha\nALPHA 끝', 1)];

  it('일치하는 버전만, 입력(최근순) 순서를 유지한다', async () => {
    const r = (await run(list, 'alpha'))!;
    expect(r.hits.map((h) => h.versionId)).toEqual(['c', 'a']);
    expect(r.hits.map((h) => h.count)).toEqual([1, 2]);
    expect(r.skipped).toBe(0);
  });
  it('일치가 없으면 빈 결과', async () => {
    expect((await run(list, '없는말'))!.hits).toEqual([]);
  });
  it('대소문자 구분 옵션이 결과를 바꾼다', async () => {
    const r = (await run(list, 'alpha', { caseSensitive: true }))!;
    expect(r.hits.map((h) => h.versionId)).toEqual(['a']);
    expect(r.hits[0].count).toBe(1);
  });
  it('현재 글에 없음/있음 판정', async () => {
    expect((await run(list, 'alpha', { current: '지금은 다른 글' }))!.inCurrent).toBe(false);
    expect((await run(list, 'alpha', { current: '지금도 ALPHA 가 있다' }))!.inCurrent).toBe(true);
    expect((await run(list, 'alpha', { current: '지금도 ALPHA', caseSensitive: true }))!.inCurrent).toBe(false);
    expect((await run(list, 'alpha'))!.inCurrent).toBeUndefined();
  });
  it('빈 검색어는 아무것도 찾지 않는다', async () => {
    expect((await run(list, ''))!.hits).toEqual([]);
  });

  it('캐시: 같은 버전은 검색어를 바꿔도 한 번만 푼다, clear 하면 다시 푼다', async () => {
    const read = vi.fn((v: V) => v.body);
    const cache = createBodyCache<V>(read);
    await searchVersions(list, cache, 'alpha');
    await searchVersions(list, cache, '문장');
    await searchVersions(list, cache, 'alpha', { caseSensitive: true });
    expect(read).toHaveBeenCalledTimes(3);
    expect(cache.size).toBe(3);
    cache.clear();
    await searchVersions(list, cache, 'alpha');
    expect(read).toHaveBeenCalledTimes(6);
  });

  it('취소: 검색 도중 취소하면 결과를 내지 않고 더 풀지 않는다', async () => {
    const many = Array.from({ length: 50 }, (_, i) => mk(`v${i}`, 'abc', 50 - i));
    const ac = new AbortController();
    const read = vi.fn((v: V) => v.body);
    let ticks = 0;
    const r = await searchVersions(many, createBodyCache<V>(read), 'abc', {
      signal: ac.signal, budgetMs: 0,
      yieldFn: async () => { if (++ticks === 3) ac.abort(); },
    });
    expect(r).toBeNull();
    expect(read.mock.calls.length).toBeLessThan(many.length);
  });
  it('취소: 시작 전에 이미 취소됐으면 null', async () => {
    const ac = new AbortController();
    ac.abort();
    expect(await run(list, 'alpha', { signal: ac.signal })).toBeNull();
  });
  it('시간 예산을 넘기면 양보하고 진행 상황을 알린다', async () => {
    const many = Array.from({ length: 10 }, (_, i) => mk(`v${i}`, 'abc', i));
    const yieldFn = vi.fn(async () => {});
    const seen: number[] = [];
    let t = 0;
    const r = await searchVersions(many, createBodyCache<V>((v) => v.body), 'abc', {
      budgetMs: 16, now: () => (t += 10), yieldFn, onProgress: (p) => seen.push(p.done),
    });
    expect(r!.hits).toHaveLength(10);
    expect(yieldFn.mock.calls.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(10);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('깨진 버전(해제 실패)은 건너뛰고 나머지를 계속 찾는다', async () => {
    const broken = [mk('c', 'alpha 1', 3), mk('x', 'alpha', 2), mk('a', 'alpha 2', 1)];
    const read = (v: V) => { if (v.id === 'x') throw new Error('inflate 실패'); return v.body; };
    const r = (await run(broken, 'alpha', {}, read))!;
    expect(r.hits.map((h) => h.versionId)).toEqual(['c', 'a']);
    expect(r.skipped).toBe(1);
  });
  it('깨진 버전도 다시 풀어 보지 않는다', async () => {
    const read = vi.fn((): string => { throw new Error('x'); });
    const cache = createBodyCache<V>(read);
    await searchVersions([mk('x', 'a')], cache, 'a');
    await searchVersions([mk('x', 'a')], cache, 'b');
    expect(read).toHaveBeenCalledTimes(1);
  });
});
