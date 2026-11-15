// 번들에서 읽은 JSON 레코드를 믿지 않고 모양을 다시 만든다. 형식이 틀린 레코드는 null(건너뜀).
// 서버 사이드카의 id 규칙(server/worksStore.js)과 같다 — 번들을 풀어 노트 폴더에 쓸 수 있어야 하므로.
import { SNIPPET_COLORS, type Snippet, type Thread, type Version } from '../works/types';

export const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_TEXT = 20 * 1024 * 1024; // 레코드 하나의 문자열 상한 (본문·이력 압축본)

/** 시계가 앞선 기기의 번들이 이후 병합을 계속 이기지 않도록, 이 값보다 미래인 시각은 지금으로 자른다 */
export const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
export const clampTime = (t: number, now: number): number => (t > now + MAX_FUTURE_MS ? now : t);

const str = (v: unknown, max = MAX_TEXT): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 1000).slice(0, 10_000) : [];

function head(r: Record<string, unknown>, now: number) {
  const id = str(r.id, 80);
  const u = num(r.updatedAt);
  if (!id || !ID_RE.test(id) || u === undefined) return null;
  const d = num(r.deletedAt);
  return { id, updatedAt: clampTime(u, now), ...(d !== undefined ? { deletedAt: clampTime(d, now) } : {}) };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function cleanVersion(v: unknown, docKey: string, now = Date.now()): Version | null {
  if (!isObj(v)) return null;
  const h = head(v, now);
  const content = str(v.content);
  const ts = num(v.ts);
  if (!h || content === undefined || ts === undefined) return null;
  if (v.enc !== 'raw' && v.enc !== 'deflate-b64') return null;
  const name = str(v.name, 500);
  return { ...h, docKey, ts, content, enc: v.enc, ...(name ? { name } : {}) };
}

/** 글별 정렬 값: 키는 1000자 이하 문자열, 값은 유한 숫자만(그 밖은 버림). 최대 10,000개. 비면 undefined */
export function cleanOrders(v: unknown): Record<string, number> | undefined {
  if (!isObj(v)) return undefined;
  const entries = Object.entries(v)
    .filter((e): e is [string, number] => e[0].length > 0 && e[0].length <= 1000 && typeof e[1] === 'number' && Number.isFinite(e[1]))
    .slice(0, 10_000);
  return entries.length ? Object.fromEntries(entries) : undefined; // fromEntries 는 '__proto__' 키도 평범한 속성으로 만든다
}

export function cleanSnippet(v: unknown, now = Date.now()): Snippet | null {
  if (!isObj(v)) return null;
  const h = head(v, now);
  const body = str(v.body);
  if (!h || body === undefined) return null;
  const color = SNIPPET_COLORS.find((c) => c === v.color) ?? 'yellow';
  const s: Snippet = { ...h, body, color, createdAt: num(v.createdAt) ?? h.updatedAt, attachedDocs: strList(v.attachedDocs) };
  if (isObj(v.source) && typeof v.source.url === 'string') {
    s.source = { url: v.source.url.slice(0, 4000) };
    const title = str(v.source.title, 2000);
    const excerpt = str(v.source.excerpt, 20000);
    if (title !== undefined) s.source.title = title;
    if (excerpt !== undefined) s.source.excerpt = excerpt;
  }
  if (Array.isArray(v.trashedFrom)) s.trashedFrom = strList(v.trashedFrom);
  const orders = cleanOrders(v.orders);
  if (orders) s.orders = orders;
  if (v.purged === true) s.purged = true;
  return s;
}

export function cleanThread(v: unknown, docKey: string, now = Date.now()): Thread | null {
  if (!isObj(v) || !isObj(v.anchor)) return null;
  const h = head(v, now);
  const quote = str(v.anchor.quote, 5000);
  if (!h || quote === undefined || !Array.isArray(v.messages)) return null;
  const messages = v.messages.flatMap((m) => {
    if (!isObj(m)) return [];
    const id = str(m.id, 80);
    const text = str(m.text);
    const ts = num(m.ts);
    return id && text !== undefined && ts !== undefined ? [{ id, text, ts }] : [];
  });
  return {
    ...h, docKey, messages, resolved: v.resolved === true, createdAt: num(v.createdAt) ?? h.updatedAt,
    anchor: { quote, prefix: str(v.anchor.prefix, 1000) ?? '', suffix: str(v.anchor.suffix, 1000) ?? '' },
  };
}
