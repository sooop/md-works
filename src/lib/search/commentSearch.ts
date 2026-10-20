// 코멘트(스레드) 메시지 검색. 본문 검색과 같은 규칙(buildMatcher/searchText)을 쓴다.
import { buildMatcher, searchText } from '../../../server/searchCore.js';
import type { WorksStore } from '../works/store';
import type { Thread } from '../works/types';
import type { CommentHit } from './types';

export type { CommentHit };

/** 코멘트 결과 개수 상한 (전체 검색의 SEARCH_TOTAL 과 같은 크기) */
export const COMMENT_TOTAL = 500;

/**
 * docs 의 각 문서(id = 스레드 파티션 docKey)에서 코멘트 메시지를 검색한다.
 * 스레드마다 처음 일치한 메시지 하나만 결과로 낸다. 검색어가 잘못되면(정규식 오류 등) Error 를 던진다.
 * 상한(COMMENT_TOTAL)에 닿으면 거기서 멈춘다.
 */
export async function searchComments(
  store: Pick<WorksStore, 'list'>,
  docs: { id: string; label: string }[],
  query: string,
  opts: { caseSensitive: boolean; regex: boolean },
  limit = COMMENT_TOTAL,
): Promise<CommentHit[]> {
  const m = buildMatcher(query, opts);
  if (m.error !== undefined) throw new Error(m.error);
  const hits: CommentHit[] = [];
  for (const d of docs) {
    if (hits.length >= limit) break;
    const threads = (await store.list<Thread>('threads', d.id))
      .filter((t) => !t.deletedAt)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const t of threads) {
      if (hits.length >= limit) break;
      for (const msg of t.messages) {
        const { matches } = searchText(msg.text, m.re, { maxMatches: 1 });
        if (!matches.length) continue;
        hits.push({
          docId: d.id, label: d.label, threadId: t.id,
          snippet: matches[0].text, ranges: matches[0].ranges, resolved: t.resolved,
        });
        break;
      }
    }
  }
  return hits;
}
