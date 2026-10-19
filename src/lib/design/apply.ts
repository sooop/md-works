// 디자인 적용: 디자인 → CSS 텍스트(buildDesignCss) → <style> 한 개로 문서에 반영
// 인쇄(@media print)는 기존 동작을 유지해야 하므로 모든 규칙을 @media screen 안에 둔다(인쇄에서는 app.css 의 var() 기본값이 쓰인다).
import { derivePalette } from './colors';
import { buildFontFamily, FALLBACK_CODE } from './fontStack';
import type { Design, Palette, Typography } from './schema';

const STYLE_ID = 'works-design-style';

const decls = (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');

function paletteBlock(p: Palette, mode: 'light' | 'dark'): string {
  // html:root 는 app.css 의 :root 보다 특이도가 높아 선언 순서와 무관하게 이긴다
  const sel = mode === 'dark' ? "html:root[data-theme='dark']" : 'html:root';
  return `${sel}{${decls(derivePalette(p, mode))}}`;
}

export function typographyVars(t: Typography): Record<string, string> {
  const body = buildFontFamily(t.bodyFont);
  const heading = buildFontFamily(t.headingFont);
  const code = buildFontFamily(t.codeFont, FALLBACK_CODE);
  const v: Record<string, string> = {
    '--editor-font-size': `${t.fontSize}px`,
    '--editor-width': t.contentWidth > 0 ? `${t.contentWidth}px` : 'none',
    '--ed-line-height': String(t.lineHeight),
    '--ed-letter-spacing': `${t.letterSpacing}em`,
    '--ed-weight': String(t.bodyWeight),
    '--ed-bold-weight': String(t.boldWeight),
    '--ed-para-gap': `${t.paragraphGap}em`,
    '--ed-indent': `${t.indent}em`,
    '--ed-align': t.align === 'justify' ? 'justify' : 'left',
    '--ed-quote-bar': `${t.quoteBar}px`,
    '--ed-code-scale': String(t.codeScale),
    '--ed-cell-y': `${t.cellPadY}px`,
    '--ed-cell-x': `${t.cellPadX}px`,
  };
  if (t.headingWeight > 0) v['--ed-heading-weight'] = String(t.headingWeight); // 0 이면 정의하지 않아 app.css 의 제목별 기본 굵기
  if (body) v['--ed-font'] = body;
  // 제목 서체가 비면 본문 서체를 따른다(둘 다 비면 정의하지 않아 app.css 기본값)
  if (heading || body) v['--ed-heading-font'] = heading || body;
  if (code) v['--ed-code-font'] = code;
  if (t.quoteUseColor) v['--ed-quote-color'] = 'var(--quote)';
  for (let i = 1; i <= 6; i++) {
    const k = (s: string) => t[`h${i}${s}` as keyof Typography] as number;
    v[`--ed-h${i}-size`] = `${k('Scale')}em`;
    v[`--ed-h${i}-before`] = `${k('Before')}`;
    v[`--ed-h${i}-after`] = `${k('After')}`;
  }
  return v;
}

/** 디자인 전체를 CSS 텍스트로 만든다 (DOM 불필요, 테스트 가능) */
export function buildDesignCss(d: Design): string {
  const t = d.typography;
  const pm = ':root .milkdown .ProseMirror';
  const extra: string[] = [];
  if (t.quoteBg) extra.push(`html${pm} blockquote{background:color-mix(in srgb,var(--quote) 30%,transparent);border-radius:6px}`);
  if (t.quoteItalic) extra.push(`html${pm} blockquote{font-style:italic}`);
  if (t.tableStripe) {
    extra.push(`html:root .milkdown .milkdown-table-block tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--surface-2) 75%,transparent)}`);
  }
  return [
    '@media screen{',
    paletteBlock(d.palettes.light, 'light'),
    paletteBlock(d.palettes.dark, 'dark'),
    `:root{${decls(typographyVars(t))}}`,
    ...extra,
    '}',
  ].join('\n');
}

/** 디자인을 현재 문서에 반영한다. 첫 로드 깜빡임을 줄이려면 마운트 전에 호출한다 */
export function applyDesign(d: Design): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = buildDesignCss(d);
}
