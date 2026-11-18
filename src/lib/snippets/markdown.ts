// 글감 읽기 화면용 작은 마크다운 해석기(순수 함수). HTML 문자열을 만들지 않고 AST 만 돌려준다 — 화면은 이 AST 를
// Svelte 템플릿(텍스트 노드)으로 그리므로 글감 안의 `<script>` 같은 마크업은 글자 그대로 보이고 실행되지 않는다(XSS 없음).
// 지원: 제목, 문단(줄바꿈 유지), 굵게·기울임·취소선·인라인 코드, 링크·이미지, 목록(중첩·번호·할 일), 인용, 코드 블록, 구분선, 표.
// 링크·이미지 주소는 허용한 프로토콜만 통과한다(safeHref·safeSrc).

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong' | 'em' | 'del'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'a'; href: string; c: Inline[] }
  | { t: 'img'; src: string; alt: string }
  | { t: 'br' };

export interface ListItem { blocks: Block[]; checked: boolean | null }
export type Align = 'left' | 'center' | 'right' | null;
export type Block =
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'hr' }
  | { t: 'table'; head: Inline[][]; align: Align[]; rows: Inline[][][] };

const MAX_DEPTH = 12;
// 주소 판별을 속이는 공백·제어·보이지 않는 문자
const INVISIBLE = new RegExp('[\\u0000-\\u0020\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\ufeff]', 'g');

