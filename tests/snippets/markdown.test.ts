import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseInline, safeHref, safeSrc, type Block } from '../../src/lib/snippets/markdown';

const first = (s: string): Block => parseMarkdown(s)[0];

describe('블록', () => {
  it('제목·문단·구분선', () => {
    const b = parseMarkdown('## 제목\n\n본문 1\n본문 2\n\n---');
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'hr']);
    expect((b[0] as any).level).toBe(2);
    expect((b[1] as any).c.map((x: any) => x.t)).toEqual(['text', 'br', 'text']); // 줄바꿈 유지
  });
  it('코드 블록은 해석하지 않는다', () => {
    const b = first('```ts\n# not heading\n**x**\n```') as any;
    expect(b).toEqual({ t: 'code', lang: 'ts', text: '# not heading\n**x**' });
  });
  it('닫히지 않은 코드 블록은 끝까지', () => {
    expect((first('```\na\nb') as any).text).toBe('a\nb');
  });
  it('중첩 목록·번호·할 일', () => {
    const l = first('- a\n  - b\n  - c\n- [x] 끝\n- [ ] 할 일') as any;
    expect(l.t).toBe('list');
    expect(l.items).toHaveLength(3);
    expect(l.items[0].blocks.map((x: any) => x.t)).toEqual(['p', 'list']);
    expect(l.items[0].blocks[1].items).toHaveLength(2);
    expect(l.items[1].checked).toBe(true);
    expect(l.items[2].checked).toBe(false);
    const o = first('3. x\n4. y') as any;
    expect(o).toMatchObject({ ordered: true, start: 3 });
    expect(o.items).toHaveLength(2);
  });
  it('인용은 안쪽을 다시 해석한다', () => {
    const q = first('> # 제목\n> - a') as any;
    expect(q.t).toBe('quote');
    expect(q.blocks.map((x: any) => x.t)).toEqual(['h', 'list']);
  });
  it('표(정렬 포함)', () => {
    const t = first('| a | b |\n|:--|--:|\n| 1 | 2 |\n| 3 |') as any;
    expect(t.t).toBe('table');
    expect(t.align).toEqual(['left', 'right']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1]).toHaveLength(2); // 모자란 칸은 빈 칸
  });
  it('파이프만 있는 문단은 표가 아니다', () => {
    expect(first('a | b').t).toBe('p');
  });
  it('아주 깊은 인용도 멈춘다', () => {
    expect(() => parseMarkdown('> '.repeat(500) + 'x')).not.toThrow();
  });
});

describe('인라인', () => {
  it('굵게·기울임·취소선·코드', () => {
    const r = parseInline('**굵게** *기울* ~~취소~~ `코드`');
    expect(r.filter((x) => x.t !== 'text').map((x) => x.t)).toEqual(['strong', 'em', 'del', 'code']);
  });
  it('단어 안의 밑줄은 강조가 아니다', () => {
    expect(parseInline('snake_case_name')).toEqual([{ t: 'text', v: 'snake_case_name' }]);
  });
  it('링크·이미지', () => {
    const r = parseInline('[글](https://a.b/c) ![alt](data:image/png;base64,AAAA)');
    expect(r.find((x) => x.t === 'a')).toMatchObject({ href: 'https://a.b/c' });
    expect(r.find((x) => x.t === 'img')).toMatchObject({ alt: 'alt' });
  });
  it('맨 주소는 링크, 끝 문장부호는 뺀다', () => {
    const a = parseInline('보세요 https://x.io/p).')[1] as any;
    expect(a).toMatchObject({ t: 'a', href: 'https://x.io/p' });
  });
  it('이스케이프', () => {
    expect(parseInline('\\*not\\*')).toEqual([{ t: 'text', v: '*not*' }]);
  });
});

describe('보안', () => {
  it('위험한 프로토콜은 링크가 되지 않는다', () => {
    for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' java\tscript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x']) {
      expect(safeHref(u)).toBe('');
    }
    expect(parseInline('[x](javascript:alert(1))')).toEqual([{ t: 'text', v: 'x' }]);
    expect(safeHref('https://ok.dev')).toBe('https://ok.dev');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
  });
  it('이미지는 http(s)·래스터 data URL 만', () => {
    expect(safeSrc('javascript:alert(1)')).toBe('');
    expect(safeSrc('data:image/svg+xml;base64,AAAA')).toBe('');
    expect(safeSrc('data:text/html;base64,AAAA')).toBe('');
    expect(safeSrc('https://a.b/i.png')).toBe('https://a.b/i.png');
    expect(parseInline('![x](javascript:alert(1))')).toEqual([{ t: 'text', v: 'x' }]);
  });
  it('HTML 은 글자 그대로 남는다(태그를 만들지 않는다)', () => {
    const r = parseMarkdown('<img src=x onerror=alert(1)>\n<script>alert(1)</script>');
    const json = JSON.stringify(r);
    expect(r[0].t).toBe('p');
    expect(json).toContain('<script>');
    expect(json).not.toContain('"t":"img"');
  });
});
