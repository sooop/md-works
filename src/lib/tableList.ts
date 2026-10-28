// 표 ↔ 목록(JSON·YAML·마크다운 목록)·표 형식 텍스트(CSV·TSV·GFM·아스키·HTML) 변환기. 규칙 기반이며 DOM 은 parseHtmlTable 의 DOMParser 뿐이다.
// 모든 변환은 문자열 2차원 배열(grid)을 거친다: 입력 형식마다 파서 하나, 출력 형식마다 직렬화기 하나.
// 포팅 원본: 표 목록 변환기 포팅 가이드(j1~j4).
import yaml from 'js-yaml';

export type TableFormat = 'HTML' | 'ASCII' | 'GFM' | 'TSV' | 'CSV' | 'CSV(;)' | 'PIPE';
export type ListFormat = 'json' | 'yaml' | 'md';
export type ArrMode = 'cols' | 'rows';
export type HeaderMode = 'auto' | 'first' | 'last' | 'none';
export type MdStyle = 'record' | 'tree' | 'line';
export type MdKind = 'record' | 'line' | 'kv' | 'path';
/** JSON·YAML 변환 옵션: infer 값 형식 추론(숫자·불리언), unflat 점·[n] 표기를 중첩으로 복원, arr 배열을 열로/행으로 펼침 */
export interface ListOpts { infer: boolean; unflat: boolean; arr: ArrMode }
interface MdNode { text: string; children: MdNode[] }

/* ===== 공통 유틸 ===== */
const NUM_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;
export const isNum = (s: string) => NUM_RE.test(String(s).trim());


function normalize(grid: string[][]): string[][] {
  const n = grid.reduce((m, r) => Math.max(m, r.length), 0);
  return grid.map((r) => { const c = r.slice(); while (c.length < n) c.push(''); return c; });
}

/* ===== 표 입력 파서 ===== */
function parseDelim(text: string, delim: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false, i = 0;
  const s = text.replace(/\r\n?/g, '\n');
  while (i < s.length) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i += 2; continue; } q = false; i++; continue; }
      cur += ch; i++; continue;
    }
    if (ch === '"' && cur === '') { q = true; i++; continue; }
    if (ch === delim) { row.push(cur); cur = ''; i++; continue; }
    if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; continue; }
    cur += ch; i++;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}
function detectDelim(text: string): string {
  if (text.includes('\t')) return '\t';
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '|']) {
    const rows = parseDelim(text.split('\n').slice(0, 30).join('\n'), d);
    if (!rows.length) continue;
    const counts: Record<number, number> = {}; rows.forEach((r) => { counts[r.length] = (counts[r.length] || 0) + 1; });
    const [n, k] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const score = Number(n) > 1 ? k / rows.length * 100 + Number(n) : 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

const BORDER_CH = /^[┌┬┐├┼┤└┴┘─━═╔╦╗╠╬╣╚╩╝╭╮╯╰╞╪╡╤╧╟╫╢╥╨┏┳┓┣╋┫┗┻┛┠┯┷┨┿╂\-+=\s]+$/;
const isBorder = (l: string) => l.trim().length > 1 && BORDER_CH.test(l) && /[─━═=\-]/.test(l);
function splitBars(line: string): string[] {
  const t = line.trim().split(/[│┃║|]/);
  if (t.length && t[0].trim() === '') t.shift();
  if (t.length && t[t.length - 1].trim() === '') t.pop();
  return t.map((c) => c.trim());
}
function parseAscii(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  const blocks: string[][][] = [[]];
  lines.forEach((l, idx) => {
    if (isBorder(l)) { if (blocks[blocks.length - 1].length && idx !== lines.length - 1) { blocks.push([]); } }
    else blocks[blocks.length - 1].push(splitBars(l));
  });
  const bl = blocks.filter((b) => b.length);
  const merge = (b: string[][]) => { const n = Math.max(...b.map((r) => r.length)); const out: string[] = [];
    for (let c = 0; c < n; c++) out.push(b.map((r) => r[c] || '').filter((x) => x !== '').join('\n')); return out; };
  let rows: string[][];
  if (bl.length === 1) rows = bl[0];
  else if (bl.length === 2 && bl[1].length > 1) rows = [merge(bl[0]), ...bl[1]];
  else rows = bl.map(merge);
  return rows;
}

function splitPipes(line: string): string[] {
  const out: string[] = []; let cur = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '|') { cur += '|'; i++; }
    else if (line[i] === '|') { out.push(cur); cur = ''; }
    else cur += line[i];
  }
  out.push(cur);
  if (out.length && out[0].trim() === '') out.shift();
  if (out.length && out[out.length - 1].trim() === '') out.pop();
  return out.map((c) => c.trim().replace(/<br\s*\/?>/gi, '\n'));
}
const GFM_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
function parseGfm(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  return lines.filter((l) => !(GFM_SEP.test(l) && l.includes('-'))).map(splitPipes);
}

