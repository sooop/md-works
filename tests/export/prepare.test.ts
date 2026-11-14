import { describe, expect, it } from 'vitest'
import { prepareExportMarkdown } from '../../src/lib/export/prepare'

describe('prepareExportMarkdown', () => {
  it('글 사이 링크가 없는 글은 그대로 돌려준다', () => {
    for (const md of ['', '# 제목\n\n본문\n', '---\ntitle: x\n---\n\n![a](data:image/png;base64,AAAA)\n']) {
      expect(prepareExportMarkdown(md)).toBe(md)
    }
  })

  it('글 사이 링크는 표시 글자(없으면 글 이름)로 푼다', () => {
    expect(prepareExportMarkdown('앞 [[다른 글]] 뒤')).toBe('앞 다른 글 뒤')
    expect(prepareExportMarkdown('[[폴더/다른 글]]')).toBe('다른 글')
    expect(prepareExportMarkdown('[[다른 글|여기]] 참고')).toBe('여기 참고')
  })

  it('코드 안의 대괄호는 건드리지 않는다', () => {
    const md = '`[[코드]]`\n\n```\n[[블록]]\n```\n'
    expect(prepareExportMarkdown(md)).toBe(md)
  })
})
