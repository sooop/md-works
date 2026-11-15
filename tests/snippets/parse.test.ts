import { describe, it, expect } from 'vitest';
import { parseSnippet, editableText } from '../../src/lib/snippets/parse';

describe('parseSnippet', () => {
  it('# 줄은 제목, @ 줄은 원전', () => {
    const r = parseSnippet('# 문단 구성론\n본문 한 줄\n@김훈, 칼의 노래 p.32');
    expect(r.title).toBe('문단 구성론');
    expect(r.rest).toBe('본문 한 줄');
    expect(r.source).toEqual({ label: '김훈, 칼의 노래 p.32', url: '' });
  });
  it('URL 만 있는 줄도 원전', () => {
    expect(parseSnippet('https://example.com/a\n본문').source).toEqual({ label: '', url: 'https://example.com/a' });
  });
  it('마커가 여럿이면 처음 것만 인정하고 나머지는 본문에 남는다', () => {
    const r = parseSnippet('@첫 출처\nhttps://b.c\n@둘째\n# 제목1\n# 제목2');
    expect(r.source).toEqual({ label: '첫 출처', url: '' });
    expect(r.title).toBe('제목1');
    expect(r.rest).toBe('https://b.c\n@둘째\n# 제목2');
  });
  it('@ 줄에 글자와 URL 이 같이 있으면 둘 다', () => {
    expect(parseSnippet('@기사 제목 https://a.b/c).').source).toEqual({ label: '기사 제목', url: 'https://a.b/c' });
  });
  it('본문 중간의 URL·#해시태그는 건드리지 않는다', () => {
    const r = parseSnippet('# 제목\n참고 https://a.b 를 보자\n#태그');
    expect(r.rest).toBe('참고 https://a.b 를 보자\n#태그');
    expect(r.source).toBeNull();
  });
  it('인용(>) 줄은 본문에 남는다', () => {
    expect(parseSnippet('> 따온 문장\n@책').rest).toBe('> 따온 문장');
  });
});

describe('editableText', () => {
  it('원전 필드가 없으면 본문 그대로', () => {
    expect(editableText({ body: 'x' })).toBe('x');
  });
  it('옛 원전 필드는 마커 줄로 풀어 다시 해석하면 같은 정보가 나온다', () => {
    const t = editableText({ body: '본문', source: { url: 'https://a.b', title: '제목', excerpt: '발췌 1\n발췌 2' } });
    expect(t).toBe('> 발췌 1\n> 발췌 2\n@제목 https://a.b\n\n본문');
    const r = parseSnippet(t);
    expect(r.source).toEqual({ label: '제목', url: 'https://a.b' });
    expect(r.rest).toBe('> 발췌 1\n> 발췌 2\n\n본문');
  });
});
