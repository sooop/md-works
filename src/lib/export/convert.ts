// markdown → HTML / EPUB 변환 실행(pandoc 워커). 이미지는 호출 전에 data URI 로 바뀌어 있어야 한다.
import { runPandoc } from '../pandoc/client';
import { splitFrontmatter } from '../frontmatter';
import type { Design } from '../design/schema';
import { buildExportCss, buildEpubCss } from './css';
import { buildEpubExportOptions, EPUB_CSS_NAME, EPUB_FILTER_LUA, EPUB_FILTER_NAME } from './epub';
import { buildHtmlDocument, buildHtmlExportOptions, HTML_TEMPLATE, splitPandocHtml } from './html';
import { prepareExportMarkdown } from './prepare';

/** 본문만 변환한다: 전처리(prepareExportMarkdown) 뒤 YAML frontmatter 는 떼어 낸다(그대로 두면 가로줄·제목으로 보인다) */
const bodyOf = (md: string) => splitFrontmatter(prepareExportMarkdown(md)).body;

/** 파일 하나로 완결된 .html 문서 텍스트 */
export async function markdownToHtmlDocument(markdown: string, title: string, design: Design, mode: 'light' | 'dark'): Promise<string> {
  const r = await runPandoc(buildHtmlExportOptions(mode), { 'in.md': bodyOf(markdown), 'template.html': HTML_TEMPLATE });
  const { highlightCss, body } = splitPandocHtml(r.stdout);
  return buildHtmlDocument({ title, bodyHtml: body, css: buildExportCss(design, mode), highlightCss });
}

export async function markdownToEpub(markdown: string, title: string, design: Design): Promise<Blob> {
  const r = await runPandoc(buildEpubExportOptions(title), {
    'in.md': bodyOf(markdown),
    [EPUB_CSS_NAME]: buildEpubCss(design.typography),
    [EPUB_FILTER_NAME]: EPUB_FILTER_LUA,
  });
  const blob = r.files['out.epub'];
  if (!blob) throw new Error('EPUB 변환 결과가 비어 있습니다');
  return blob;
}
