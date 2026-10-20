// 표(행 배열)를 여러 텍스트 형식으로 만드는 순수 함수들: HTML, 아스키 표, 마크다운 표. TSV/CSV 는 tableCsv.ts.
// 첫 행(rows[0])을 머리글로 본다.
import { parseNumber } from './tableOps';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]);
const cellHtml = (s: string) => esc(s).replace(/\r?\n/g, '<br>');

/** `<table>` HTML. 머리글은 thead/th, 본문은 tbody/td. 셀 안 줄바꿈은 <br> */
export function toHtml(rows: string[][]): string {
  if (!rows.length) return '<table></table>';
  const [head, ...body] = rows;
  const tr = (cells: string[], tag: 'th' | 'td') => `<tr>${cells.map((c) => `<${tag}>${cellHtml(c)}</${tag}>`).join('')}</tr>`;
  return [
    '<table>',
    `<thead>${tr(head, 'th')}</thead>`,
    `<tbody>\n${body.map((r) => tr(r, 'td')).join('\n')}\n</tbody>`,
    '</table>',
  ].join('\n');
}

/** 글자 하나가 차지하는 칸 수: 한글·한자·전각은 2, 결합 문자는 0, 나머지 1 */
function charWidth(cp: number): number {
  if (cp === 0) return 0;
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff)
  ) return 2;
  return 1;
}
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0)!);
  return w;
}

const flat = (s: string) => s.replace(/\s*\r?\n\s*/g, ' ');
const pad = (s: string, width: number, right: boolean) => {
  const gap = ' '.repeat(Math.max(0, width - textWidth(s)));
  return right ? gap + s : s + gap;
};

/**
 * 고정폭 글꼴용 아스키 표:
 * +------+-----+
 * | 이름 |  값 |
 * +======+=====+
 * 숫자만 있는 열은 오른쪽 맞춤. 한글 등 전각 글자는 2칸으로 계산한다.
 */
export function toAscii(rows: string[][]): string {
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const grid = rows.map((r) => Array.from({ length: cols }, (_, i) => flat(r[i] ?? '')));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(1, ...grid.map((r) => textWidth(r[c]))));
  const numeric = Array.from({ length: cols }, (_, c) => {
    const body = grid.slice(1).map((r) => r[c]).filter((v) => v !== '');
    return body.length > 0 && body.every((v) => parseNumber(v) !== null);
  });
  const line = (ch: string) => `+${widths.map((w) => ch.repeat(w + 2)).join('+')}+`;
  const row = (r: string[]) => `|${r.map((v, c) => ` ${pad(v, widths[c], numeric[c])} `).join('|')}|`;
  const out = [line('-'), row(grid[0])];
  if (grid.length > 1) { out.push(line('=')); for (const r of grid.slice(1)) out.push(row(r)); }
  out.push(line('-'));
  return out.join('\n');
}

/** GFM 마크다운 표. 셀의 `|` 는 이스케이프하고 줄바꿈은 <br> */
export function toMarkdown(rows: string[][]): string {
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const line = (r: string[]) => `| ${Array.from({ length: cols }, (_, i) => cell(r[i])).join(' | ')} |`;
  return [line(rows[0]), `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}