/** 모든 줄이 `\|` 로 시작하면 마크다운 이스케이프된 표 소스로 보고 되돌린다: `\|` → `|`, 줄끝의 강제 줄바꿈 `\` 제거 */
export function unescapeMdTable(text: string): string {
  const t = text.replace(/\r\n?/g, '\n');
  const ls = t.split('\n').filter((l) => l.trim() !== '');
  if (ls.length < 2 || !ls.every((l) => l.trim().startsWith('\\|'))) return text;
  return t.split('\n').map((l) => l.replace(/\\+\s*$/, '').replace(/\\\|/g, '|')).join('\n');
}

/** 마크다운 표 소스(머리글 줄 + 구분줄 + 본문)만으로 된 글자를 표로 읽는다. 이스케이프된 소스도 받는다. 아니면 null */
export function parseGfmSource(text: string): string[][] | null {
  const t = unescapeMdTable(text).replace(/\r\n?/g, '\n');
  const ls = t.split('\n').filter((l) => l.trim() !== '');
  if (ls.length < 2 || !ls.every((l) => l.includes('|'))) return null;
  if (!(GFM_SEP.test(ls[1]) && ls[1].includes('-'))) return null;
  const grid = parseGfm(t);
  return grid.length && grid[0].length >= 1 ? normalize(grid) : null;
}

function parseHtmlTable(html: string): string[][] | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tb = doc.querySelector('table');
  if (!tb) return null;
  const rows: string[][] = []; const carry: { n: number; t: string }[] = [];
  tb.querySelectorAll('tr').forEach((tr) => {
    if (tr.closest('table') !== tb) return;
    const row: string[] = []; let c = 0;
    const fillCarry = () => { while (carry[c] && carry[c].n > 0) { row.push(carry[c].t); carry[c].n--; c++; } };
    Array.from(tr.children).forEach((cell) => {
      if (!/^(TD|TH)$/.test(cell.tagName)) return;
      fillCarry();
      cell.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
      const t = cell.textContent.split('\n').map((x) => x.replace(/[ \t\r\f ]+/g, ' ').trim()).join('\n').replace(/^\n+|\n+$/g, '');
      const cs = parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
      const rs = parseInt(cell.getAttribute('rowspan') || '1', 10) || 1;
      for (let k = 0; k < cs; k++) { row.push(k === 0 ? t : ''); if (rs > 1) carry[c] = { n: rs - 1, t: k === 0 ? t : '' }; c++; }
    });
    fillCarry();
    if (row.length) rows.push(row);
  });
  return rows;
}

