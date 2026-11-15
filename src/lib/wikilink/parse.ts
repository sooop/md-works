// 글 사이 링크 `[[글 이름]]` / `[[글 이름|표시 글자]]` / `[[폴더/글 이름]]` 의 문법과 해석. 순수 함수만 둔다(화면·저장소와 무관).
// .md 에는 이 문법이 글자 그대로 저장된다(Obsidian 방식). 대소문자는 구분하지 않고(한글은 NFC) 저장된 글자는 건드리지 않는다.

export interface WikiLink { target: string; label: string; from: number; to: number }
export type Resolved = { kind: 'ok'; path: string } | { kind: 'ambiguous'; paths: string[] } | { kind: 'missing' };

/** 해석에 쓰는 글 목록. path 는 `폴더/이름` 또는 `폴더/이름.md`(확장자는 무시한다) */
export interface DocRef { path: string }

/** 줄머리·끝의 `.md` 와 앞의 `/` 를 뗀 `폴더/이름` */
export const docPath = (p: string): string => p.replace(/^\/+/, '').replace(/\.md$/i, '');
/** 경로의 이름 부분 */
export const docName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
/** 비교용: NFC + 소문자 + 앞뒤 공백 제거 */
export const norm = (s: string): string => s.normalize('NFC').toLowerCase().trim();

// ---- 코드 가리기 ----
// 펜스 코드 블록과 인라인 코드 안의 글자를 같은 길이의 \u0001 로 바꿔(줄바꿈은 그대로) 링크로 읽히지 않게 한다.
export const MASK = '\u0001';
const maskRange = (chars: string[], a: number, b: number) => { for (let i = a; i < b; i++) if (chars[i] !== '\n') chars[i] = MASK; };

/** 같은 길이로 코드 부분을 가린 문자열 */
export function maskCode(md: string): string {
  const out = md.split(''); // UTF-16 코드 유닛 단위(위치가 md 와 같아야 한다)
  const n = md.length;
  let fence: { ch: string; len: number } | null = null;
  for (let i = 0; i < n;) {
    const eol = md.indexOf('\n', i);
    const end = eol < 0 ? n : eol;
    const line = md.slice(i, end);
    if (fence) {
      // 닫는 펜스: 같은 글자 N개 이상(앞 공백 3칸까지)만 있는 줄
      const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      maskRange(out, i, end);
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len) fence = null;
    } else {
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
        fence = { ch: open[1][0], len: open[1].length };
        maskRange(out, i, end);
      }
    }
    i = end + 1;
  }
  // 인라인 코드: 같은 길이의 백틱 묶음이 짝을 이루는 구간(문단 안에서만). 펜스 안은 이미 가려졌다.
  const s = out.join('');
  const blank = /\n[ \t]*\n/g;
  for (let p = 0; p < n;) {
    if (s[p] !== '`') { p++; continue; }
    let q = p;
    while (q < n && s[q] === '`') q++;
    const len = q - p;
    blank.lastIndex = q;
    const limit = blank.exec(s)?.index ?? n; // 빈 줄을 넘어 짝을 찾지 않는다
    let close = -1;
    for (let r = q; r < limit;) {
      if (s[r] !== '`') { r++; continue; }
      let t = r;
      while (t < n && s[t] === '`') t++;
      if (t - r === len) { close = r; break; }
      r = t;
    }
    if (close < 0) { p = q; continue; }
    maskRange(out, p, close + len);
    p = close + len;
  }
  return out.join('');
}

// ---- 추출 ----
// 줄바꿈·대괄호·가려진 글자·객체 대체 문자(\uFFFC)가 없는 `[[…]]`. `![[…]]`(삽입) 은 링크가 아니다.
const LINK = /(?<!!)\[\[([^[\]\n\u0001\uFFFC]+)\]\]/g;

/** 문단 하나(코드는 이미 가려진 문자열)의 링크. 표 안에서는 `\|` 가 구분자일 수 있어 둘 다 받는다 */
export interface RawLink extends WikiLink {
  /** 대상 글자(trim 한 것)의 위치 [시작, 끝) — 이름 변경 때 이 부분만 바꾼다 */
  tFrom: number;
  tTo: number;
  alias: boolean;
}
export function scanLinks(text: string, offset = 0): RawLink[] {
  const out: RawLink[] = [];
  for (const m of text.matchAll(LINK)) {
    const inner = m[1];
    const sep = /\\?\|/.exec(inner);
    const head = sep ? inner.slice(0, sep.index) : inner;
    const target = head.trim();
    if (!target) continue;
    const from = m.index!;
    const innerFrom = from + 2;
    const lead = head.length - head.trimStart().length;
    const alias = sep ? inner.slice(sep.index + sep[0].length).trim() : '';
    out.push({
      target,
      label: sep && alias ? alias : target,
      from: from + offset,
      to: from + m[0].length + offset,
      tFrom: innerFrom + lead + offset,
      tTo: innerFrom + lead + target.length + offset,
      alias: !!(sep && alias),
    });
  }
  return out;
}

