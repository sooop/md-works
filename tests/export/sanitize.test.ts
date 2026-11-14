import { describe, expect, it } from 'vitest'
import { findDangerousHtml, sanitizeExportHtml } from '../../src/lib/export/sanitize'

describe('sanitizeExportHtml', () => {
  it('script 요소는 내용째 지운다', () => {
    const out = sanitizeExportHtml('<p>a</p><script>alert(1)</script><p>b</p><SCRIPT src="x.js"></SCRIPT>')
    expect(out).toBe('<p>a</p><p>b</p>')
  })
  it('닫히지 않은 script 는 끝까지 지운다', () => {
    expect(sanitizeExportHtml('<p>a</p><script>alert(1)')).toBe('<p>a</p>')
  })
  it('on* 이벤트 속성을 지우고 나머지 속성은 남긴다', () => {
    const out = sanitizeExportHtml('<img src="data:image/png;base64,AAAA" alt="x" onerror=alert(1) ONLOAD="y()" onclick=\'z()\'>')
    expect(out).not.toMatch(/on\w+\s*=/i)
    expect(out).toContain('alt="x"')
    expect(out).toContain('src="data:image/png;base64,AAAA"')
  })
  it('javascript: URL 을 지운다 (대소문자·공백·문자 참조 우회 포함)', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' java\tscript:alert(1)', '&#106;avascript:alert(1)', 'jav&#x61;script&colon;alert(1)', '\u0001javascript:alert(1)']) {
      const out = sanitizeExportHtml(`<a href="${href}">x</a>`)
      expect(out, href).not.toMatch(/href/i)
      expect(out).toContain('>x</a>')
    }
    expect(sanitizeExportHtml('<a href="https://example.com/a?b=1&c=2">x</a>')).toContain('href="https://example.com/a?b=1&amp;c=2"')
    expect(sanitizeExportHtml('<a href="#fn1">x</a>')).toContain('href="#fn1"')
  })
  it('data: 는 이미지 src 에만 허용한다', () => {
    expect(sanitizeExportHtml('<a href="data:text/html,<b>">x</a>')).not.toMatch(/href/)
    expect(sanitizeExportHtml('<iframe src="data:text/html,x"></iframe>')).toBe('')
    expect(sanitizeExportHtml('<img src="data:text/html;base64,AAAA">')).not.toMatch(/src/)
  })
  it('iframe·object·embed·style·link·meta·form 을 걷어낸다', () => {
    const out = sanitizeExportHtml('<iframe src="https://e.com"></iframe><object data="x"></object><embed src="x"><style>@import url(https://e.com/a.css)</style><link rel="stylesheet" href="https://e.com/a.css"><meta http-equiv="refresh" content="0;url=x"><form action="x"><button>go</button></form>')
    expect(out).toBe('go')
  })
  it('style 속성의 url()·expression() 은 지운다', () => {
    expect(sanitizeExportHtml('<p style="background:url(https://e.com/t.png)">a</p>')).toBe('<p>a</p>')
    expect(sanitizeExportHtml('<p style="color:red">a</p>')).toBe('<p style="color:red">a</p>')
  })
  it('주석·변형된 태그·닫히지 않은 태그로 우회하지 못한다', () => {
    const cases = [
      '<scr<script>ipt>alert(1)</scr</script>ipt>',
      '<img src=x onerror=alert(1)',
      '<svg/onload=alert(1)>',
      '<a href=javascript:alert(1)>x</a>',
      '<!--><script>alert(1)</script>-->',
      '<img src="x" onerror = "alert(1)">',
      '<p onmouseover="x" title="a>b">t</p>',
    ]
    for (const c of cases) expect(findDangerousHtml(sanitizeExportHtml(c)), c).toEqual([])
  })
  it('체크박스 외 input 은 지우고 체크박스는 조작을 막는다', () => {
    expect(sanitizeExportHtml('<input type="checkbox" checked="">')).toBe('<input type="checkbox" checked disabled>')
    expect(sanitizeExportHtml('<input type="text" value="x">')).toBe('')
  })
  it('일반 마크업과 MathML 은 그대로 둔다', () => {
    const html = '<h1 id="a">제목</h1><p>본문 <math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></p><table><tr><td>1</td></tr></table>'
    expect(sanitizeExportHtml(html)).toBe(html)
  })
  it('글자로 쓴 `<` 는 이스케이프한다', () => {
    expect(sanitizeExportHtml('a < b <3')).toBe('a &lt; b &lt;3')
  })
})