function detectTableFormat(text: string, html?: string): TableFormat {
  const t = text.trim();
  if (html && /<table[\s>]/i.test(html)) return 'HTML';
  if (/<table[\s>]/i.test(t)) return 'HTML';
  const ls = t.split(/\r?\n/);
  if (ls.some((l) => /^\s*[┌├└╔╠╚╭│┃║]/.test(l)) || (ls.some((l) => /^\s*\+[-=+]+\+\s*$/.test(l)))) return 'ASCII';
  if (ls.some((l) => GFM_SEP.test(l) && l.includes('-') && (l.includes('|') || ls.length > 1)) && ls.some((l) => l.includes('|') && !GFM_SEP.test(l))) return 'GFM';
  const d = detectDelim(t);
  return d === '\t' ? 'TSV' : d === ';' ? 'CSV(;)' : d === '|' ? 'PIPE' : 'CSV';
}
export function parseTableText(text: string, html?: string): { grid: string[][]; fmt: TableFormat } | null {
  const fmt = detectTableFormat(text, html);
  let grid: string[][] | null;
  if (fmt === 'HTML') grid = parseHtmlTable(html && /<table[\s>]/i.test(html) ? html : text);
  else if (fmt === 'ASCII') grid = parseAscii(text);
  else if (fmt === 'GFM') grid = parseGfm(text);
  else grid = parseDelim(text, fmt === 'TSV' ? '\t' : fmt === 'CSV(;)' ? ';' : fmt === 'PIPE' ? '|' : ',');
  if (!grid || !grid.length) return null;
  return { grid: normalize(grid), fmt };
}

/* ===== JSON / YAML 데이터 <-> 표 ===== */
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const scalarStr = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

type Row = Record<string, string>;
function crossRows(lists: Row[][]): Row[] {
  let rows: Row[] = [{}];
  for (const sub of lists) rows = rows.flatMap((r) => sub.map((s) => ({ ...r, ...s })));
  return rows;
}
function flatRows(v: unknown, p: string, mode: ArrMode): Row[] {
  if (Array.isArray(v)) {
    if (!v.length) return [{ [p || 'value']: '' }];
    if (mode === 'rows') return v.flatMap((x) => flatRows(x, p, mode));
    return crossRows(v.map((x, i) => flatRows(x, p + '[' + i + ']', mode)));
  }
  if (isObj(v)) {
    const ks = Object.keys(v);
    if (!ks.length) return [{ [p || 'value']: '' }];
    return crossRows(ks.map((k) => flatRows(v[k], p ? p + '.' + k : k, mode)));
  }
  return [{ [p || 'value']: scalarStr(v) }];
}

function valueToGrid(input: unknown, mode: ArrMode): string[][] | null {
  let data: any = input;
  if (Array.isArray(data) && data.length && data.every(Array.isArray)) {
    return normalize(data.map((r) => r.map(scalarStr)));
  }
  if (isObj(data)) {
    const ks = Object.keys(data);
    if (ks.length === 1 && Array.isArray(data[ks[0]])) data = data[ks[0]];
    else if (ks.length > 1 && ks.every((k) => isObj(data[k]))) data = ks.map((k) => ({ key: k, ...data[k] }));
  }
  const list = Array.isArray(data) ? data : [data];
  const rows = list.flatMap((x) => flatRows(x, '', mode));
  const head: string[] = [];
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (!head.includes(k)) head.push(k); }));
  if (!head.length) return null;
  return [head, ...rows.map((r) => head.map((k) => (k in r ? r[k] : '')))];
}

