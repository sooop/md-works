// 글감함 목록의 순수 함수: 검색 대상 텍스트, 보기·색·검색어 필터, 문구 관련도 정렬, 본문 분할.
// UI 상태(state.svelte.ts)와 분리해 단위 테스트한다.
import { matchName } from '../search/nameMatch';
import { rankByText } from '../works/suggest';
import type { Snippet, SnippetColor } from '../works/types';

export type SnippetView = 'doc' | 'all' | 'trash';

const IMG_DATA = /!\[([^\]]*)\]\((data:[^)]*)\)/g;

/** 검색·유사도 계산 대상 텍스트: 본문(이미지 data URL 제외) + 원전 제목·URL·발췌 */
export function snippetText(s: Snippet): string {
  const body = s.body.replace(IMG_DATA, ' ');
  return [body, s.source?.title, s.source?.url, s.source?.excerpt].filter(Boolean).join('\n');
}

export interface ListQuery {
  view: SnippetView;
  /** 현재 글의 docKey. 없으면 '이 글에 붙은 것' 은 비어 있다. */
  docKey: string;
  color: SnippetColor | '';
  query: string;
}

/** 공백으로 나눈 모든 단어가 (대소문자 무시·초성 가능) 들어 있으면 일치 */
export function matchSnippet(s: Snippet, query: string): boolean {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = snippetText(s);
  return terms.every((t) => matchName(text, t));
}

export function filterSnippets(active: Snippet[], trashed: Snippet[], q: ListQuery): Snippet[] {
  let list = q.view === 'trash' ? trashed : q.view === 'all' ? active : active.filter((s) => !!q.docKey && s.attachedDocs.includes(q.docKey));
  if (q.color) list = list.filter((s) => s.color === q.color);
  return list.filter((s) => matchSnippet(s, q.query));
}

/** 문구와 관련 있는 글감을 관련도 순으로 (점수 0 제외). 색 필터는 적용하지 않는다. */
export function findByPhrase(phrase: string, active: Snippet[], topN = 50): Snippet[] {
  const byId = new Map(active.map((s) => [s.id, s]));
  return rankByText(phrase, active.map((s) => ({ id: s.id, text: snippetText(s) })), topN)
    .map((r) => byId.get(r.id)!)
    .filter(Boolean);
}

/** 유사 글감 후보: 자기 자신을 뺀 보관함 글감 */
export const suggestCandidates = (self: Snippet, active: Snippet[]) =>
  active.filter((s) => s.id !== self.id).map((s) => ({ id: s.id, text: snippetText(s) }));

/** 붙여넣은 글이 URL 하나뿐이면 그 URL, 아니면 null */
export function asUrl(text: string): string | null {
  const t = text.trim();
  return /^https?:\/\/\S+$/i.test(t) ? t : null;
}

export type BodyPart = { type: 'text'; v: string } | { type: 'img'; v: string; alt: string };

/** 카드에 그릴 수 있도록 본문을 텍스트와 data URL 이미지로 나눈다 */
export function splitBody(body: string): BodyPart[] {
  const out: BodyPart[] = [];
  let pos = 0;
  for (const m of body.matchAll(IMG_DATA)) {
    if (m.index > pos) out.push({ type: 'text', v: body.slice(pos, m.index) });
    out.push({ type: 'img', v: m[2], alt: m[1] });
    pos = m.index + m[0].length;
  }
  if (pos < body.length) out.push({ type: 'text', v: body.slice(pos) });
  return out;
}
