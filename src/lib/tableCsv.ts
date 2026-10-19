// 표 ↔ CSV/TSV 변환의 순수 함수들 (에디터와 무관)

// RFC4180 식 파서. 따옴표는 필드가 `"` 로 시작할 때만 인정한다(엑셀이 TSV 에서도 같은 규칙으로 감싼다).
export function parseDelimited(text: string, delim: string): string[][] {
  const src = text.replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (src[i] === '"' && field === '') {
      i++;
      for (; i < n; i++) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; }
          else { i++; break; }
        } else field += src[i];
      }
      continue;
    }
    const ch = src[i];
    if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
    i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// 터미널(Claude Code 등)이 그리는 박스 문자 표(┌─┬─┐ │ a │ b │ ├─┼─┤ └─┴─┘)를 읽는다.
// 셀이 길면 여러 줄로 접혀 있으므로 구분선(├ ┌ └) 사이의 줄들을 한 행으로 보고 열별로 공백으로 이어 붙인다.
export function parseBoxTable(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  const isSep = (l: string) => /^[┌├└╭╰]/.test(l) && l.includes('─');
  const isRow = (l: string) => /^[│┃]/.test(l) && /[│┃]$/.test(l);
  if (!lines.length || !lines.every((l) => isSep(l) || isRow(l))) return null;
  const hasInnerSep = lines.some((l, i) => i > 0 && i < lines.length - 1 && isSep(l));
  const rows: string[][] = [];
  let cur: string[] | null = null;
  let cols = 0;
  for (const l of lines) {
    if (isSep(l)) { cur = null; continue; }
    const cells = l.slice(1, -1).split(/[│┃]/).map((c) => c.trim());
    if (!cols) cols = cells.length;
    else if (cells.length !== cols) return null;
    const row = cur;
    if (row && hasInnerSep) cells.forEach((c, i) => { if (c) row[i] = row[i] ? `${row[i]} ${c}` : c; });
    else { cur = cells; rows.push(cells); }
  }
  return rows.length >= 2 && cols >= 2 ? rows : null;
}

export type PastedTable = { kind: 'tsv' | 'csv' | 'box'; rows: string[][] };

// 모든 행의 열 수가 같고 2행·2열 이상이어야 표로 본다. 탭이 있으면 TSV(자동 변환), 없고 쉼표만 있으면 CSV(확인 필요).
export function detectTable(text: string): PastedTable | null {
  if (!text.includes('\n')) return null;
  const box = parseBoxTable(text);
  if (box) return { kind: 'box', rows: box };
  const kind = text.includes('\t') ? 'tsv' : text.includes(',') ? 'csv' : null;
  if (!kind) return null;
  const rows = parseDelimited(text, kind === 'tsv' ? '\t' : ',');
  if (rows.length < 2) return null;
  const cols = rows[0].length;
  if (cols < 2 || rows.some((r) => r.length !== cols)) return null;
  return { kind, rows };
}

const quoteIf = (s: string, special: RegExp) => (special.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export const toTsv = (rows: string[][]) =>
  rows.map((r) => r.map((c) => quoteIf(c, /[\t\n\r"]/)).join('\t')).join('\n');

export const toCsv = (rows: string[][]) =>
  rows.map((r) => r.map((c) => quoteIf(c, /[,\n\r"]/)).join(',')).join('\r\n');