function inferVal(s: string): string | number | boolean {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (NUM_RE.test(s) && s.length < 16) return Number(s);
  return s;
}
function pathTokens(key: string): (string | number)[] {
  if (!/[.[]/.test(key)) return [key];
  const t: (string | number)[] = [];
  key.split('.').forEach((seg) => {
    const m = seg.match(/^([^[\]]*)((?:\[\d+\])*)$/);
    if (!m) { t.push(seg); return; }
    if (m[1] !== '') t.push(m[1]);
    (m[2].match(/\d+/g) || []).forEach((n) => t.push(Number(n)));
  });
  return t.length ? t : [key];
}
function setPath(obj: any, toks: (string | number)[], val: unknown) {
  let cur = obj;
  for (let i = 0; i < toks.length - 1; i++) {
    const t = toks[i], nx = toks[i + 1];
    if (cur[t] === undefined || cur[t] === null || typeof cur[t] !== 'object') cur[t] = typeof nx === 'number' ? [] : {};
    cur = cur[t];
  }
  cur[toks[toks.length - 1]] = val;
}
function gridToObjects(head: string[], body: string[][], o: ListOpts): unknown[] {
  const toks = head.map((h) => (o.unflat ? pathTokens(h) : [h]));
  return body.map((r) => {
    const obj = {};
    head.forEach((_, i) => {
      const v = o.infer ? inferVal(r[i] ?? '') : (r[i] ?? '');
      setPath(obj, toks[i], v);
    });
    return compactArrays(obj);
  });
}
function compactArrays(v: any): any {
  if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(compactArrays);
  if (isObj(v)) { Object.keys(v).forEach((k) => { v[k] = compactArrays(v[k]); }); }
  return v;
}

export function toJsonText(head: string[], body: string[][], o: ListOpts): string { return JSON.stringify(gridToObjects(head, body, o), null, 2); }
export function toYamlText(head: string[], body: string[][], o: ListOpts): string {
  return yaml.dump(gridToObjects(head, body, o), { lineWidth: -1, noRefs: true });
}
export function jsonTextToGrid(text: string, o: ListOpts): string[][] {
  const grid = valueToGrid(JSON.parse(text), o.arr);
  if (!grid) throw new Error('표로 만들 항목이 없습니다.');
  return grid;
}
export function yamlTextToGrid(text: string, o: ListOpts): string[][] {
  const data = yaml.load(text);
  if (data === null || typeof data !== 'object') throw new Error('YAML 이 목록이나 맵 구조가 아닙니다.');
  const grid = valueToGrid(data, o.arr);
  if (!grid) throw new Error('표로 만들 항목이 없습니다.');
  return grid;
}

/* ===== 마크다운 목록 <-> 표 ===== */
const HDR_KEY = /^(헤더|머리글|header|headers|column|columns|컬럼|칼럼|열)\s*[:：]\s*(.+)$/i;
const fixCell = (s: unknown) => String(s).replace(/<br\s*\/?>/gi, '\n').trim();

function pairOf(t: string): [string, string] | null {
  let m = t.match(/^([^:：\n]{1,40}?)\s*：\s*([\s\S]*)$/);
  if (m) return [m[1].trim(), m[2].trim()];
  m = t.match(/^([^:：\n]{1,40}?)\s*:(?:\s+([\s\S]*))?$/);
  if (m && !/^\/\//.test(m[2] || '')) return [m[1].trim(), (m[2] || '').trim()];
  return null;
}
function lineCells(t: string): string[] | null {
  if (t.includes('|')) { const c = splitPipes(t); return c.length >= 2 ? c : null; }
  if (t.includes('\t')) return t.split('\t').map((x) => x.trim());
  return null;
}
function splitHdr(t: string): string[] {
  const c = t.includes('|') ? splitPipes(t) : t.includes('\t') ? t.split('\t') : t.split(/\s*[,;，]\s*/);
  return c.map((x) => x.trim()).filter((x) => x !== '');
}

function mdTree(text: string): { roots: MdNode[]; plain: { text: string; after: boolean }[] } {
  const roots: MdNode[] = [], plain: { text: string; after: boolean }[] = []; const stack: { ind: number; node: MdNode }[] = [];
  text.replace(/\r\n?/g, '\n').split('\n').forEach((raw) => {
    if (!raw.trim()) return;
    const m = raw.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    const ind = (raw.match(/^\s*/)![0]).replace(/\t/g, '    ').length;
    if (m) {
      const node: MdNode = { text: m[3].replace(/^\[[ xX]\]\s+/, '').trim(), children: [] };
      const mi = m[1].replace(/\t/g, '    ').length;
      while (stack.length && stack[stack.length - 1].ind >= mi) stack.pop();
      (stack.length ? stack[stack.length - 1].node.children : roots).push(node);
      stack.push({ ind: mi, node });
    } else if (ind > 0 && stack.length) {
      stack[stack.length - 1].node.text += '\n' + raw.trim();
    } else {
      plain.push({ text: raw.trim(), after: roots.length > 0 });
    }
  });
  return { roots, plain };
}
const allNodes = (nodes: MdNode[]): MdNode[] => nodes.flatMap((n) => [n, ...allNodes(n.children)]);
function leafPaths(nodes: MdNode[], pre: string[] = []): string[][] {
  return nodes.flatMap((n) => (n.children.length ? leafPaths(n.children, [...pre, n.text]) : [[...pre, n.text]]));
}
function collectPairs(children: MdNode[], prefix: string, out: Record<string, string>) {
  children.forEach((ch) => {
    const p = pairOf(ch.text) || [ch.text, ''];
    const path = prefix ? prefix + '.' + p[0] : p[0];
    if (!ch.children.length) { out[path] = p[1]; return; }
    if (ch.children.every((g) => pairOf(g.text))) { if (p[1]) out[path] = p[1]; collectPairs(ch.children, path, out); }
    else out[path] = [p[1], ...leafPaths(ch.children).map((x) => x.join(' > '))].filter(Boolean).join(', ');
  });
}
function recordsToGrid(recs: Record<string, string>[], firstKey: string): string[][] {
  const head = firstKey ? [firstKey] : [];
  recs.forEach((r) => Object.keys(r).forEach((k) => { if (!head.includes(k)) head.push(k); }));
  return [head, ...recs.map((r) => head.map((k) => r[k] ?? ''))];
}

export function parseMdList(text: string, o: { headerMode: HeaderMode; headerText?: string }): { grid: string[][]; kind: MdKind } | null {
  const { roots, plain } = mdTree(text);
  if (!roots.length) return null;
  let hdr: string[] | null = null, kind: MdKind = 'path';
  const mode = o.headerMode;
  if (mode !== 'none') {
    for (let i = 0; i < roots.length && !hdr; i++) {
      const m = roots[i].text.match(HDR_KEY);
      if (m && !roots[i].children.length) { hdr = splitHdr(m[2]); roots.splice(i, 1); }
    }
    for (let i = 0; i < plain.length && !hdr; i++) {
      const m = plain[i].text.match(HDR_KEY);
      if (m) hdr = splitHdr(m[2]);
    }
    if (!hdr && mode === 'auto') {
      const pl = plain.find((p) => !p.after && splitHdr(p.text).length >= 2) || plain.find((p) => p.after && splitHdr(p.text).length >= 2);
      if (pl && (pl.text.includes('|') || pl.text.includes('\t') || pl.text.includes(','))) hdr = splitHdr(pl.text);
    }
  }
  let rows: string[][], hdrFromData = false;
  const withKids = roots.filter((r) => r.children.length);
  const segs = (t: string) => t.split(/\s*\|\s*|\s*[,;]\s+/).filter((x) => x !== '');
  if (withKids.length && withKids.every((r) => r.children.every((c) => pairOf(c.text)))) {
    kind = 'record';
    const recs = roots.map((r) => { const o2: Record<string, string> = {}; const p = pairOf(r.text); if (p) o2[p[0]] = p[1]; else o2['항목'] = r.text; collectPairs(r.children, '', o2); return o2; });
    rows = recordsToGrid(recs, ''); hdrFromData = true;
  } else if (!withKids.length && roots.every((r) => { const s = segs(r.text); return s.length >= 2 && s.every((x) => pairOf(x)); })) {
    kind = 'record';
    rows = recordsToGrid(roots.map((r) => { const o2: Record<string, string> = {}; segs(r.text).forEach((x) => { const p = pairOf(x)!; o2[p[0]] = p[1]; }); return o2; }), '');
    hdrFromData = true;
  } else {
    const nodes = allNodes(roots), cr = nodes.filter((n) => lineCells(n.text));
    if (cr.length && cr.length / nodes.length >= 0.8) {
      kind = 'line'; rows = cr.map((n) => lineCells(n.text)!);
    } else if (!withKids.length && roots.every((r) => pairOf(r.text))) {
      kind = 'kv'; rows = [['키', '값'], ...roots.map((r) => pairOf(r.text)!)]; hdrFromData = true;
    } else {
      kind = 'path'; rows = leafPaths(roots);
    }
  }
  rows = rows.map((r) => r.map(fixCell));
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  let head: string[] | undefined;
  if (hdrFromData) head = rows.shift();
  else if (hdr) head = hdr;
  else if (mode === 'first') head = rows.shift();
  else if (mode === 'last') head = rows.pop();
  else if (mode === 'auto' && kind === 'line' && rows.length > 1 && !rows[0].some((c) => isNum(c) && c !== '')) head = rows.shift();
  if (hdr && hdrFromData && kind !== 'kv') {
    /* 헤더 줄이 있으면 데이터 키 대신 헤더 이름을 사용 */
    head = head!.map((h, i) => hdr![i] ?? h);
  }
  const def = (i: number) => (kind === 'path' && cols > 1 ? (i + 1) + '단계' : kind === 'path' ? '항목' : '열 ' + (i + 1));
  const n = Math.max(cols, head ? head.length : 0);
  const given = head;
  const outHead = Array.from({ length: n }, (_, i) => (given && given[i] !== undefined && given[i] !== '' ? fixCell(given[i]) : def(i)));
  if (o.headerText) splitHdr(o.headerText).forEach((h, i) => { if (i < n) outHead[i] = h; });
  return { grid: normalize([outHead, ...rows].map((r) => r.slice(0, n))), kind };
}

export function toMdList(head: string[], body: string[][], o: { style: MdStyle; inclHeader: boolean }): string {
  const cl = (s: unknown) => String(s).replace(/\r?\n/g, '<br>');
  const out: string[] = [];
  if (o.style === 'record') {
    body.forEach((r) => { head.forEach((h, i) => out.push((i ? '  ' : '') + '- ' + h + ': ' + cl(r[i] ?? ''))); });
  } else if (o.style === 'tree') {
    if (o.inclHeader) out.push('- 헤더: ' + head.map(cl).join(' | '));
    let prev: string[] = [];
    body.forEach((r) => {
      const row = r.map(cl);
      let d = 0; while (d < row.length && d < prev.length && prev[d] === row[d]) d++;
      if (d === row.length) d = row.length - 1;
      for (let i = d; i < row.length; i++) out.push('  '.repeat(i) + '- ' + row[i]);
      prev = row;
    });
  } else {
    const esc = (s: unknown) => cl(s).replace(/\|/g, '\\|');
    if (o.inclHeader) out.push('- ' + head.map(esc).join(' | '));
    body.forEach((r) => out.push('- ' + r.map(esc).join(' | ')));
  }
  return out.join('\n');
}

/* ===== 공개 API: 머리글 정리 · 입력 형식 감지 · 입력/출력 한 곳 ===== */

/** 첫 행을 머리글로 본 { head, body }. 빈 머리글 칸은 `열 N` 으로 채운다 */
export function headBody(rows: string[][]): { head: string[]; body: string[][] } {
  const head = (rows[0] ?? []).map((h, i) => (String(h).trim() === '' ? `열 ${i + 1}` : String(h)));
  return { head, body: rows.slice(1) };
}

/** 목록 텍스트가 JSON·YAML·마크다운 중 무엇인지(붙여넣기 감지용). `[`·`{` 로 시작하면 JSON, 모든 줄이 목록 표지면 마크다운, 객체로 읽히면 YAML */
export function detectListFormat(text: string): ListFormat {
  const t = text.trim();
  if (/^[[{]/.test(t)) return 'json';
  const ls = t.split('\n').filter((l) => l.trim());
  const bullet = /^\s*([-*+]|\d+[.)])\s/;
  if (ls.every((l) => bullet.test(l))) return 'md';
  try { const d = yaml.load(t); if (d && typeof d === 'object') return 'yaml'; } catch { /* 마크다운으로 처리 */ }
  return 'md';
}

export type InputFormat = 'auto' | ListFormat | 'table';
export interface ImportOpts extends ListOpts { headerMode: HeaderMode; headerText?: string }
export interface ImportResult {
  /** 첫 행이 머리글인 직사각형 표 */
  grid: string[][];
  /** 실제로 적용된 형식 */
  kind: ListFormat | 'table';
  /** 형식 이름(화면 표시용) */
  label: string;
  /** 마크다운 목록일 때 해석 방식 */
  mdKind?: MdKind;
}

const MD_KIND_LABEL: Record<MdKind, string> = { record: '키: 값 레코드', line: '한 줄 구분', kv: '키·값', path: '계층 경로' };

/** 표 형식인지 목록인지 정한다. 표의 뚜렷한 흔적(HTML·박스·GFM 구분줄·탭)이 먼저, 그다음 JSON·마크다운·YAML, 나머지는 구분자 표 */
function detectInput(text: string, html?: string): 'table' | ListFormat {
  const t = text.trim();
  const strong = (html && /<table[\s>]/i.test(html)) || /<table[\s>]/i.test(t) ||
    t.split(/\r?\n/).some((l) => /^\s*[┌├└╔╠╚╭│┃║]/.test(l) || /^\s*\+[-=+]+\+\s*$/.test(l));
  if (strong) return 'table';
  const f = detectTableFormat(t, html);
  if (f === 'GFM' || f === 'TSV') return 'table';
  const l = detectListFormat(t);
  if (l !== 'md') return l;
  // 모든 줄이 목록 표지면 마크다운. 그렇지 않은 md 판정은 구분자 표로 본다
  const ls = t.split('\n').filter((x) => x.trim());
  return ls.length && ls.every((x) => /^\s*([-*+]|\d+[.)])\s/.test(x)) ? 'md' : 'table';
}

/**
 * 입력 텍스트(JSON·YAML·마크다운 목록·CSV·TSV·GFM·아스키·HTML 표)를 표로 바꾼다. 실패하면 이유를 담은 Error 를 던진다.
 * format 이 'auto' 면 내용을 보고 정한다. html 은 붙여넣기 이벤트의 text/html(있으면 서식 있는 표를 정확히 읽는다).
 */
export function importToGrid(text: string, format: InputFormat, o: ImportOpts, html?: string): ImportResult {
  if (!text.trim()) throw new Error('내용이 비어 있습니다.');
  text = unescapeMdTable(text);
  const kind = format === 'auto' ? detectInput(text, html) : format;
  if (kind === 'json') return { kind: 'json', grid: jsonTextToGrid(text, o), label: 'JSON' };
  if (kind === 'yaml') return { kind: 'yaml', grid: yamlTextToGrid(text, o), label: 'YAML' };
  if (kind === 'md') {
    const r = parseMdList(text, o);
    if (!r) throw new Error('목록 항목을 찾지 못했습니다.');
    return { kind: 'md', grid: r.grid, label: `마크다운 목록 (${MD_KIND_LABEL[r.kind]})`, mdKind: r.kind };
  }
  const r = parseTableText(text, html);
  if (!r || r.grid.length < 1) throw new Error('표를 읽지 못했습니다.');
  return { kind: 'table', grid: r.grid, label: r.fmt === 'CSV(;)' ? 'CSV (;)' : r.fmt === 'PIPE' ? '| 구분' : r.fmt };
}

export type ListExportFormat = 'json' | 'yaml' | 'md-record' | 'md-tree' | 'md-line';
export interface ExportOpts extends Pick<ListOpts, 'infer' | 'unflat'> { inclHeader: boolean }

/** 표(첫 행 머리글)를 목록 텍스트로 만든다 */
export function exportListText(rows: string[][], format: ListExportFormat, o: ExportOpts): string {
  const { head, body } = headBody(rows);
  const lo = { infer: o.infer, unflat: o.unflat, arr: 'cols' as const };
  if (format === 'json') return toJsonText(head, body, lo);
  if (format === 'yaml') return toYamlText(head, body, lo);
  return toMdList(head, body, { style: format.slice(3) as MdStyle, inclHeader: o.inclHeader });
}