export function extractWikiLinks(md: string): { target: string; label: string; from: number; to: number }[] {
  if (!md.includes('[[')) return [];
  return scanLinks(maskCode(md)).map(({ target, label, from, to }) => ({ target, label, from, to }));
}

// ---- 해석 ----
export interface Resolver { resolve(target: string): Resolved }

/** 같은 글 목록으로 여러 링크를 해석할 때 쓴다(경로·이름 색인을 한 번만 만든다) */
export function createResolver(docs: DocRef[]): Resolver {
  const byPath = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  for (const d of docs) {
    const p = docPath(d.path);
    const push = (m: Map<string, string[]>, k: string) => { const l = m.get(k); if (l) l.push(p); else m.set(k, [p]); };
    push(byPath, norm(p));
    push(byName, norm(docName(p)));
  }
  return {
    resolve(target) {
      const t = norm(docPath(target.trim()));
      if (!t) return { kind: 'missing' };
      const exact = byPath.get(t);
      if (exact?.length === 1) return { kind: 'ok', path: exact[0] };
      if (exact && exact.length > 1) return { kind: 'ambiguous', paths: [...exact].sort() };
      const named = byName.get(t);
      if (named?.length === 1) return { kind: 'ok', path: named[0] };
      if (named && named.length > 1) return { kind: 'ambiguous', paths: [...named].sort() };
      return { kind: 'missing' };
    },
  };
}

export function resolveWikiLink(target: string, docs: DocRef[]): Resolved {
  return createResolver(docs).resolve(target);
}

// ---- 이름 변경 ----
const samePath = (a: string, b: string) => norm(docPath(a)) === norm(docPath(b));

/**
 * oldPath 글이 newPath 로 바뀐 뒤, 그 글을 가리키던 링크만 새 이름으로 고친다.
 * docs 는 바뀐 뒤(또는 바뀌기 전)의 글 목록 — 어느 쪽이든 oldPath·newPath 를 안에서 맞춰 쓴다.
 * 이름만 쓴 링크는 새 이름이 유일하면 이름만, 아니면 경로로 쓴다. `|표시 글자` 와 대상 주위의 공백은 보존한다.
 */
export function renameWikiLinks(md: string, oldPath: string, newPath: string, docs: DocRef[]): { text: string; count: number } {
  if (!md.includes('[[')) return { text: md, count: 0 };
  const oldP = docPath(oldPath), newP = docPath(newPath);
  const paths = docs.map((d) => docPath(d.path));
  const before = [...paths.filter((p) => !samePath(p, newP) && !samePath(p, oldP)), oldP].map((path) => ({ path }));
  const after = [...paths.filter((p) => !samePath(p, newP) && !samePath(p, oldP)), newP].map((path) => ({ path }));
  const was = createResolver(before), now = createResolver(after);
  const links = scanLinks(maskCode(md));
  let text = md;
  let count = 0;
  for (const l of [...links].reverse()) {
    const r = was.resolve(l.target);
    if (r.kind !== 'ok' || !samePath(r.path, oldP)) continue;
    let next = newP;
    if (!l.target.includes('/')) {
      const base = docName(newP);
      const u = now.resolve(base);
      if (u.kind === 'ok' && samePath(u.path, newP)) next = base;
    }
    if (next === l.target) continue;
    text = text.slice(0, l.tFrom) + next + text.slice(l.tTo);
    count++;
  }
  return { text, count };
}

// ---- 내보내기 ----
/** `[[대상|표시]]` → `표시`, `[[대상]]` → 대상의 이름 부분. 코드 안은 그대로 둔다 */
export function flattenWikiLinks(md: string): string {
  if (!md.includes('[[')) return md;
  const links = scanLinks(maskCode(md));
  let text = md;
  for (const l of [...links].reverse()) {
    const shown = l.alias ? l.label : docName(docPath(l.target));
    text = text.slice(0, l.from) + shown + text.slice(l.to);
  }
  return text;
}
