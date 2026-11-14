// HTML 내보내기: pandoc 옵션·문서 조립 (순수 함수). 변환 실행은 convert.ts.
import { sanitizeExportHtml } from './sanitize';

/** pandoc 템플릿: 구문 강조 CSS 와 본문 사이를 표지로 나눠 두 조각으로 받는다 */
export const HTML_BODY_MARK = '<!--MDW-BODY-->';
export const HTML_TEMPLATE = `$highlighting-css$\n${HTML_BODY_MARK}\n$body$`;

/**
 * gfm → html5 옵션. 수식은 KaTeX 글꼴이 없으므로 MathML 로 내보낸다(브라우저가 직접 그린다).
 * 구문 강조 색은 테마 밝기에 맞춰 고른다(다크 배경에 밝은 테마 색을 얹으면 읽기 어렵다).
 */
export function buildHtmlExportOptions(mode: 'light' | 'dark'): Record<string, unknown> {
  return {
    from: 'gfm',
    to: 'html5',
    standalone: true,
    template: 'template.html',
    wrap: 'none',
    'html-math-method': 'mathml',
    'highlight-style': mode === 'dark' ? 'breezedark' : 'tango',
    'email-obfuscation': 'none',
    'input-files': ['in.md'],
  };
}

/** pandoc 출력(표지로 나뉜 강조 CSS + 본문)에서 두 조각을 꺼낸다. 본문은 위험 요소를 거른다 */
export function splitPandocHtml(out: string): { highlightCss: string; body: string } {
  const i = out.indexOf(HTML_BODY_MARK);
  if (i < 0) return { highlightCss: '', body: sanitizeExportHtml(out) };
  return { highlightCss: out.slice(0, i).trim(), body: sanitizeExportHtml(out.slice(i + HTML_BODY_MARK.length)) };
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** CSS 에는 `<` 가 필요 없다 — `</style>` 로 태그를 닫고 빠져나오지 못하게 모두 CSS 이스케이프(`\3c `)로 바꾼다 */
const safeCss = (css: string) => css.replace(/</g, '\\3c ');

/**
 * 내보내기 CSP: 스크립트·원격 CSS·원격 글꼴을 허용하지 않는다(`default-src 'none'`).
 * 이미지는 data: 와 글에 직접 적힌 원격 주소(https/http)까지만 허용한다 — 글쓴이가 쓴 원격 이미지를 일부러 지우진 않는다.
 */
export const EXPORT_CSP = "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";

export interface HtmlDocInput {
  title: string;
  /** 이미 sanitize 된 본문 HTML */
  bodyHtml: string;
  /** buildExportCss 결과 */
  css: string;
  /** pandoc 구문 강조 CSS (없으면 빈 문자열) */
  highlightCss?: string;
  lang?: string;
}

/** 파일 하나로 완결된 HTML 문서를 만든다 (스크립트·외부 CSS/글꼴 참조 없음) */
export function buildHtmlDocument(o: HtmlDocInput): string {
  const lang = escapeHtml(o.lang ?? 'ko');
  // 강조 CSS 를 앞에 두어 우리 규칙(코드 배경 등)이 같은 특이도에서 이긴다
  const style = [o.highlightCss ?? '', o.css].filter(Boolean).join('\n');
  return [
    '<!doctype html>',
    `<html lang="${lang}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(EXPORT_CSP)}">`,
    `<title>${escapeHtml(o.title)}</title>`,
    `<style>\n${safeCss(style)}\n</style>`,
    '</head>',
    '<body>',
    '<main>',
    o.bodyHtml.trim(),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
