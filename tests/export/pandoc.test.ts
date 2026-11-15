// 실제 pandoc-wasm(Node 진입점)으로 gfm → html / epub 을 한 건씩 돌린다. 앱은 같은 옵션을 워커로 보낸다.
import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { convert } from 'pandoc-wasm'
import { buildHtmlDocument, buildHtmlExportOptions, HTML_TEMPLATE, splitPandocHtml } from '../../src/lib/export/html'
import { buildEpubExportOptions, EPUB_CSS_NAME, EPUB_FILTER_LUA, EPUB_FILTER_NAME } from '../../src/lib/export/epub'
import { buildEpubCss, buildExportCss } from '../../src/lib/export/css'
import { findDangerousHtml } from '../../src/lib/export/sanitize'
import { defaultDesign } from '../../src/lib/design/io'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const MD = [
  '# 제목', '', '본문 $E=mc^2$ 와 각주[^1]', '', '$$', 'x^2', '$$', '',
  `![그림](data:image/png;base64,${PNG})`, '',
  '- [x] 완료', '- [ ] 미완', '',
  '| a | b |', '|---|---|', '| 1 | 2 |', '',
  '```js', 'const a = 1', '```', '',
  '<script>alert(1)</script>', '', '<img src="x" onerror="alert(2)">', '', '[링크](javascript:alert(3))', '',
  '[^1]: 주석',
].join('\n')

describe('실제 pandoc 변환', () => {
  it('gfm → html: 수식 MathML·코드 강조·표·각주·체크박스가 나오고 위험 요소는 없다', async () => {
    const r = await convert(buildHtmlExportOptions('light'), null, { 'in.md': MD, 'template.html': HTML_TEMPLATE })
    const { highlightCss, body } = splitPandocHtml(r.stdout)
    expect(body).toContain('<math')
    expect(body).toContain('<table>')
    expect(body).toContain('sourceCode')
    expect(highlightCss).toContain('code span')
    expect(body).toContain('role="doc-endnotes"')
    expect(body).toContain('type="checkbox"')
    expect(body).toContain('disabled')
    expect(body).toContain(`data:image/png;base64,${PNG}`)
    expect(findDangerousHtml(body)).toEqual([])
    const html = buildHtmlDocument({ title: '글', bodyHtml: body, css: buildExportCss(defaultDesign(), 'light'), highlightCss })
    expect(findDangerousHtml(html)).toEqual([])
    expect(html).not.toMatch(/<link\b|<script\b/i)
  }, 90_000)

  it('gfm → epub3: 제목·언어·목차·이미지 자원이 EPUB 안에 들어간다', async () => {
    const files = { 'in.md': MD, [EPUB_CSS_NAME]: buildEpubCss(defaultDesign().typography), [EPUB_FILTER_NAME]: EPUB_FILTER_LUA }
    const r = await convert(buildEpubExportOptions('내 글'), null, files)
    const epub = r.files['out.epub']
    expect(epub).toBeTruthy()
    const z = unzipSync(new Uint8Array(await epub.arrayBuffer()))
    const names = Object.keys(z)
    expect(names).toContain('EPUB/nav.xhtml')
    expect(names.some((n) => /^EPUB\/media\/.+\.png$/.test(n))).toBe(true)
    const opf = strFromU8(z['EPUB/content.opf'])
    expect(opf).toContain('<dc:title id="epub-title-1">내 글</dc:title>')
    expect(opf).toContain('<dc:language>ko</dc:language>')
    const chapters = names.filter((n) => /^EPUB\/text\/ch\d+\.xhtml$/.test(n)).map((n) => strFromU8(z[n])).join('\n')
    expect(chapters).not.toContain('data:image')
    expect(chapters).not.toMatch(/<script|onerror/i)
    expect(strFromU8(z['EPUB/styles/stylesheet1.css'])).toContain('line-height:1.5')
  }, 90_000)
})
