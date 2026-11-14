// EPUB 내보내기: pandoc 인자 조립 (순수 함수). 변환 실행은 convert.ts.

export const EPUB_CSS_NAME = 'epub.css';
export const EPUB_FILTER_NAME = 'drop-raw-html.lua';
/** 글 속 raw HTML(블록·인라인)을 AST 에서 지우는 Lua 필터 — gfm 읽기는 `-raw_html` 을 무시하므로(실측) 필터로 지운다 */
export const EPUB_FILTER_LUA = `function RawBlock(el) if el.format:match('html') then return {} end end
function RawInline(el) if el.format:match('html') then return {} end end
`;

/**
 * gfm → epub3 옵션.
 * - 글 속 raw HTML(`<script>`·`<br>`·`<details>` …)은 EPUB 의 XHTML 규칙에 맞지 않고 독서 앱마다 다르게 깨지므로 Lua 필터로 버린다.
 * - 이미지는 data URI 로 들어오면 pandoc 이 EPUB 안의 `media/` 자원으로 풀어 넣는다(실측).
 * - 구문 강조는 색 없이 굵기·기울임만(`monochrome`): 독서 앱의 다크/라이트 배경에서 색이 읽히지 않는 일을 피한다.
 * - 표지·목차는 pandoc 기본(표지 페이지 + `--toc`).
 */
export function buildEpubExportOptions(title: string, lang = 'ko'): Record<string, unknown> {
  return {
    from: 'gfm',
    filters: [{ type: 'lua', path: EPUB_FILTER_NAME }],
    to: 'epub3',
    toc: true,
    'toc-depth': 3,
    css: [EPUB_CSS_NAME],
    'highlight-style': 'monochrome',
    metadata: { title, lang },
    'input-files': ['in.md'],
    'output-file': 'out.epub',
  };
}
