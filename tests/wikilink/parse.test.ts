import { describe, it, expect } from 'vitest';
import { extractWikiLinks, resolveWikiLink, renameWikiLinks, flattenWikiLinks } from '../../src/lib/wikilink/parse';

const docs = (...p: string[]) => p.map((path) => ({ path }));

describe('extractWikiLinks', () => {
  it('대상·표시·위치를 읽는다', () => {
    const md = '앞 [[회의록]] 중간 [[a/b|표시]] 끝';
    const r = extractWikiLinks(md);
    expect(r.map((l) => [l.target, l.label])).toEqual([['회의록', '회의록'], ['a/b', '표시']]);
    for (const l of r) expect(md.slice(l.from, l.to)).toMatch(/^\[\[.*\]\]$/);
    expect(md.slice(r[1].from, r[1].to)).toBe('[[a/b|표시]]');
  });

  it('펜스 코드 블록·인라인 코드 안은 링크가 아니다', () => {
    const md = ['`[[코드]]` 와 [[진짜]]', '', '```js', 'const a = "[[펜스]]";', '```', '', '~~~', '[[틸드]]', '~~~', '', '``[[이중 `백틱` ]]`` [[뒤]]'].join('\n');
    expect(extractWikiLinks(md).map((l) => l.target)).toEqual(['진짜', '뒤']);
  });

  it('닫히지 않은 펜스는 끝까지 코드다', () => {
    expect(extractWikiLinks('```\n[[x]]\n[[y]]')).toEqual([]);
  });

  it('줄바꿈·대괄호가 섞이면 링크가 아니다', () => {
    expect(extractWikiLinks('[[a\nb]]')).toEqual([]);
    expect(extractWikiLinks('[[a[b]]')).toEqual([]);
    expect(extractWikiLinks('[[a]b]]')).toEqual([]);
    expect(extractWikiLinks('[[]] [[  ]] ![[삽입.png]]')).toEqual([]);
  });

  it('빈 줄 너머로는 인라인 코드가 이어지지 않는다', () => {
    expect(extractWikiLinks('`열기\n\n[[링크]] 닫기`').map((l) => l.target)).toEqual(['링크']);
  });
});

describe('resolveWikiLink', () => {
  const d = docs('회의록.md', 'a/기획.md', 'b/기획.md', 'a/Notes', '한글/가나다.md');
  it('경로가 정확히 일치하면 그 글', () => {
    expect(resolveWikiLink('a/기획', d)).toEqual({ kind: 'ok', path: 'a/기획' });
  });
  it('이름이 하나와 일치하면 그 글(확장자·대소문자·공백 무시)', () => {
    expect(resolveWikiLink('회의록', d)).toEqual({ kind: 'ok', path: '회의록' });
    expect(resolveWikiLink(' 회의록.md ', d)).toEqual({ kind: 'ok', path: '회의록' });
    expect(resolveWikiLink('NOTES', d)).toEqual({ kind: 'ok', path: 'a/Notes' });
  });
  it('한글은 NFC 로 비교한다', () => {
    expect(resolveWikiLink('가나다'.normalize('NFD'), d)).toEqual({ kind: 'ok', path: '한글/가나다' });
    expect(resolveWikiLink('한글/가나다', docs('한글/가나다.md'.normalize('NFD')))).toMatchObject({ kind: 'ok' });
  });
  it('이름이 여러 글과 일치하면 모호함', () => {
    expect(resolveWikiLink('기획', d)).toEqual({ kind: 'ambiguous', paths: ['a/기획', 'b/기획'] });
  });
  it('경로가 정확히 일치하면 같은 이름이 다른 폴더에 있어도 그 글', () => {
    expect(resolveWikiLink('회의록', docs('회의록', 'x/회의록'))).toEqual({ kind: 'ok', path: '회의록' });
  });
  it('없으면 없는 글', () => {
    expect(resolveWikiLink('없음', d)).toEqual({ kind: 'missing' });
    expect(resolveWikiLink('', d)).toEqual({ kind: 'missing' });
  });
});

describe('renameWikiLinks', () => {
  it('그 글을 가리키던 링크만 고치고 표시 글자는 보존한다', () => {
    const md = '[[회의]] [[회의|라벨]] [[다른글]] [[ 회의 ]]';
    const r = renameWikiLinks(md, '회의', '회의록', docs('회의록', '다른글'));
    expect(r.count).toBe(3);
    expect(r.text).toBe('[[회의록]] [[회의록|라벨]] [[다른글]] [[ 회의록 ]]');
  });
  it('이름형 링크는 새 이름이 유일하면 이름만 쓴다', () => {
    const r = renameWikiLinks('[[기획]]', 'a/기획', 'b/계획', docs('b/계획'));
    expect(r.text).toBe('[[계획]]');
  });
  it('새 이름이 다른 글과 겹치면 경로로 쓴다', () => {
    const r = renameWikiLinks('[[기획]]', '기획', 'b/계획', docs('b/계획', 'c/계획'));
    expect(r.text).toBe('[[b/계획]]');
  });
  it('경로형 링크는 경로로 고친다', () => {
    const r = renameWikiLinks('[[a/기획|보기]]', 'a/기획', 'b/기획', docs('b/기획', 'a/다른'));
    expect(r.text).toBe('[[b/기획|보기]]');
  });
  it('폴더만 옮겨 이름이 그대로면 이름형 링크는 바뀌지 않는다(세지 않는다)', () => {
    const r = renameWikiLinks('[[기획]]', 'a/기획', 'b/기획', docs('b/기획'));
    expect(r).toEqual({ text: '[[기획]]', count: 0 });
  });
  it('이동 전부터 모호했던 이름형 링크는 건드리지 않는다', () => {
    // 이동 전에는 a/기획·b/기획 이 모호했으므로 어느 글을 가리켰는지 알 수 없다
    const r = renameWikiLinks('[[기획]]', 'a/기획', 'a/계획', docs('a/계획', 'b/기획'));
    expect(r).toEqual({ text: '[[기획]]', count: 0 });
  });
  it('코드 안은 고치지 않는다', () => {
    const r = renameWikiLinks('`[[회의]]` [[회의]]', '회의', '회의록', docs('회의록'));
    expect(r).toEqual({ text: '`[[회의]]` [[회의록]]', count: 1 });
  });
  it('표 셀의 `\\|` 구분자를 보존한다', () => {
    const r = renameWikiLinks('| [[회의\\|라벨]] |', '회의', '회의록', docs('회의록'));
    expect(r.text).toBe('| [[회의록\\|라벨]] |');
  });
  it('가리키는 링크가 없으면 그대로', () => {
    expect(renameWikiLinks('[[다른글]]', '회의', '회의록', docs('회의록', '다른글'))).toEqual({ text: '[[다른글]]', count: 0 });
  });
});

describe('flattenWikiLinks', () => {
  it('표시가 있으면 표시, 없으면 대상의 이름 부분', () => {
    expect(flattenWikiLinks('[[a/b|표시]] 와 [[폴더/이름]] 와 [[그냥]]')).toBe('표시 와 이름 와 그냥');
  });
  it('코드 안은 그대로 둔다', () => {
    const md = '`[[x]]`\n\n```\n[[y]]\n```\n[[z]]';
    expect(flattenWikiLinks(md)).toBe('`[[x]]`\n\n```\n[[y]]\n```\nz');
  });
  it('링크가 없으면 같은 문자열', () => {
    expect(flattenWikiLinks('그냥 글')).toBe('그냥 글');
  });
});
