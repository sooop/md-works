// 문단(빈 줄로 구분되는 블록) 단위 diff. 기준은 "버전 → 현재" 이다.
//  - added: 현재에만 있는 블록(되돌리면 사라짐), removed: 버전에만 있는 블록(되돌리면 되살아남), changed: 양쪽이 다른 블록
// 변경된 블록 쌍은 단어(공백/문장부호 경계) 단위로 인라인 강조용 조각을 만든다.

export interface Block { text: string; sep: string }

const SEP = /(\n(?:[ \t]*\n)+)/;

/** 본문을 블록으로 자른다. sep 는 블록 뒤의 빈 줄(들)이라 다시 이으면 원문과 같다. */
export function splitBlocks(text: string): Block[] {
  const parts = text.split(SEP);
  const out: Block[] = [];
  for (let i = 0; i < parts.length; i += 2) out.push({ text: parts[i], sep: parts[i + 1] ?? '' });
  return out;
}
export const blocksOf = (text: string): string[] => splitBlocks(text).map((b) => b.text);

export interface Seg { type: 'eq' | 'del' | 'add'; text: string }
export interface Pair { ver: string; cur: string; segs: Seg[] }
export interface Hunk {
  id: string;
  kind: 'added' | 'removed' | 'changed';
  /** current/version 블록 배열에서의 구간 [start, end) */
  curStart: number; curEnd: number; verStart: number; verEnd: number;
  cur: string[]; ver: string[];
  /** changed 일 때 앞쪽 min(cur,ver) 쌍의 단어 단위 diff */
  pairs: Pair[];
}

const LIMIT = 6_000_000; // LCS 표 크기 한도(칸 수)

type Op = { t: 'eq' | 'del' | 'add'; a: number; b: number };

/** 두 배열의 LCS 기반 편집 스크립트. a 에만 있으면 del, b 에만 있으면 add. */
function lcsOps<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): Op[] {
  let s = 0;
  while (s < a.length && s < b.length && eq(a[s], b[s])) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && eq(a[ea - 1], b[eb - 1])) { ea--; eb--; }
  const ops: Op[] = [];
  for (let i = 0; i < s; i++) ops.push({ t: 'eq', a: i, b: i });
  const n = ea - s, m = eb - s;
  if (n * m > LIMIT) {
    // 너무 크면 가운데 전체를 통째로 바뀐 것으로 본다
    for (let i = s; i < ea; i++) ops.push({ t: 'del', a: i, b: s });
    for (let j = s; j < eb; j++) ops.push({ t: 'add', a: ea, b: j });
  } else if (n || m) {
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = eq(a[s + i], b[s + j]) ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && eq(a[s + i], b[s + j])) { ops.push({ t: 'eq', a: s + i, b: s + j }); i++; j++; }
      else if (i < n && (j >= m || dp[(i + 1) * w + j] >= dp[i * w + j + 1])) { ops.push({ t: 'del', a: s + i, b: s + j }); i++; }
      else { ops.push({ t: 'add', a: s + i, b: s + j }); j++; }
    }
  }
  for (let k = 0; k < a.length - ea; k++) ops.push({ t: 'eq', a: ea + k, b: eb + k });
  return ops;
}

const TOKEN = /\s+|[\p{P}\p{S}]|[^\s\p{P}\p{S}]+/gu;

/** 단어(공백/문장부호 경계) 단위 인라인 diff. 기준 a → b */
export function inlineDiff(a: string, b: string): Seg[] {
  const ta = a.match(TOKEN) ?? [], tb = b.match(TOKEN) ?? [];
  const segs: Seg[] = [];
  const push = (type: Seg['type'], text: string) => {
    const last = segs[segs.length - 1];
    if (last && last.type === type) last.text += text; else segs.push({ type, text });
  };
  for (const op of lcsOps(ta, tb, (x, y) => x === y)) {
    if (op.t === 'eq') push('eq', ta[op.a]);
    else if (op.t === 'del') push('del', ta[op.a]);
    else push('add', tb[op.b]);
  }
  return segs;
}

const norm = (s: string) => s.trim();

/** 버전 블록 → 현재 블록의 hunk 목록. id 는 순서(h0, h1…)로 정해져 같은 입력이면 항상 같다. */
export function diffBlocks(versionBlocks: string[], currentBlocks: string[]): Hunk[] {
  const ops = lcsOps(versionBlocks, currentBlocks, (x, y) => norm(x) === norm(y));
  const hunks: Hunk[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === 'eq') { k++; continue; }
    const vs = ops[k].a, cs = ops[k].b;
    let ve = vs, ce = cs;
    while (k < ops.length && ops[k].t !== 'eq') {
      if (ops[k].t === 'del') ve = ops[k].a + 1; else ce = ops[k].b + 1;
      k++;
    }
    const ver = versionBlocks.slice(vs, ve), cur = currentBlocks.slice(cs, ce);
    const pairs: Pair[] = [];
    if (ver.length && cur.length) {
      for (let i = 0; i < Math.min(ver.length, cur.length); i++) pairs.push({ ver: ver[i], cur: cur[i], segs: inlineDiff(ver[i], cur[i]) });
    }
    hunks.push({
      id: `h${hunks.length}`, kind: !ver.length ? 'added' : !cur.length ? 'removed' : 'changed',
      curStart: cs, curEnd: ce, verStart: vs, verEnd: ve, cur, ver, pairs,
    });
  }
  return hunks;
}

export const diffText = (version: string, current: string): Hunk[] => diffBlocks(blocksOf(version), blocksOf(current));

/** 선택한 hunk 만 버전 쪽으로 되돌린 새 본문. 선택이 없으면 current 와 정확히 같다. */
export function applyHunks(current: string, versionBlocks: string[], selectedIds: Iterable<string>): string {
  const sel = new Set(selectedIds);
  const cur = splitBlocks(current);
  const hunks = diffBlocks(versionBlocks, cur.map((b) => b.text)).filter((h) => sel.has(h.id));
  if (!hunks.length) return current;
  const items: Block[] = [];
  let pos = 0;
  for (const h of hunks) {
    items.push(...cur.slice(pos, h.curStart));
    // 되돌린 블록은 바뀐 위치의 기존 구분자를 이어받고, 없으면 빈 줄 하나
    h.ver.forEach((t, i) => items.push({ text: t, sep: cur[h.curStart + i]?.sep || '\n\n' }));
    pos = h.curEnd;
  }
  items.push(...cur.slice(pos));
  let out = '';
  items.forEach((b, i) => {
    out += b.text;
    if (i < items.length - 1) out += b.sep || '\n\n';
  });
  return out;
}
