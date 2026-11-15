import { describe, it, expect } from 'vitest';
import { replaceInMarkdown, expandReplacement } from '../../src/lib/search/replaceText';

const rx = { regex: true };
const r = (t: string, q: string, o = {}, to = '') => replaceInMarkdown(t, q, o, to);

describe('replaceInMarkdown', () => {
  it('일반 모드: 바꿀 말은 글자 그대로($ 해석 없음), 정규식 특수문자는 이스케이프', () => {
    const out = r('a.b a.b axb', 'a.b', {}, '$&-$1');
    expect(out).toEqual({ text: '$&-$1 $&-$1 axb', count: 2 });
  });

  it('대소문자: 기본은 구분 안 함, 옵션으로 구분', () => {
    expect(r('Foo foo FOO', 'foo', {}, 'x')).toMatchObject({ text: 'x x x', count: 3 });
    expect(r('Foo foo FOO', 'foo', { caseSensitive: true }, 'x')).toMatchObject({ text: 'Foo x FOO', count: 1 });
  });

  it('정규식: $1 $& $<이름> 캡처 참조', () => {
    expect(r('2024-05-06', '(\\d+)-(\\d+)-(\\d+)', rx, '$3/$2/$1').text).toBe('06/05/2024');
    expect(r('abc', 'b', rx, '[$&]').text).toBe('a[b]c');
    expect(r('abc', '(?<x>b)', rx, '<$<x>>').text).toBe('a<b>c');
    expect(r('abc', 'b', rx, '$$ $9 $0').text).toBe('a$ $9 $0c');
  });

  it('정규식은 줄 단위: ^ $ 가 줄마다 맞고, 줄을 가로지르는 일치는 없다', () => {
    expect(r('a\nb\nc', '^', rx, '>').count).toBe(0); // 빈 일치는 세지 않는다(검색과 같다)
    expect(r('x1\nx2\n', '^x', rx, 'y').text).toBe('y1\ny2\n');
    expect(r('a\nb', 'a\\nb', rx, 'Z').count).toBe(0);
    expect(r('ab\nab', 'b$', rx, 'B').text).toBe('aB\naB');
  });

  it('줄바꿈(CRLF 포함)과 끝 개행을 보존한다', () => {
    expect(r('a x\r\nb x\r\n', 'x', {}, 'y').text).toBe('a y\r\nb y\r\n');
  });

  it('펜스 코드 블록(``` / ~~~)은 건드리지 않는다', () => {
    const t = ['x 앞', '```js', 'x 안', '```', 'x 사이', '~~~', 'x 틸드', '~~~', 'x 뒤'].join('\n');
    expect(r(t, 'x', {}, 'Y').text).toBe(['Y 앞', '```js', 'x 안', '```', 'Y 사이', '~~~', 'x 틸드', '~~~', 'Y 뒤'].join('\n'));
  });

  it('긴 울타리 안의 짧은 울타리는 닫는 줄이 아니고, 닫히지 않으면 끝까지 코드다', () => {
    const t = ['````', 'x', '```', 'x', '````', 'x', '```', 'x'].join('\n');
    expect(r(t, 'x', {}, 'Y').text).toBe(['````', 'x', '```', 'x', '````', 'Y', '```', 'x'].join('\n'));
  });

  it('YAML 프런트매터는 건드리지 않는다(맨 앞일 때만)', () => {
    const t = ['---', 'title: x', 'tags: [x]', '---', 'x 본문', '---', 'x 구분선 뒤'].join('\n');
    expect(r(t, 'x', {}, 'Y').text).toBe(['---', 'title: x', 'tags: [x]', '---', 'Y 본문', '---', 'Y 구분선 뒤'].join('\n'));
    expect(r('x\n---\nx\n---\nx', 'x', {}, 'Y').text).toBe('Y\n---\nY\n---\nY'); // 맨 앞이 아니면 프런트매터가 아니다
  });

  it('프런트매터가 닫히지 않으면 본문으로 본다', () => {
    expect(r('---\nx', 'x', {}, 'Y').text).toBe('---\nY');
  });

  it('이미지 데이터(data URI, idb:)는 일치로 보지 않는다', () => {
    const idb = 'idb:123e4567-e89b-12d3-a456-426614174000';
    const t = `a ![x](${idb}) a ![y](data:image/png;base64,aaaa) a`;
    const out = r(t, 'a', {}, 'Z');
    expect(out.text).toBe(`Z ![x](${idb}) Z ![y](data:image/png;base64,aaaa) Z`);
    expect(out.count).toBe(3);
  });

  it('잘못된 정규식·빈 검색어는 error 이고 원문 그대로', () => {
    expect(r('abc', '(', rx, 'x')).toMatchObject({ text: 'abc', count: 0, error: expect.stringContaining('정규식') });
    expect(r('abc', '', {}, 'x').error).toBeTruthy();
  });

  it('바꿀 곳이 없으면 같은 문자열을 돌려준다', () => {
    const t = 'hello';
    expect(r(t, 'zzz', {}, 'x')).toEqual({ text: t, count: 0 });
  });

  it('빈 바꿀 말은 지운다', () => {
    expect(r('a-b-c', '-', {}, '').text).toBe('abc');
  });
});

describe('expandReplacement', () => {
  const m = (re: RegExp, s: string) => s.match(re)!;
  it('앞뒤 참조(백틱, 작은따옴표)는 일치 앞뒤', () => {
    expect(expandReplacement('[$`|$' + "']", m(/b/, 'abc'))).toBe('[a|c]');
  });
  it('두 자리 그룹 번호', () => {
    expect(expandReplacement('$10', m(/(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)/, 'abcdefghij'))).toBe('j');
    expect(expandReplacement('$10', m(/(a)/, 'a'))).toBe('a0'); // 1번 그룹 + 글자 0
  });
});
