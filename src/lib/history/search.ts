// 이력 검색(순수 로직): 지금 열린 글의 버전들에서 문구를 찾는다. "지웠던 문장이 어느 버전에 있었나" 가 용도다.
// 대소문자 무시 부분 문자열(한글은 NFC 로 맞춰 비교). 정규식은 없다.

export interface VersionRef { id: string; ts: number; name?: string }
export interface SearchOptions { caseSensitive?: boolean }
export interface Excerpt {
  /** 1부터 세는 줄 번호(원문 기준) */
  line: number;
  /** 일치 줄을 앞뒤로 자른 글. 잘린 쪽에는 '…' 가 붙는다 */
  text: string;
  /** text 안에서 일치한 구간 [시작, 끝) */
  ranges: [number, number][];
}
export interface VersionHit { versionId: string; count: number; excerpts: Excerpt[] }
export interface SearchResult {
  /** 일치한 버전만, 입력 순서(최근순)대로 */
  hits: VersionHit[];
  /** 현재 본문에 검색어가 있는가. current 를 안 줬으면 undefined */
  inCurrent: boolean | undefined;
  /** 압축을 풀지 못해 건너뛴 버전 수 */
  skipped: number;
}
export interface Progress { done: number; total: number; hits: VersionHit[] }

export const MAX_EXCERPTS = 3;
const CONTEXT_BEFORE = 30; // 첫 일치 앞에 남기는 글자 수
const WINDOW = 100; // 발췌 한 줄의 최대 길이(일치가 더 길면 일치까지)

const nfc = (s: string) => s.normalize('NFC');

/** 대소문자 접기. 소문자로 바꾸면 길이가 달라지는 글자(İ 등)가 있으면 그 글자만 그대로 둬서 위치가 어긋나지 않게 한다 */
function fold(s: string): string {
  const l = s.toLowerCase();
  if (l.length === s.length) return l;
  let out = '';
  for (const ch of s) { const c = ch.toLowerCase(); out += c.length === ch.length ? c : ch; }
  return out;
}

const prep = (text: string, cs: boolean) => (cs ? nfc(text) : fold(nfc(text)));

