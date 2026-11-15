// 링크 패널의 계산(순수): 이 글을 가리키는 글(역링크)과 이 글에서 가리키는 글(나가는 링크).
import type { LineHit } from './host';
import { createResolver, extractWikiLinks, norm, docPath, type DocRef, type Resolved } from './parse';

export interface Snippet { before: string; hit: string; after: string }
export interface BacklinkItem { line: number; snip: Snippet }
export interface BacklinkGroup { key: string; path: string; items: BacklinkItem[] }
export interface OutgoingItem { target: string; label: string; res: Resolved; count: number }

const CONTEXT = 48;

/** 링크가 있는 줄을 링크 앞뒤로 잘라 한 줄 문맥으로 만든다 */
export function snippetAround(line: string, from: number, to: number, span = CONTEXT): Snippet {
  const a = Math.max(0, from - span), b = Math.min(line.length, to + span);
  const before = line.slice(a, from).replace(/^\s+/, '');
  const after = line.slice(to, b).replace(/\s+$/, '');
  return { before: (a > 0 ? '…' : '') + before, hit: line.slice(from, to), after: after + (b < line.length ? '…' : '') };
}

/** 글별 링크 추출 결과를 내용 기준으로 캐시한다(글이 바뀔 때마다 전부 다시 훑지 않는다) */
export class LinkCache {
  private m = new Map<string, { content: string; links: ReturnType<typeof extractWikiLinks> }>();
  links(key: string, content: string) {
    const hit = this.m.get(key);
    if (hit && hit.content === content) return hit.links;
    const links = extractWikiLinks(content);
    this.m.set(key, { content, links });
    return links;
  }
  /** 없어진 글의 항목을 버린다 */
  keep(keys: Iterable<string>) {
    const ok = new Set(keys);
    for (const k of this.m.keys()) if (!ok.has(k)) this.m.delete(k);
  }
}

const byPath = (a: BacklinkGroup, b: BacklinkGroup) => a.path.localeCompare(b.path, 'ko');
const samePath = (a: string, b: string) => norm(docPath(a)) === norm(docPath(b));

/** 메모리의 모든 글을 훑어(캐시 사용) current 를 가리키는 링크가 있는 글과 줄 */
export function backlinksFromSources(
  current: string,
  sources: { key: string; path: string; content: string }[],
  docs: DocRef[],
  cache: LinkCache,
): BacklinkGroup[] {
  const resolver = createResolver(docs);
  const out: BacklinkGroup[] = [];
  cache.keep(sources.map((s) => s.key));
  for (const s of sources) {
    if (samePath(s.path, current) || !s.content.includes('[[')) continue;
    const items: BacklinkItem[] = [];
    for (const l of cache.links(s.key, s.content)) {
      const r = resolver.resolve(l.target);
      if (r.kind !== 'ok' || !samePath(r.path, current)) continue;
      const start = s.content.lastIndexOf('\n', l.from - 1) + 1;
      const eol = s.content.indexOf('\n', l.to);
      const line = s.content.slice(start, eol < 0 ? undefined : eol);
      items.push({ line: s.content.slice(0, l.from).split('\n').length, snip: snippetAround(line, l.from - start, l.to - start) });
    }
    if (items.length) out.push({ key: s.key, path: s.path, items });
  }
  return out.sort(byPath);
}

/** 서버 모드: 검색으로 얻은 `[[` 줄들을 클라이언트에서 해석한다(줄만 보므로 펜스 코드 블록 안인지는 알 수 없다) */
export function backlinksFromLines(current: string, docs: DocRef[], hits: LineHit[]): BacklinkGroup[] {
  const resolver = createResolver(docs);
  const groups = new Map<string, BacklinkGroup>();
  for (const h of hits) {
    if (samePath(h.path, current)) continue;
    for (const l of extractWikiLinks(h.text)) {
      const r = resolver.resolve(l.target);
      if (r.kind !== 'ok' || !samePath(r.path, current)) continue;
      let g = groups.get(h.key);
      if (!g) groups.set(h.key, (g = { key: h.key, path: h.path, items: [] }));
      g.items.push({ line: h.line, snip: snippetAround(h.text, l.from, l.to) });
    }
  }
  return [...groups.values()].sort(byPath);
}

/** 본문에서 가리키는 글(같은 대상은 하나로 묶어 횟수를 센다). 본문 등장 순서 */
export function outgoingLinks(md: string, docs: DocRef[]): OutgoingItem[] {
  const resolver = createResolver(docs);
  const out = new Map<string, OutgoingItem>();
  for (const l of extractWikiLinks(md)) {
    const k = norm(docPath(l.target));
    const hit = out.get(k);
    if (hit) hit.count++;
    else out.set(k, { target: l.target, label: l.label, res: resolver.resolve(l.target), count: 1 });
  }
  return [...out.values()];
}
