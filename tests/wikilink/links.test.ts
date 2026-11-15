import { describe, it, expect, vi, afterEach } from 'vitest';
import { LinkCache, backlinksFromSources, backlinksFromLines, outgoingLinks, snippetAround } from '../../src/lib/wikilink/links';
import * as parse from '../../src/lib/wikilink/parse';
import { createServerLinkHost } from '../../src/lib/wikilink/serverHost';

const docs = [{ path: '회의록' }, { path: 'a/기획' }, { path: 'b/기획' }, { path: '일지' }];

describe('snippetAround', () => {
  it('링크 앞뒤를 잘라 한 줄 문맥으로', () => {
    const line = '가'.repeat(60) + ' [[회의록]] ' + '나'.repeat(60);
    const from = line.indexOf('[[');
    const s = snippetAround(line, from, from + 7);
    expect(s.hit).toBe('[[회의록]]');
    expect(s.before.startsWith('…')).toBe(true);
    expect(s.after.endsWith('…')).toBe(true);
    expect(s.before.length).toBeLessThan(60);
  });
});

describe('backlinksFromSources', () => {
  const sources = [
    { key: '1', path: '일지', content: '첫 줄\n오늘 [[회의록]] 을 썼다\n[[a/기획]]' },
    { key: '2', path: '회의록', content: '자기 [[회의록]]' },
    { key: '3', path: 'a/기획', content: '```\n[[회의록]]\n```\n`[[회의록]]` [[회의록|표시]]' },
  ];

  it('이 글을 가리키는 글과 줄·문맥을 모은다(자기 자신·코드 안 제외)', () => {
    const r = backlinksFromSources('회의록', sources, docs, new LinkCache());
    expect(r.map((g) => g.path).sort()).toEqual(['a/기획', '일지']);
    const log = r.find((g) => g.path === '일지')!, plan = r.find((g) => g.path === 'a/기획')!;
    expect(log.items).toHaveLength(1);
    expect(log.items[0].line).toBe(2);
    expect(log.items[0].snip).toEqual({ before: '오늘 ', hit: '[[회의록]]', after: ' 을 썼다' });
    expect(plan.items[0].line).toBe(4);
  });

  it('이름이 모호한 링크는 어느 쪽의 역링크도 아니다', () => {
    const r = backlinksFromSources('a/기획', [{ key: '1', path: '일지', content: '[[기획]]' }], docs, new LinkCache());
    expect(r).toEqual([]);
  });

  it('내용이 같은 글은 다시 추출하지 않는다(캐시)', () => {
    const spy = vi.spyOn(parse, 'extractWikiLinks');
    const cache = new LinkCache();
    backlinksFromSources('회의록', sources, docs, cache);
    const first = spy.mock.calls.length;
    backlinksFromSources('회의록', sources, docs, cache);
    expect(spy.mock.calls.length).toBe(first);
    const changed = sources.map((s) => (s.key === '1' ? { ...s, content: s.content + ' ' } : s));
    backlinksFromSources('회의록', changed, docs, cache);
    expect(spy.mock.calls.length).toBe(first + 1);
    spy.mockRestore();
  });
});

describe('backlinksFromLines (서버)', () => {
  it('검색으로 얻은 줄에서 이 글을 가리키는 링크만 남긴다', () => {
    const hits = [
      { key: '일지.md', path: '일지', line: 3, text: '앞 [[회의록]] 뒤' },
      { key: '일지.md', path: '일지', line: 9, text: '[[a/기획]]' },
      { key: 'a/기획.md', path: 'a/기획', line: 1, text: '[[회의록|표시]] [[회의록]]' },
      { key: '회의록.md', path: '회의록', line: 1, text: '[[회의록]]' },
    ];
    const r = backlinksFromLines('회의록', docs, hits);
    expect(r.map((g) => [g.path, g.items.map((i) => i.line)]).sort()).toEqual([['a/기획', [1, 1]], ['일지', [3]]].sort());
  });
});

describe('outgoingLinks', () => {
  it('같은 대상은 묶고 있음·없음·모호를 구분한다', () => {
    const r = outgoingLinks('[[회의록]] [[회의록|또]] [[기획]] [[없는 글]]', docs);
    expect(r.map((o) => [o.target, o.res.kind, o.count])).toEqual([
      ['회의록', 'ok', 2], ['기획', 'ambiguous', 1], ['없는 글', 'missing', 1],
    ]);
  });
});

describe('서버 호스트 검색', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 409, json: async () => body }));
  const deps = { paths: () => [], openPath: () => '', content: () => '', save: async () => true, restore: async () => {}, open: async () => {}, create: async () => {} };

  it('상한(truncated)이 있으면 candidates 는 전부 훑게 undefined', async () => {
    vi.stubGlobal('fetch', reply({ results: [{ path: 'a.md', matches: [], more: false }], count: 500, truncated: true }));
    expect(await createServerLinkHost(deps).candidates!()).toBeUndefined();
  });

  it('상한이 없으면 `[[` 가 든 파일(과 열린 글)만', async () => {
    vi.stubGlobal('fetch', reply({ results: [{ path: 'a.md', matches: [], more: false }], count: 1, truncated: false }));
    expect((await createServerLinkHost({ ...deps, openPath: () => 'b.md' }).candidates!())!.sort()).toEqual(['a.md', 'b.md']);
  });

  it('searchLines 는 줄을 모으고 파일당 상한(more)도 truncated 로 알린다', async () => {
    const f = reply({ results: [{ path: 'x/일지.md', matches: [{ line: 4, text: '[[회의록]]' }], more: true }], count: 1, truncated: false });
    vi.stubGlobal('fetch', f);
    const r = await createServerLinkHost(deps).searchLines!('회의록', new AbortController().signal);
    expect(r).toEqual({ hits: [{ key: 'x/일지.md', path: 'x/일지', line: 4, text: '[[회의록]]' }], truncated: true });
    const url = decodeURIComponent((f.mock.calls[0] as unknown[])[0] as string);
    expect(url).toContain('re=1');
    expect(url).toContain('회의록');
  });

  it('읽지 않은 글은 쓰지 않고, 서버가 거절하면 false', async () => {
    const h = createServerLinkHost(deps);
    vi.stubGlobal('fetch', reply({ content: '원문', mtime: 5 }));
    expect(await h.write('a.md', 'x')).toBe(false); // 읽기 전
    expect(await h.read('a.md')).toBe('원문');
    vi.stubGlobal('fetch', reply({ message: '충돌' }, false));
    expect(await h.write('a.md', '바꿈')).toBe(false);
  });
});
