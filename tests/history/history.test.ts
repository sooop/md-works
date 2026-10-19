import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compress, decompress } from '../../src/lib/history/compress';
import { thinVersions, HOUR, DAY } from '../../src/lib/history/thinning';
import { diffText, applyHunks, blocksOf, inlineDiff } from '../../src/lib/history/diff';
import { useWorksStore, worksStore } from '../../src/lib/works/store';
import { createIdbStore } from '../../src/lib/works/idbStore';
import type { Version as Stored } from '../../src/lib/works/types';
import { snapshot, listVersions, removeHistory, moveHistory, allContents, setVersionName } from '../../src/lib/history';

describe('압축', () => {
  it('한글·이모지·긴 본문 왕복', () => {
    for (const t of ['', 'abc', '안녕하세요 🌏👨‍👩‍👧 글쓰기\n\n둘째 문단', '가나다 '.repeat(50_000)]) {
      const c = compress(t);
      expect(c.enc).toBe('deflate-b64');
      expect(decompress(c.content, c.enc)).toBe(t);
    }
    expect(decompress('원문', 'raw')).toBe('원문');
  });
  it('반복 본문은 실제로 줄어든다', () => {
    const t = '같은 문장입니다. '.repeat(1000);
    expect(compress(t).content.length).toBeLessThan(t.length / 5);
  });
});

describe('솎아내기', () => {
  const now = 100 * DAY;
  const it_ = (id: string, ago: number, name?: string) => ({ id, ts: now - ago, ...(name ? { name } : {}) });
  it('24시간 이내는 전부 유지', () => {
    const items = [it_('a', 1000), it_('b', 2000), it_('c', DAY - 1)];
    expect(thinVersions(items, now)).toEqual([]);
  });
  it('24시간~7일은 시간당 마지막 1개', () => {
    // 시간 경계에 맞춘 두 시간대: now 가 DAY 의 배수라 now-2d 도 시간 정각
    const base = now - 2 * DAY;
    const items = [
      { id: 'h1a', ts: base + 10 * 60_000 }, { id: 'h1b', ts: base + 50 * 60_000 },
      { id: 'h2a', ts: base + HOUR + 5 * 60_000 },
      { id: 'new', ts: now - 1 },
    ];
    expect(thinVersions(items, now)).toEqual(['h1a']);
  });
  it('7일 초과는 일당 마지막 1개, 경계(정확히 7일)는 시간당 규칙', () => {
    const d = now - 10 * DAY;
    const items = [{ id: 'd1', ts: d + HOUR }, { id: 'd2', ts: d + 5 * HOUR }, { id: 'd3', ts: d + 23 * HOUR }, { id: 'e', ts: d + DAY + HOUR }, { id: 'new', ts: now }];
    expect(thinVersions(items, now).sort()).toEqual(['d1', 'd2']);
    const edge = [{ id: 'x', ts: now - 7 * DAY }, { id: 'y', ts: now - 7 * DAY + 60_000 }, { id: 'new', ts: now }];
    // x 는 정확히 7일(일당 규칙), y 는 7일 안(시간당 규칙)이라 서로 다른 버킷 → 둘 다 남는다
    expect(thinVersions(edge, now)).toEqual([]);
  });
  it('이름 붙은 버전과 가장 최근 버전은 지우지 않는다', () => {
    const d = now - 10 * DAY;
    const items = [{ id: 'n', ts: d + HOUR, name: '초고' }, { id: 'o', ts: d + 2 * HOUR }, { id: 'p', ts: d + 3 * HOUR }];
    expect(thinVersions(items, now)).toEqual(['o']); // p 가 그날의 마지막, n 은 이름
    // 전부 오래돼도 최신은 남는다
    expect(thinVersions([{ id: 'a', ts: d }, { id: 'b', ts: d + 1 }], now)).toEqual(['a']);
    expect(thinVersions([], now)).toEqual([]);
  });
});

