import { describe, expect, it } from 'vitest'
import { buildEpubCss, buildExportCss } from '../../src/lib/export/css'
import { defaultDesign } from '../../src/lib/design/io'
import { derivePalette } from '../../src/lib/design/colors'
import { clampTypography } from '../../src/lib/design/schema'

const d = () => defaultDesign()

describe('buildExportCss', () => {
  it('라이트: 라이트 팔레트와 타이포 변수를 :root 에 둔다', () => {
    const css = buildExportCss(d(), 'light')
    const p = d().palettes.light
    expect(css).toContain(`--bg:${p.bg}`)
    expect(css).toContain(`--text:${p.text}`)
    expect(css).toContain('color-scheme:light')
    expect(css).toContain('--editor-font-size:16px')
    expect(css).toContain('--ed-line-height:1.5')
    expect(css).toContain('--ed-para-gap:0.65em')
    expect(css).toContain('--ed-h1-size:1.75em')
  })
  it('다크: 다크 팔레트로 내보낸다', () => {
    const dd = d()
    const css = buildExportCss(dd, 'dark')
    expect(css).toContain(`--bg:${dd.palettes.dark.bg}`)
    expect(css).toContain(`--code-bg:${derivePalette(dd.palettes.dark, 'dark')['--code-bg']}`)
    expect(css).toContain('color-scheme:dark')
    expect(css.split('@media print')[0]).not.toContain(`--bg:${dd.palettes.light.bg}`)
  })
  it('디자인 값이 CSS 에 반영된다 (서체·크기·줄간격·제목 배율·인용·표)', () => {
    const dd = d()
    dd.typography = clampTypography({ ...dd.typography, bodyFont: 'Nanum Myeongjo', fontSize: 19, lineHeight: 1.9, h1Scale: 2.2, quoteBg: true, quoteItalic: true, tableStripe: true, contentWidth: 700 })
    const css = buildExportCss(dd, 'light')
    expect(css).toContain('--ed-font:"Nanum Myeongjo"')
    expect(css).toContain('--editor-font-size:19px')
    expect(css).toContain('--ed-line-height:1.9')
    expect(css).toContain('--ed-h1-size:2.2em')
    expect(css).toContain('--editor-width:700px')
    expect(css).toMatch(/blockquote\{background:color-mix/)
    expect(css).toContain('blockquote{font-style:italic}')
    expect(css).toContain('tbody tr:nth-child(even) td')
  })
  it('인쇄 규칙: 흰 배경·검은 글자', () => {
    const css = buildExportCss(d(), 'dark')
    const print = css.slice(css.indexOf('@media print'))
    expect(print).toContain('--bg:#fff')
    expect(print).toContain('--text:#000')
    expect(print).toMatch(/html,body\{background:#fff!important;color:#000!important\}/)
  })
  it('앱 화면용 규칙이 섞이지 않는다', () => {
    const css = buildExportCss(d(), 'light')
    for (const bad of ['.milkdown', '.ProseMirror', '.sidebar', '@media screen', 'data-theme', 'crepe']) expect(css).not.toContain(bad)
  })
  it('외부 자원을 참조하지 않는다', () => {
    const css = buildExportCss(d(), 'light')
    expect(css).not.toMatch(/@import|@font-face|https?:\/\//)
  })
})

describe('buildEpubCss', () => {
  it('본문 타이포(줄간격·문단 간격·들여쓰기·제목 배율)만 담고 색·서체는 정하지 않는다', () => {
    const t = clampTypography({ lineHeight: 1.8, paragraphGap: 0.5, indent: 1, h1Scale: 2, h1Before: 2, h1After: 1, align: 'justify' })
    const css = buildEpubCss(t)
    expect(css).toContain('body{line-height:1.8}')
    expect(css).toContain('p{margin:0.5em 0;text-indent:1em;text-align:justify}')
    expect(css).toContain('h1{font-size:2em;margin:1em 0 0.5em')
    expect(css).not.toMatch(/(^|[;{\s])(color|background(-color)?)\s*:/)
    expect(css).not.toMatch(/font-family\s*:\s*(?!monospace)/)
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i)
  })
})
