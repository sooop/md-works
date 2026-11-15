// 서버 모드의 LinkHost. 서버 코드는 고치지 않고 기존 API(/api/file, /api/search)만 쓴다.
// 모드 파일의 내부 함수는 deps 로 받는다(server-mode.svelte.ts 와 서로 import 하지 않으려고).
import type { LineHit, LinkDoc, LinkHost } from './host';
import { docPath } from './parse';

export interface ServerDeps {
  /** 트리의 모든 글 경로(`.md` 포함) — 반응형 상태를 읽어야 한다 */
  paths(): string[];
  /** 열린 글의 경로('' 이면 없음)와 편집 내용 */
  openPath(): string;
  content(): string;
  /** 편집 중인 내용을 저장한다(디바운스에 걸린 마지막 입력까지) */
  save(): Promise<boolean>;
  /** 열린 글의 내용을 바꿔 에디터에 다시 그리고 저장한다(되돌리기 직전 내용은 이력에 남는다) */
  restore(text: string): Promise<void>;
  open(path: string): Promise<void>;
  create(path: string): Promise<void>;
  /** 이름 변경으로 바꾸기 전의 본문을 이력에 남긴다(실패해도 무시) */
  snapshot?(path: string, text: string): Promise<void>;
}

const enc = encodeURIComponent;
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface SearchRes { results: { path: string; matches: { line: number; text: string }[]; more: boolean }[]; count: number; truncated: boolean }

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { message?: string }).message ?? `요청 실패 (${res.status})`), { status: res.status });
  return data as T;
}

export function createServerLinkHost(deps: ServerDeps): LinkHost {
  const mtimes = new Map<string, { mtime?: number; content: string }>();
  const toDoc = (p: string): LinkDoc => ({ key: p, path: docPath(p) });
  return {
    docs: () => deps.paths().map(toDoc),
    current: () => { const p = deps.openPath(); return p ? toDoc(p) : null; },
    open: (key) => deps.open(key),
    create: (path) => deps.create(`${path}.md`),

    async candidates() {
      // `[[` 가 든 파일만 훑는다. 검색 상한(500건)에 걸리면 빠뜨릴 수 있으므로 전부 훑게 한다
      const r = await getJson<SearchRes>(`/api/search?q=${enc('\\[\\[')}&cs=0&re=1`);
      if (r.truncated || r.results.some((f) => f.more)) return undefined;
      const set = new Set(r.results.map((f) => f.path));
      const open = deps.openPath();
      if (open) set.add(open); // 열린 글은 아직 저장하기 전의 `[[` 가 있을 수 있다
      return [...set];
    },

    async read(key) {
      if (key === deps.openPath()) {
        await deps.save();
        return deps.content();
      }
      try {
        const f = await getJson<{ content: string; mtime?: number }>(`/api/file?path=${enc(key)}`);
        mtimes.set(key, { mtime: f.mtime, content: f.content });
        return f.content;
      } catch { return null; }
    },

    async write(key, text) {
      try {
        if (key === deps.openPath()) { await deps.restore(text); return true; }
        const base = mtimes.get(key);
        if (!base) return false; // 읽지 않은 글은 덮어쓰지 않는다
        await deps.snapshot?.(key, base.content).catch(() => { /* 이력은 부가 기능 */ });
        // baseMtime 을 보내 그 사이 다른 곳에서 바뀌었으면 서버가 409 로 거절한다
        await getJson(`/api/file?path=${enc(key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(base.mtime === undefined ? { content: text } : { content: text, baseMtime: base.mtime }),
        });
        mtimes.delete(key);
        return true;
      } catch { return false; }
    },

    async searchLines(name, signal) {
      // 이름(또는 폴더/이름)이 든 `[[…` 줄만 찾는다. 이름이 너무 길면 `[[` 전체로 찾는다(검색어 300자 제한)
      const re = name.length <= 120 ? `\\[\\[[^\\]\\n]*${escRe(name)}` : '\\[\\[';
      const r = await getJson<SearchRes>(`/api/search?q=${enc(re)}&cs=0&re=1`, { signal });
      const hits: LineHit[] = [];
      for (const f of r.results) for (const m of f.matches) hits.push({ key: f.path, path: docPath(f.path), line: m.line, text: m.text });
      return { hits, truncated: r.truncated || r.results.some((f) => f.more) };
    },
  };
}
