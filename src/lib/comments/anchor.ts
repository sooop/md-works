// 코멘트 위치: 원문(.md)을 건드리지 않으므로 코멘트는 '선택한 원문 + 앞뒤 문맥' 으로 위치를 기억하고,
// 문서를 열 때 에디터 문서의 평문에서 다시 찾는다. 평문은 텍스트블록을 '\n' 으로 이어 붙인 문자열이다.
import type { Node as PMNode } from '@milkdown/kit/prose/model';

export interface Comment {
  id: string;
  quote: string; // 선택한 원문
  prefix: string; // 앞 문맥
  suffix: string; // 뒤 문맥
  text: string; // 코멘트 본문
  created: number;
  updated: number;
  resolved: boolean;
}
export type Anchor = Pick<Comment, 'quote' | 'prefix' | 'suffix'>;

export const MAX_QUOTE = 3000;
const CONTEXT = 32;
const LEAF = '￼'; // 줄바꿈 같은 인라인 leaf 는 한 글자 대체 문자로 두어 오프셋이 문서 위치와 1:1 이 되게 한다

export interface Flat {
  text: string;
  /** map[i] = 평문 i번째 글자의 문서 위치 (단조 증가) */
  map: number[];
}

export function flatten(doc: PMNode): Flat {
  let text = '';
  const map: number[] = [];
  let first = true;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (!first) { text += '\n'; map.push(pos); }
    first = false;
    const t = node.textBetween(0, node.content.size, undefined, LEAF);
    for (let i = 0; i < t.length; i++) map.push(pos + 1 + i);
    text += t;
    return false;
  });
  return { text, map };
}

// 첫 i 중 map[i] >= pos
function lowerBound(map: number[], pos: number): number {
  let lo = 0;
  let hi = map.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (map[mid] < pos) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** 문서 위치 범위 → 앵커. 선택이 비어 있거나 글자가 없으면 null */
export function anchorOf(flat: Flat, from: number, to: number): Anchor | null {
  let s = lowerBound(flat.map, from);
  let e = lowerBound(flat.map, to); // map[e] >= to → [s, e) 가 범위
  while (s < e && flat.text[s] === '\n') s++;
  while (e > s && flat.text[e - 1] === '\n') e--;
  if (e <= s) return null;
  return {
    quote: flat.text.slice(s, e),
    prefix: flat.text.slice(Math.max(0, s - CONTEXT), s),
    suffix: flat.text.slice(e, e + CONTEXT),
  };
}

const commonSuffix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};
const commonPrefix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/** 앵커를 평문에서 다시 찾아 문서 위치 범위로 돌려준다. 여러 곳이면 앞뒤 문맥이 가장 비슷한(동률이면 hint 에 가까운) 곳. 없으면 null */
export function locate(flat: Flat, a: Anchor, hint = -1): { from: number; to: number } | null {
  if (!a.quote) return null;
  let best = -1;
  let bestScore = -1;
  let bestDist = Infinity;
  for (let at = flat.text.indexOf(a.quote), n = 0; at >= 0 && n < 500; at = flat.text.indexOf(a.quote, at + 1), n++) {
    const score =
      commonSuffix(flat.text.slice(Math.max(0, at - CONTEXT), at), a.prefix) +
      commonPrefix(flat.text.slice(at + a.quote.length, at + a.quote.length + CONTEXT), a.suffix);
    const dist = hint < 0 ? 0 : Math.abs(flat.map[at] - hint);
    if (score > bestScore || (score === bestScore && dist < bestDist)) { best = at; bestScore = score; bestDist = dist; }
  }
  if (best < 0) return null;
  return { from: flat.map[best], to: flat.map[best + a.quote.length - 1] + 1 };
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Date.now());

/** 저장소에서 읽은 임의의 값을 코멘트 목록으로 정리한다 (잘못된 항목은 버린다) */
export function sanitize(raw: unknown): Comment[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { comments?: unknown })?.comments) ? (raw as { comments: unknown[] }).comments : [];
  const seen = new Set<string>();
  const out: Comment[] = [];
  for (const r of list as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const quote = str(r.quote, MAX_QUOTE);
    const id = str(r.id, 64) || crypto.randomUUID();
    if (!quote || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id, quote, prefix: str(r.prefix, 200), suffix: str(r.suffix, 200), text: str(r.text, 20000),
      created: num(r.created), updated: num(r.updated), resolved: r.resolved === true,
    });
  }
  return out;
}
