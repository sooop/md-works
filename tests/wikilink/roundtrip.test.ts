import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import { restoreWikiLinks } from '../../src/lib/wikilink/roundtrip';
import { extractWikiLinks } from '../../src/lib/wikilink/parse';

// Milkdown 이 쓰는 remark 직렬화기와 같은 규칙(기본 unsafe 목록)으로 한 번 읽고 쓴다
const proc = () => unified().use(remarkParse).use(remarkGfm).use(remarkStringify);
const trip = (md: string) => { const p = proc(); return p.stringify(p.parse(md)); };

describe('저장 왕복', () => {
  it('직렬화기는 [[글]] 을 이스케이프한다(되돌릴 필요의 근거)', () => {
    expect(trip('앞 [[글 이름]] 뒤\n')).toContain('\\[\\[글 이름]]');
  });

  it('후처리하면 [[글 이름]] 이 글자 그대로 남는다', () => {
    expect(restoreWikiLinks(trip('앞 [[글 이름]] 뒤\n'))).toBe('앞 [[글 이름]] 뒤\n');
    expect(restoreWikiLinks(trip('[[폴더/이름|표시 *글자*]]\n'))).toBe('[[폴더/이름|표시 \\*글자\\*]]\n'.replace(/\\\*/g, '*'));
  });

  it('안쪽 특수문자의 이스케이프도 풀고, 두 번 돌려도 같다', () => {
    const src = '링크 [[a*b_c]] 와 [[x#y]]\n';
    const once = restoreWikiLinks(trip(src));
    expect(once).toBe(src);
    expect(restoreWikiLinks(trip(once))).toBe(once);
  });

  it('코드 안의 글자는 건드리지 않는다', () => {
    const src = '`[[코드]]` 와 [[밖]]\n\n```\n[[펜스]]\n```\n';
    expect(restoreWikiLinks(trip(src))).toBe(src);
  });

  it('후처리 뒤에도 링크로 추출된다', () => {
    const out = restoreWikiLinks(trip('문장 [[회의록]] 과 [[a/b|c]].\n'));
    expect(extractWikiLinks(out).map((l) => l.target)).toEqual(['회의록', 'a/b']);
  });

  it('백슬래시가 든 이름도 다시 돌려 같다(한 겹만 푼다)', () => {
    const once = restoreWikiLinks(trip('[[a\\\\b]]\n'));
    expect(once).toBe('[[a\\b]]\n'); // 마크다운 의미로 \\ 는 글자 \ 하나다
    expect(restoreWikiLinks(trip(once))).toBe(once);
  });

  it('표 셀 안의 | 는 \\| 로 남아 표가 깨지지 않는다', () => {
    const src = '| 가 | 나 |\n| --- | --- |\n| [[x\\|표시]] | b |\n';
    const out = restoreWikiLinks(trip(src));
    expect(out).toContain('[[x\\|표시]]');
    const p = proc();
    const tbl = (p.parse(out).children[0] as { type: string; children: unknown[] });
    expect(tbl.type).toBe('table');
  });

  it('불러올 때: 정의가 없으면 [[글]] 은 참조 링크가 아니라 글자다', () => {
    const tree = proc().parse('앞 [[글 이름]] [a][b] 뒤\n') as unknown as { children: { children: { type: string; value?: string }[] }[] };
    const kinds = tree.children[0].children.map((n) => n.type);
    expect(kinds).toEqual(['text']);
    expect(tree.children[0].children[0].value).toBe('앞 [[글 이름]] [a][b] 뒤');
  });

  it('링크 모양이 아닌 이스케이프는 그대로 둔다', () => {
    expect(restoreWikiLinks('\\[\\[열림만\n')).toBe('\\[\\[열림만\n');
    expect(restoreWikiLinks('\\[a]')).toBe('\\[a]');
  });
});