/** haystack(이미 접힘)에서 needle 의 겹치지 않는 모든 시작 위치 */
function indexesOf(hay: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

function excerptOf(line: string, no: number, starts: number[], len: number): Excerpt {
  let from = Math.max(0, starts[0] - CONTEXT_BEFORE);
  let to = Math.min(line.length, Math.max(from + WINDOW, starts[0] + len));
  if (to - from < WINDOW) from = Math.max(0, to - WINDOW); // 줄 끝 쪽이면 앞을 더 보여준다
  const lead = from > 0 ? '…' : '';
  const ranges: [number, number][] = [];
  for (const s of starts) {
    if (s < from || s >= to) continue;
    ranges.push([s - from + lead.length, Math.min(s + len, to) - from + lead.length]);
  }
  return { line: no, text: lead + line.slice(from, to) + (to < line.length ? '…' : ''), ranges };
}

/** 본문 하나에서 일치 건수와 발췌를 구한다. 일치가 없으면 undefined */
export function searchBody(body: string, query: string, opts: SearchOptions = {}): { count: number; excerpts: Excerpt[] } | undefined {
  const cs = !!opts.caseSensitive;
  const q = prep(query, cs);
  if (!q) return undefined;
  const lines = nfc(body).split(/\r\n|\r|\n/);
  let count = 0;
  const excerpts: Excerpt[] = [];
  for (let i = 0; i < lines.length; i++) {
    const hay = cs ? lines[i] : fold(lines[i]);
    if (hay.length < q.length) continue;
    const starts = indexesOf(hay, q);
    if (!starts.length) continue;
    count += starts.length;
    if (excerpts.length < MAX_EXCERPTS) excerpts.push(excerptOf(lines[i], i + 1, starts, q.length));
  }
  return count ? { count, excerpts } : undefined;
}

/** 본문에 검색어가 있는가 */
export function containsQuery(body: string, query: string, opts: SearchOptions = {}): boolean {
  const cs = !!opts.caseSensitive;
  const q = prep(query, cs);
  return !!q && prep(body, cs).includes(q);
}

/** 화면 강조용: text 를 일치/불일치 조각으로 나눈다. 줄 경계를 넘는 일치는 없다. 조각을 이으면 text 와 같다(NFC 정규화 전 글 기준). */
export function splitMarks(text: string, query: string, opts: SearchOptions = {}): { t: string; hit: boolean }[] {
  const cs = !!opts.caseSensitive;
  const q = prep(query, cs);
  // NFC 로 길이가 달라지면 위치를 못 맞추므로 그때는 강조를 포기한다
  if (!q || nfc(text).length !== text.length) return [{ t: text, hit: false }];
  const hay = cs ? text : fold(text);
  const out: { t: string; hit: boolean }[] = [];
  let pos = 0;
  for (const s of indexesOf(hay, q)) {
    if (s > pos) out.push({ t: text.slice(pos, s), hit: false });
    out.push({ t: text.slice(s, s + q.length), hit: true });
    pos = s + q.length;
  }
  if (pos < text.length || !out.length) out.push({ t: text.slice(pos), hit: false });
  return out;
}

/**
 * 버전 id 별 본문 캐시. 압축 해제 같은 비싼 읽기를 버전마다 한 번만 하고(실패도 기억해 다시 풀지 않는다),
 * 비교용으로 NFC 를 마친 본문을 돌려준다. 글을 바꾸거나 패널을 닫으면 clear() 한다.
 */
export function createBodyCache<V extends VersionRef>(read: (v: V) => string) {
  const map = new Map<string, string | null>();
  return {
    /** 본문(NFC). 읽기에 실패한 버전은 null */
    get(v: V): string | null {
      if (map.has(v.id)) return map.get(v.id)!;
      let body: string | null;
      try { body = nfc(read(v)); } catch { body = null; }
      map.set(v.id, body);
      return body;
    },
    clear() { map.clear(); },
    get size() { return map.size; },
  };
}
export type BodyCache<V extends VersionRef> = ReturnType<typeof createBodyCache<V>>;

export interface RunOptions extends SearchOptions {
  /** 지금 본문. 있으면 inCurrent 를 채운다 */
  current?: string;
  /** 취소 신호. 취소되면 null 을 돌려주고 결과를 내지 않는다 */
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
  /** 한 번에 처리하는 시간 예산(ms). 넘기면 양보한다. 기본 16 */
  budgetMs?: number;
  /** 양보 방법(테스트용). 기본은 setTimeout 0 */
  yieldFn?: () => Promise<void>;
  now?: () => number;
}

const macroYield = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * 버전을 최근순 그대로 하나씩 훑어 일치하는 버전만 모은다. 시간 예산마다 await 로 양보해 화면이 멈추지 않게 한다.
 * 취소(signal)되면 null.
 */
export async function searchVersions<V extends VersionRef>(
  versions: readonly V[],
  cache: BodyCache<V>,
  query: string,
  opts: RunOptions = {},
): Promise<SearchResult | null> {
  const { signal, onProgress, budgetMs = 16, yieldFn = macroYield, now = () => performance.now() } = opts;
  const hits: VersionHit[] = [];
  let skipped = 0;
  if (!prep(query, !!opts.caseSensitive)) return signal?.aborted ? null : { hits, inCurrent: undefined, skipped };
  let slice = now();
  for (let i = 0; i < versions.length; i++) {
    if (signal?.aborted) return null;
    const v = versions[i];
    const body = cache.get(v);
    if (body === null) skipped++;
    else {
      const r = searchBody(body, query, opts);
      if (r) hits.push({ versionId: v.id, ...r });
    }
    if (now() - slice >= budgetMs && i < versions.length - 1) {
      onProgress?.({ done: i + 1, total: versions.length, hits: [...hits] });
      await yieldFn();
      if (signal?.aborted) return null;
      slice = now();
    }
  }
  if (signal?.aborted) return null;
  onProgress?.({ done: versions.length, total: versions.length, hits: [...hits] });
  const inCurrent = opts.current === undefined ? undefined : containsQuery(opts.current, query, opts);
  return { hits, inCurrent, skipped };
}