describe('문단 diff·applyHunks', () => {
  const apply = (ver: string, cur: string, pick: (kinds: string[]) => number[] | 'all') => {
    const hunks = diffText(ver, cur);
    const idx = pick(hunks.map((h) => h.kind));
    const ids = idx === 'all' ? hunks.map((h) => h.id) : idx.map((i) => hunks[i].id);
    return applyHunks(cur, blocksOf(ver), ids);
  };
  it('같으면 hunk 없음, 선택 없으면 현재 그대로', () => {
    expect(diffText('가\n\n나', '가\n\n나')).toEqual([]);
    expect(applyHunks('가\n\n\n나\n', blocksOf('가'), [])).toBe('가\n\n\n나\n');
  });
  it('문단 추가·삭제·변경 분류', () => {
    const ver = '첫째 문단\n\n둘째 문단\n\n셋째 문단';
    const cur = '첫째 문단\n\n새 문단\n\n둘째 문단입니다\n\n셋째 문단';
    const h = diffText(ver, cur);
    expect(h.map((x) => x.kind)).toEqual(['changed']); // 둘째↔새 문단·둘째 문단입니다 가 한 hunk
    const h2 = diffText('가\n\n나\n\n다', '가\n\n다');
    expect(h2.map((x) => x.kind)).toEqual(['removed']);
    const h3 = diffText('가\n\n다', '가\n\n나\n\n다');
    expect(h3.map((x) => x.kind)).toEqual(['added']);
  });
  it('전체 선택하면 버전 본문과 같다(한글)', () => {
    const ver = '# 제목\n\n오늘은 날씨가 맑다.\n\n점심은 비빔밥.\n\n끝';
    const cur = '# 제목\n\n오늘은 날씨가 흐리다.\n\n새로 쓴 문단\n\n끝\n\n덧붙임';
    expect(apply(ver, cur, () => 'all')).toBe(ver);
  });
  it('선택한 hunk 만 되돌린다', () => {
    const ver = 'A\n\nB\n\nC\n\nD';
    const cur = 'A\n\nB2\n\nC\n\nD\n\nE';
    const h = diffText(ver, cur);
    expect(h.map((x) => x.kind)).toEqual(['changed', 'added']);
    expect(applyHunks(cur, blocksOf(ver), [h[0].id])).toBe('A\n\nB\n\nC\n\nD\n\nE');
    expect(applyHunks(cur, blocksOf(ver), [h[1].id])).toBe('A\n\nB2\n\nC\n\nD');
  });
  it('삭제된 문단을 되살린다(끝 문단 포함)', () => {
    expect(apply('가\n\n나\n\n다', '가\n\n다', () => 'all')).toBe('가\n\n나\n\n다');
    expect(apply('가\n\n나', '가', () => 'all')).toBe('가\n\n나');
  });
  it('변경 블록은 단어 단위로 인라인 강조', () => {
    const segs = inlineDiff('오늘은 날씨가 맑다.', '오늘은 날씨가 흐리다.');
    expect(segs.filter((s) => s.type === 'del').map((s) => s.text)).toEqual(['맑다']);
    expect(segs.filter((s) => s.type === 'add').map((s) => s.text)).toEqual(['흐리다']);
    expect(segs.map((s) => s.text).join('')).toContain('오늘은 날씨가 ');
    const h = diffText('가 나 다', '가 라 다');
    expect(h[0].pairs[0].segs.some((s) => s.type === 'add' && s.text === '라')).toBe(true);
  });
});

describe('이력 저장소 통합(IndexedDB)', () => {
  let n = 0;
  beforeEach(() => { useWorksStore(createIdbStore(`hist-test-${n++}`)); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-03-01T00:00:00Z')); });
  afterEach(() => vi.useRealTimers());
  const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

  it('압축 저장되고 listVersions 는 최신순 평문', async () => {
    await snapshot('d1', '첫 본문 🌏');
    advance(6 * 60_000);
    await snapshot('d1', '둘째 본문');
    const raw = await worksStore().list<Stored>('versions', 'd1');
    expect(raw.every((v) => v.enc === 'deflate-b64')).toBe(true);
    expect((await listVersions('d1')).map((v) => v.content)).toEqual(['둘째 본문', '첫 본문 🌏']);
  });
  it('5분 미만·같은 내용은 건너뛰고 force 는 5분 미만도 남긴다', async () => {
    await snapshot('d1', 'a');
    advance(60_000);
    await snapshot('d1', 'b');
    expect(await listVersions('d1')).toHaveLength(1);
    await snapshot('d1', 'b', true);
    expect(await listVersions('d1')).toHaveLength(2);
    advance(10 * 60_000);
    await snapshot('d1', 'b');
    await snapshot('d1', 'b', true);
    expect(await listVersions('d1')).toHaveLength(2);
    await snapshot('d1', '  \n');
    expect(await listVersions('d1')).toHaveLength(2);
  });
  it('저장 후 솎아내기: 오래된 것은 줄고 이름 붙인 버전은 남는다', async () => {
    await snapshot('d1', 'v0');
    const first = (await listVersions('d1'))[0];
    await setVersionName('d1', first.id, '  초고 ');
    // 같은 날(10일 전) 안에 여러 개
    for (let i = 1; i <= 3; i++) { advance(10 * 60_000); await snapshot('d1', `v${i}`); }
    advance(10 * DAY);
    await snapshot('d1', 'now');
    const list = await listVersions('d1');
    expect(list.map((v) => v.content)).toEqual(['now', 'v3', 'v0']);
    expect(list.find((v) => v.content === 'v0')?.name).toBe('초고');
    await setVersionName('d1', first.id, undefined);
    expect((await listVersions('d1')).find((v) => v.content === 'v0')?.name).toBeUndefined();
  });
  it('removeHistory·moveHistory 는 폴더 하위까지, 빈 파티션 이동은 무해', async () => {
    await snapshot('폴더/a.md', 'A');
    await snapshot('폴더/하위/b.md', 'B');
    await snapshot('다른.md', 'C');
    await moveHistory('폴더', '새폴더');
    expect((await listVersions('새폴더/a.md')).map((v) => v.content)).toEqual(['A']);
    expect((await listVersions('새폴더/하위/b.md')).map((v) => v.content)).toEqual(['B']);
    expect(await listVersions('폴더/a.md')).toEqual([]);
    await moveHistory('폴더', '새폴더'); // 서버가 이미 옮긴 뒤 중복 호출
    await moveHistory('없는.md', '어딘가.md');
    expect((await allContents()).sort()).toEqual(['A', 'B', 'C']);
    await removeHistory('새폴더');
    expect(await allContents()).toEqual(['C']);
  });
  it('allContents 는 이미지 참조가 든 평문을 돌려준다', async () => {
    await snapshot('d1', '![](idb:abc-123)');
    expect((await allContents()).some((c) => /idb:([\w-]+)/.exec(c)?.[1] === 'abc-123')).toBe(true);
  });
});
