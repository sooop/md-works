// 디자인 설정 → 내보내기용 CSS (순수 함수). 앱 화면 규칙(사이드바·편집기 조작 UI)은 섞지 않고 본문에 필요한 규칙만 만든다.
// 색 파생(derivePalette)과 타이포 변수(typographyVars)는 화면용과 같은 함수를 써서 화면과 어긋나지 않게 한다.
import { derivePalette } from '../design/colors';
import { typographyVars } from '../design/apply';
import type { Design, Typography } from '../design/schema';

/** 앱 app.css 의 --font / --font-code 와 같은 기본 서체 (내보낸 파일에는 앱 CSS 가 없다) */
const FONT_DEFAULT = "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', 'Noto Sans KR', 'Malgun Gothic', sans-serif";
const FONT_CODE_DEFAULT = "'Jetendard', 'Geist Mono', 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace";

const decls = (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');

/** 인쇄할 때는 팔레트와 무관하게 흰 배경·검은 글자 (다크 테마로 내보냈어도 종이에는 잉크를 아낀다) */
const PRINT_VARS: Record<string, string> = {
  '--bg': '#fff', '--surface': '#fff', '--surface-2': '#f3f3f3', '--text': '#000', '--muted': '#444',
  '--border': '#ccc', '--border-strong': '#999', '--primary': '#000', '--accent': '#000', '--accent-soft': '#eee',
  '--quote': '#999', '--code-bg': '#f5f5f5', '--table-line': '#999', '--ed-quote-color': '#999',
};

/** 내보내기 HTML 의 `<style>` 내용. mode 는 내보내는 시점에 보고 있던 테마 */
export function buildExportCss(d: Design, mode: 'light' | 'dark'): string {
  const t = d.typography;
  const vars = { ...derivePalette(d.palettes[mode], mode), ...typographyVars(t) };
  const css: string[] = [];
  css.push(`:root{color-scheme:${mode};${decls(vars)}}`);
  css.push(`*{box-sizing:border-box}`);
  css.push(`html{background:var(--bg);-webkit-text-size-adjust:100%}`);
  css.push(`body{margin:0;background:var(--bg);color:var(--text);font-family:var(--ed-font,${FONT_DEFAULT});font-size:var(--editor-font-size);line-height:var(--ed-line-height);letter-spacing:var(--ed-letter-spacing);font-weight:var(--ed-weight)}`);
  css.push(`main{max-width:var(--editor-width);margin:0 auto;padding:48px 24px 96px;overflow-wrap:break-word}`);
  css.push(`p{margin:0;padding:var(--ed-para-gap) 0;line-height:var(--ed-line-height)}`);
  css.push(`main>p{text-indent:var(--ed-indent);text-align:var(--ed-align)}`);
  css.push(`li p{text-align:var(--ed-align)}`);
  const heights = [1.3, 1.3, 1.35, 1.4, 1.5, 1.5];
  for (let i = 1; i <= 6; i++) {
    css.push(`h${i}{font-family:var(--ed-heading-font,inherit);font-size:var(--ed-h${i}-size);font-weight:var(--ed-heading-weight,${i <= 2 ? 700 : 600});line-height:${heights[i - 1]};margin:calc(var(--ed-h${i}-before) * var(--editor-font-size)) 0 calc(var(--ed-h${i}-after) * var(--editor-font-size))}`);
  }
  css.push(`strong,b{font-weight:var(--ed-bold-weight)}`);
  css.push(`a{color:var(--primary)}`);
  css.push(`ul,ol{margin:8px 0;padding-left:1.7em}`);
  css.push(`ul.task-list{list-style:none;padding-left:.4em}`);
  css.push(`ul.task-list input{margin:0 .5em 0 0}`);
  css.push(`blockquote{margin:16px 0;padding:2px 0 2px calc(var(--ed-quote-bar) + 14px);border-left:var(--ed-quote-bar) solid var(--ed-quote-color,var(--muted));color:var(--text)}`);
  css.push(`blockquote>p:first-child{padding-top:.3em}blockquote>p:last-child{padding-bottom:.3em}`);
  if (t.quoteBg) css.push(`blockquote{background:color-mix(in srgb,var(--quote) 30%,transparent);border-radius:6px}`);
  if (t.quoteItalic) css.push(`blockquote{font-style:italic}`);
  css.push(`hr{border:0;border-top:1px solid var(--border-strong);margin:20px 0}`);
  css.push(`code,kbd,samp{font-family:var(--ed-code-font,${FONT_CODE_DEFAULT});font-size:calc(1em * var(--ed-code-scale))}`);
  css.push(`:not(pre)>code{background:var(--code-bg);padding:.15em .4em;border-radius:4px}`);
  css.push(`main pre,main div.sourceCode{background:var(--code-bg);border-radius:8px;margin:16px 0}`);
  css.push(`main div.sourceCode pre{margin:0}`);
  css.push(`pre{padding:12px 16px;overflow:auto;line-height:1.55;tab-size:4}`);
  css.push(`pre code{background:none;padding:0;color:inherit}`);
  css.push(`table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse;margin:16px 0;font-size:.9em}`);
  css.push(`th,td{border:1px solid var(--table-line);padding:var(--ed-cell-y) var(--ed-cell-x);line-height:1.45;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:keep-all}`);
  css.push(`th{background:var(--surface-2);font-weight:var(--ed-bold-weight)}`);
  if (t.tableStripe) css.push(`tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--surface-2) 75%,transparent)}`);
  css.push(`p>img:only-child,figure img{display:block;margin:0 auto}`);
  css.push(`img{max-width:100%;height:auto}`);
  css.push(`math{font-size:1.05em}math[display="block"]{display:block;margin:1em 0;overflow-x:auto;overflow-y:hidden}`);
  css.push(`.footnotes{font-size:.9em;color:var(--muted)}.footnotes hr{margin:32px 0 12px}.footnotes p{padding:.15em 0}`);
  css.push(`sup{line-height:0}`);
  css.push(`@media (max-width:600px){main{padding:28px 16px 64px}}`);
  css.push(
    `@media print{:root{color-scheme:light;${decls(PRINT_VARS)}}` +
    `html,body{background:#fff!important;color:#000!important}` +
    `main{max-width:none;padding:0}` +
    `a{color:#000;text-decoration:underline}` +
    `pre code span{color:#000!important;background:none!important}` +
    `pre{white-space:pre-wrap;overflow:visible}` +
    `blockquote,table,pre,img,tr{break-inside:avoid}` +
    `table{display:table;overflow:visible}` +
    `h1,h2,h3,h4,h5,h6{break-after:avoid}}`,
  );
  return css.join('\n');
}

const r3 = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * EPUB 스타일시트: 본문 타이포(줄간격·문단 간격·들여쓰기·제목 배율)만 넣는다.
 * 색·서체·글자 크기는 독서 앱 설정이 우선해야 하므로 지정하지 않는다(제목 크기는 본문 대비 배율이라 em 으로).
 */
export function buildEpubCss(t: Typography): string {
  const css: string[] = [];
  css.push(`body{line-height:${r3(t.lineHeight)}}`);
  css.push(`p{margin:${r3(t.paragraphGap)}em 0;text-indent:${r3(t.indent)}em;text-align:${t.align === 'justify' ? 'justify' : 'left'}}`);
  css.push(`li p,blockquote p,td p,th p{text-indent:0}`);
  for (let i = 1; i <= 6; i++) {
    const scale = t[`h${i}Scale` as keyof Typography] as number;
    const before = t[`h${i}Before` as keyof Typography] as number;
    const after = t[`h${i}After` as keyof Typography] as number;
    // 앱의 여백은 본문 글자 크기 배수라, 제목 자신의 글자 크기 기준 em 으로 환산한다
    css.push(`h${i}{font-size:${r3(scale)}em;margin:${r3(before / scale)}em 0 ${r3(after / scale)}em;text-indent:0}`);
  }
  css.push(`blockquote{margin:1em 0 1em 1em;padding-left:.8em;border-left:${Math.max(1, t.quoteBar)}px solid}`);
  css.push(`pre,code{white-space:pre-wrap;font-family:monospace}`);
  css.push(`pre{margin:1em 0}`);
  css.push(`img{max-width:100%;height:auto}`);
  css.push(`table{border-collapse:collapse;margin:1em 0}`);
  css.push(`th,td{border:1px solid rgba(128,128,128,.6);padding:${Math.round(t.cellPadY)}px ${Math.round(t.cellPadX)}px;text-align:left}`);
  css.push(`ul.task-list{list-style:none;padding-left:.4em}`);
  return css.join('\n');
}
