import { describe, expect, it } from 'vitest'
import { buildEpubExportOptions, EPUB_CSS_NAME, EPUB_FILTER_LUA, EPUB_FILTER_NAME } from '../../src/lib/export/epub'

describe('buildEpubExportOptions', () => {
  it('gfm → epub3, 제목·언어·목차·스타일시트', () => {
    const o = buildEpubExportOptions('내 글')
    expect(o).toMatchObject({ to: 'epub3', toc: true, metadata: { title: '내 글', lang: 'ko' }, css: [EPUB_CSS_NAME], 'input-files': ['in.md'], 'output-file': 'out.epub' })
    expect(String(o.from).startsWith('gfm')).toBe(true)
  })
  it('raw HTML 은 Lua 필터로 지운다', () => {
    expect(buildEpubExportOptions('t').filters).toEqual([{ type: 'lua', path: EPUB_FILTER_NAME }])
    expect(EPUB_FILTER_LUA).toContain('RawBlock')
    expect(EPUB_FILTER_LUA).toContain('RawInline')
  })
  it('언어를 바꿀 수 있다', () => {
    expect(buildEpubExportOptions('t', 'en')).toMatchObject({ metadata: { lang: 'en' } })
  })
})
