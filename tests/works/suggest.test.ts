import { describe, it, expect } from 'vitest';
import { rankByText, tokenize, localProvider, setSuggestProvider, suggestProvider, type SuggestProvider } from '../../src/lib/works/suggest';
import { filterSnippets, findByPhrase, matchSnippet, snippetText, splitBody, asUrl, suggestCandidates } from '../../src/lib/snippets/filter';
import { fitSize } from '../../src/lib/snippets/image';
import type { Snippet } from '../../src/lib/works/types';

const mk = (id: string, body: string, extra: Partial<Snippet> = {}): Snippet => ({
  id, body, color: 'yellow', createdAt: 1, updatedAt: 1, attachedDocs: [], ...extra,
});

describe('rankByText', () => {
  const cands = [
    { id: 'a', text: '글감이 쌓이면 글을 쓰기 쉽다' },
    { id: 'b', text: '오늘 점심은 김치찌개를 먹었다' },
    { id: 'c', text: '글감을 모아 두는 보관함' },
    { id: 'd', text: 'completely unrelated english text' },
  ];
  it('조사 변형("글감을"/"글감이")도 2-gram 으로 매칭한다', () => {
    const r = rankByText('글감을', cands);
    expect(r.map((x) => x.id)).toContain('a');
    expect(r.map((x) => x.id)).toContain('c');
  });
  it('무관한 문서와 점수 0 은 제외한다', () => {
    const ids = rankByText('글감을', cands).map((x) => x.id);
    expect(ids).not.toContain('b');
    expect(ids).not.toContain('d');
  });
  it('점수 내림차순이고 정확히 같은 단어가 더 높다', () => {
    const r = rankByText('글감을 모아 두는', cands);
    expect(r[0].id).toBe('c');
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
  });
  it('topN 으로 자르고 빈 입력은 빈 배열', () => {
    expect(rankByText('글감', cands, 1)).toHaveLength(1);
    expect(rankByText('', cands)).toEqual([]);
    expect(rankByText('글감', [])).toEqual([]);
  });
  it('대소문자를 무시하고 이미지 data URL 은 토큰으로 세지 않는다', () => {
    const r = rankByText('Hello World', [{ id: 'x', text: 'hello world' }, { id: 'y', text: '![](data:image/png;base64,aGVsbG8gd29ybGQ=)' }]);
    expect(r.map((x) => x.id)).toEqual(['x']);
  });
  it('tokenize: 단어와 2-gram', () => {
    const t = tokenize('글감을');
    expect(t.has('w:글감을')).toBe(true);
    expect(t.has('b:글감')).toBe(true);
    expect(t.has('b:감을')).toBe(true);
  });
});

describe('SuggestProvider', () => {
  it('기본은 로컬 구현이고 교체·복원할 수 있다', async () => {
    expect(suggestProvider()).toBe(localProvider);
    expect(await localProvider.rank('글감', [{ id: 'a', text: '글감 하나' }], 5)).toHaveLength(1);
    const p: SuggestProvider = { name: 'fake', rank: async () => [{ id: 'z', score: 1 }] };
    setSuggestProvider(p);
    expect(suggestProvider().name).toBe('fake');
    setSuggestProvider(null);
    expect(suggestProvider()).toBe(localProvider);
  });
});

describe('글감 필터·검색', () => {
  const a = mk('a', '첫 번째 글감 메모', { attachedDocs: ['d1'], color: 'blue' });
  const b = mk('b', 'Hello World', { source: { url: 'https://Example.com/x', title: '참고 자료' }, attachedDocs: ['d2'] });
  const t = mk('t', '버린 글감', { deletedAt: 5 });
  const q = { view: 'all' as const, docKey: 'd1', color: '' as const, query: '' };

  it('보기: 이 글에 붙은 것 / 전체 / 휴지통', () => {
    expect(filterSnippets([a, b], [t], { ...q, view: 'doc' }).map((s) => s.id)).toEqual(['a']);
    expect(filterSnippets([a, b], [t], q).map((s) => s.id)).toEqual(['a', 'b']);
    expect(filterSnippets([a, b], [t], { ...q, view: 'trash' }).map((s) => s.id)).toEqual(['t']);
    expect(filterSnippets([a, b], [t], { ...q, view: 'doc', docKey: '' })).toEqual([]);
  });
  it('색 필터와 검색(본문·원전 제목·URL, 대소문자 무시, 초성)', () => {
    expect(filterSnippets([a, b], [], { ...q, color: 'blue' }).map((s) => s.id)).toEqual(['a']);
    expect(filterSnippets([a, b], [], { ...q, query: 'hello' }).map((s) => s.id)).toEqual(['b']);
    expect(filterSnippets([a, b], [], { ...q, query: 'EXAMPLE.com' }).map((s) => s.id)).toEqual(['b']);
    expect(filterSnippets([a, b], [], { ...q, query: '참고' }).map((s) => s.id)).toEqual(['b']);
    expect(filterSnippets([a, b], [], { ...q, query: 'ㄱㄱ' }).map((s) => s.id)).toEqual(['a']);
    expect(filterSnippets([a, b], [t], { ...q, view: 'trash', query: '버린' }).map((s) => s.id)).toEqual(['t']);
  });
  it('여러 단어는 모두 있어야 하고, 이미지 data 는 검색 대상이 아니다', () => {
    expect(matchSnippet(a, '첫 메모')).toBe(true);
    expect(matchSnippet(a, '첫 없는말')).toBe(false);
    const img = mk('i', '그림 ![](data:image/webp;base64,QUJDREVGRw==)');
    expect(snippetText(img)).not.toContain('QUJD');
  });
  it('문구 검색은 관련도 순, 휴지통·무관 글감 제외', () => {
    const x = mk('x', '글감을 정리하는 방법');
    const y = mk('y', '글감 보관함 정리');
    const z = mk('z', 'zzz');
    expect(findByPhrase('글감을 정리', [z, y, x]).map((s) => s.id)).toEqual(['x', 'y']);
  });
  it('유사 후보에서 자신을 뺀다', () => {
    expect(suggestCandidates(a, [a, b]).map((c) => c.id)).toEqual(['b']);
  });
});

describe('보조 함수', () => {
  it('asUrl', () => {
    expect(asUrl(' https://a.test/x?y=1 ')).toBe('https://a.test/x?y=1');
    expect(asUrl('그냥 글 https://a.test')).toBeNull();
  });
  it('splitBody 는 텍스트와 이미지로 나눈다', () => {
    expect(splitBody('앞 ![a](data:image/png;base64,AA==) 뒤')).toEqual([
      { type: 'text', v: '앞 ' }, { type: 'img', v: 'data:image/png;base64,AA==', alt: 'a' }, { type: 'text', v: ' 뒤' },
    ]);
  });
  it('fitSize 는 1600px 이하로 비율 유지, 확대하지 않는다', () => {
    expect(fitSize(3200, 1600)).toEqual({ w: 1600, h: 800 });
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 });
  });
});