/** 링크 주소: http(s)·mailto 와 문서 안 쪽지(#)만. 아니면 빈 문자열 */
export function safeHref(u: string): string {
  const v = u.trim();
  if (v.startsWith('#')) return v;
  return /^(https?:|mailto:)/.test(v.replace(INVISIBLE, '').toLowerCase()) ? v : '';
}
/** 이미지 주소: http(s)와 data:image/(래스터)만. svg 는 제외 */
export function safeSrc(u: string): string {
  const v = u.trim();
  const n = v.replace(INVISIBLE, '').toLowerCase();
  if (/^https?:\/\//.test(n)) return v;
  return /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,/.test(n) ? v.replace(/\s+/g, '') : '';
}

// ---------------------------------------------------------------- 인라인
const PUNCT = /[\\`*_{}\[\]()#+\-.!~|<>]/;
const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);
const TRAIL = /[.,;:!?)\]}'"]+$/;

/** `[`·`(` 짝을 맞춰 닫는 위치를 찾는다. 없으면 -1 */
function closeAt(s: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') { i++; continue; }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return -1;
}

/** `(주소 "제목")` 의 안쪽에서 주소만 꺼낸다 */
function destOf(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('<')) { const e = t.indexOf('>'); return e > 0 ? t.slice(1, e) : ''; }
  return /^\S+/.exec(t)?.[0] ?? '';
}

function pushText(out: Inline[], v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last?.t === 'text') last.v += v;
  else out.push({ t: 'text', v });
}

export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let buf = '';
  const flush = () => { pushText(out, buf); buf = ''; };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && PUNCT.test(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
    if (ch === '\n') { flush(); out.push({ t: 'br' }); i++; continue; }
    if (ch === '`') {
      const run = /^`+/.exec(src.slice(i))![0];
      const end = src.indexOf(run, i + run.length);
      if (end > 0) { flush(); out.push({ t: 'code', v: src.slice(i + run.length, end).replace(/^ (.*) $/s, '$1') }); i = end + run.length; continue; }
      buf += run; i += run.length; continue;
    }
    // 이미지 ![alt](src) · 링크 [글](href)
    if (ch === '[' || (ch === '!' && src[i + 1] === '[')) {
      const img = ch === '!';
      const lb = img ? i + 1 : i;
      const rb = closeAt(src, lb, '[', ']');
      if (rb > 0 && src[rb + 1] === '(') {
        const rp = closeAt(src, rb + 1, '(', ')');
        if (rp > 0) {
          const label = src.slice(lb + 1, rb);
          const dest = destOf(src.slice(rb + 2, rp));
          flush();
          if (img) {
            const url = safeSrc(dest);
            if (url) out.push({ t: 'img', src: url, alt: label });
            else pushText(out, label);
          } else {
            const url = safeHref(dest);
            if (url && depth < 6) out.push({ t: 'a', href: url, c: parseInline(label, depth + 1) });
            else out.push(...parseInline(label, depth + 1));
          }
          i = rp + 1; continue;
        }
      }
    }
    // <https://…> 자동 링크
    if (ch === '<') {
      const m = /^<(https?:\/\/[^\s<>]+)>/i.exec(src.slice(i));
      if (m) { flush(); out.push({ t: 'a', href: m[1], c: [{ t: 'text', v: m[1] }] }); i += m[0].length; continue; }
    }
    // 맨 주소
    if ((ch === 'h' || ch === 'H') && !isWord(src[i - 1])) {
      const m = /^https?:\/\/[^\s<>]+/i.exec(src.slice(i));
      if (m) {
        const url = m[0].replace(TRAIL, '');
        flush(); out.push({ t: 'a', href: url, c: [{ t: 'text', v: url }] }); i += url.length; continue;
      }
    }
    // 강조: ** __ ~~ * _
    if ((ch === '*' || ch === '_' || ch === '~') && depth < 6) {
      const two = src.startsWith(ch + ch, i);
      const mark = two ? ch + ch : ch;
      if (ch !== '~' || two) {
        const from = i + mark.length;
        const okOpen = src[from] !== undefined && !/\s/.test(src[from]) && (ch !== '_' || !isWord(src[i - 1]));
        if (okOpen) {
          let end = from;
          let found = -1;
          while ((end = src.indexOf(mark, end)) > 0) {
            const prevOk = !/\s/.test(src[end - 1]) && src[end - 1] !== '\\';
            const nextOk = ch !== '_' || !isWord(src[end + mark.length]);
            // 한 글자 강조(*)는 ** 의 앞쪽 절반을 닫는 표시로 오인하지 않는다
            const notDouble = two || src[end + 1] !== ch;
            if (end > from && prevOk && nextOk && notDouble) { found = end; break; }
            end += mark.length;
          }
          if (found > 0) {
            flush();
            out.push({ t: ch === '~' ? 'del' : two ? 'strong' : 'em', c: parseInline(src.slice(from, found), depth + 1) });
            i = found + mark.length; continue;
          }
        }
      }
      buf += ch; i++; continue;
    }
    buf += ch; i++;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- 블록
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const LIST = /^([ ]*)([-*+]|\d{1,9}[.)])[ ]+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const indentOf = (l: string) => /^ */.exec(l)![0].length;
const blank = (l: string) => !l.trim();

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') { cur += '|'; i++; }
    else if (t[i] === '|') { cells.push(cur.trim()); cur = ''; }
    else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}

const startsTable = (lines: string[], i: number) => lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('|');

function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i];
  return FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || LIST.test(l) || startsTable(lines, i);
}

function parseBlocks(lines: string[], depth: number): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }
    if (depth >= MAX_DEPTH) { // 너무 깊이 겹친 구조는 문단으로 둔다
      out.push({ t: 'p', c: parseInline(lines.slice(i).join('\n').trim()) });
      break;
    }
    const f = FENCE.exec(line);
    if (f) {
      const fence = f[1];
      const body: string[] = [];
      i++;
      const closes = (l: string) => { const m = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(l); return !!m && m[1][0] === fence[0] && m[1].length >= fence.length; };
      while (i < lines.length && !closes(lines[i])) body.push(lines[i++]);
      i++; // 닫는 줄(없으면 끝까지가 코드)
      out.push({ t: 'code', lang: f[2], text: body.join('\n') });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) { out.push({ t: 'h', level: h[1].length, c: parseInline(h[2]) }); i++; continue; }
    if (HR.test(line)) { out.push({ t: 'hr' }); i++; continue; }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(lines[i++].replace(QUOTE, ''));
      out.push({ t: 'quote', blocks: parseBlocks(inner, depth + 1) });
      continue;
    }
    if (startsTable(lines, i)) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c): Align => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && !blank(lines[i]) && lines[i].includes('|')) {
        const cells = splitRow(lines[i++]);
        rows.push(head.map((_, k) => parseInline(cells[k] ?? '')));
      }
      out.push({ t: 'table', head: head.map((c) => parseInline(c)), align: head.map((_, k) => align[k] ?? null), rows });
      continue;
    }
    const li = LIST.exec(line);
    if (li) {
      const base = li[1].length;
      const ordered = /\d/.test(li[2][0]);
      const items: ListItem[] = [];
      const start = ordered ? parseInt(li[2], 10) : 1;
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (!m || m[1].length !== base || /\d/.test(m[2][0]) !== ordered) break;
        const width = m[2].length + 1;
        const body: string[] = [m[3]];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (blank(l)) {
            // 빈 줄 뒤에도 안쪽으로 들여 쓴 줄이 이어지면 같은 항목
            let j = i;
            while (j < lines.length && blank(lines[j])) j++;
            if (j < lines.length && indentOf(lines[j]) > base) { while (i < j) body.push(lines[i++]); continue; }
            break;
          }
          if (indentOf(l) > base) { body.push(l.slice(Math.min(indentOf(l), base + width))); i++; continue; }
          if (!startsBlock(lines, i) && body.length && !blank(body[body.length - 1])) { body.push(l); i++; continue; } // 들여쓰지 않은 이어지는 글
          break;
        }
        let checked: boolean | null = null;
        const task = /^\[([ xX])\]\s+/.exec(body[0]);
        if (task) { checked = task[1] !== ' '; body[0] = body[0].slice(task[0].length); }
        items.push({ blocks: parseBlocks(body, depth + 1), checked });
        while (i < lines.length && blank(lines[i]) && i + 1 < lines.length && LIST.test(lines[i + 1]) && indentOf(lines[i + 1]) === base) i++; // 항목 사이 빈 줄
      }
      out.push({ t: 'list', ordered, start, items });
      continue;
    }
    // 문단: 다음 블록이 시작하기 전까지
    const para: string[] = [line];
    i++;
    while (i < lines.length && !blank(lines[i]) && !startsBlock(lines, i)) para.push(lines[i++]);
    out.push({ t: 'p', c: parseInline(para.map((l) => l.trim()).join('\n')) });
  }
  return out;
}

/** 마크다운 → AST. 탭은 공백 2칸으로 본다(에디터 들여쓰기와 같다) */
export function parseMarkdown(src: string): Block[] {
  return parseBlocks(src.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n'), 0);
}
