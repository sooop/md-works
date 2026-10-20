import { describe, expect, it } from 'vitest'
import { IMPORT_ACCEPT, pandocFormatOf } from '../../src/lib/pandoc/importFormats'
import { buildImportOptions } from '../../src/lib/pandoc/docx'
import { convert } from 'pandoc-wasm'

describe('가져오기 형식 표', () => {
  it('확장자로 pandoc 형식을 찾는다', () => {
    expect(pandocFormatOf('a.HTM')?.from).toBe('html')
    expect(pandocFormatOf('a.tex')?.from).toBe('latex')
    expect(pandocFormatOf('a.md')).toBeNull()
    expect(pandocFormatOf('noext')).toBeNull()
  })
  it('accept 에 마크다운과 pandoc 형식이 모두 들어 있다', () => {
    for (const e of ['.md', '.txt', '.docx', '.html', '.odt', '.epub', '.csv']) expect(IMPORT_ACCEPT).toContain(e)
  })
  it('html 가져오기는 raw HTML 을 지운다', async () => {
    const html = '<h1>t</h1><div class="c"><span style="color:red">r</span></div><script>x()</script>'
    const r = await convert(buildImportOptions('html', 'in.html'), null, { 'in.html': html })
    expect(r.stdout).toBe('# t\n\nr\n')
  })
})
