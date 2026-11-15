import { describe, expect, it } from 'vitest'
import { buildHtmlDocument, buildHtmlExportOptions, splitPandocHtml, HTML_BODY_MARK } from '../../src/lib/export/html'
import { findDangerousHtml } from '../../src/lib/export/sanitize'

const doc = (over = {}) => buildHtmlDocument({ title: '글', bodyHtml: '<p>본문</p>', css: 'body{color:#000}', ...over })

describe('buildHtmlDocument', () => {
  it('문서 구조: doctype, lang, charset, viewport, main', () => {
    const h = doc()
    expect(h.startsWith('<!doctype html>')).toBe(true)
    expect(h).toContain('<html lang="ko">')
    expect(h).toContain('<meta charset="utf-8">')
    expect(h).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
    expect(h).toMatch(/<main>\s*<p>본문<\/p>\s*<\/main>/)
  })
  it('제목을 이스케이프한다', () => {
    const h = doc({ title: '<script>alert("x")</script> & \'a\'' })
    expect(h).toContain('<title>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;a&#39;</title>')
    expect(h).not.toContain('<script')
  })
  it('lang 지정과 CSS 포함', () => {
    const h = doc({ lang: 'en', css: 'p{margin:0}', highlightCss: 'code span.kw{color:red}' })
    expect(h).toContain('<html lang="en">')
    expect(h).toMatch(/<style>[\s\S]*code span\.kw\{color:red\}\np\{margin:0\}[\s\S]*<\/style>/)
  })
  it('CSS 가 style 요소를 닫지 못한다', () => {
    const h = doc({ css: 'a{}</style><script>x()</script>' })
    expect(h).not.toMatch(/<script/i)
    expect(h.match(/<\/style/gi)?.length).toBe(1)
  })
  it('외부 URL 을 참조하는 link·script 가 없고 CSP 가 스크립트를 막는다', () => {
    const h = doc()
    expect(h).not.toMatch(/<link\b/i)
    expect(h).not.toMatch(/<script\b/i)
    expect(h).not.toMatch(/@import|url\(\s*["']?https?:/i)
    const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(h)?.[1] ?? ''
    expect(csp).toContain('default-src &#39;none&#39;')
    expect(csp).not.toContain('script-src')
    expect(findDangerousHtml(h)).toEqual([])
  })
})

describe('pandoc 출력 나누기', () => {
  it('강조 CSS 와 본문으로 나누고 본문은 위험 요소를 거른다', () => {
    const r = splitPandocHtml(`code span.kw{color:red}\n${HTML_BODY_MARK}\n<p>a</p><script>x()</script><img src=x onerror=y()>`)
    expect(r.highlightCss).toBe('code span.kw{color:red}')
    expect(findDangerousHtml(r.body)).toEqual([])
    expect(r.body).toContain('<p>a</p>')
  })
  it('표지가 없어도 본문을 돌려준다', () => {
    expect(splitPandocHtml('<p>a</p>').body).toBe('<p>a</p>')
  })
})

describe('buildHtmlExportOptions', () => {
  it('gfm → html5, 수식은 MathML, 템플릿 사용', () => {
    const o = buildHtmlExportOptions('light')
    expect(o).toMatchObject({ from: 'gfm', to: 'html5', 'html-math-method': 'mathml', standalone: true, 'input-files': ['in.md'] })
  })
  it('구문 강조 색은 테마 밝기를 따른다', () => {
    expect(buildHtmlExportOptions('light')['highlight-style']).not.toBe(buildHtmlExportOptions('dark')['highlight-style'])
  })
})
