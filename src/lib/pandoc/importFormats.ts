/**
 * 가져오기 형식 표 — 확장자 → pandoc 입력 형식.
 * 판별(`isImportable`)·변환(`readImport`)·파일 선택창 `accept`·안내 문구가 모두 이 표 하나를 쓴다.
 * 마크다운 계열은 pandoc을 거치지 않고 그대로 읽는다.
 */
export interface ImportFormat {
  /** pandoc `from` 값 */
  from: string
  /** 점 없는 소문자 확장자 */
  exts: string[]
}

export const PANDOC_IMPORT_FORMATS: ImportFormat[] = [
  { from: 'docx', exts: ['docx'] },
  { from: 'odt', exts: ['odt'] },
  { from: 'epub', exts: ['epub'] },
  { from: 'html', exts: ['html', 'htm'] },
  { from: 'rtf', exts: ['rtf'] },
  { from: 'latex', exts: ['tex'] },
  { from: 'rst', exts: ['rst'] },
  { from: 'org', exts: ['org'] },
  { from: 'csv', exts: ['csv'] },
  { from: 'tsv', exts: ['tsv'] },
  { from: 'ipynb', exts: ['ipynb'] },
  { from: 'asciidoc', exts: ['adoc', 'asciidoc'] },
  { from: 'typst', exts: ['typ'] },
  { from: 'textile', exts: ['textile'] },
  { from: 'mediawiki', exts: ['wiki'] },
]

export const TEXT_DOC_EXTS = ['md', 'markdown', 'txt']

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** 파일 이름으로 pandoc 입력 형식을 찾는다. 마크다운·텍스트이거나 모르는 확장자면 null. */
export function pandocFormatOf(name: string): ImportFormat | null {
  const ext = extOf(name)
  return PANDOC_IMPORT_FORMATS.find((f) => f.exts.includes(ext)) ?? null
}

/** `<input accept>` 용 확장자 목록 (".md,.markdown,…") */
export const IMPORT_ACCEPT = [...TEXT_DOC_EXTS, ...PANDOC_IMPORT_FORMATS.flatMap((f) => f.exts)]
  .map((e) => `.${e}`)
  .join(',')

/** 안내 문구용 요약 */
export const IMPORT_LABEL = '.md · .txt · .docx · .html · .odt · .epub · .rtf · .tex 등'
