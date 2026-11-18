// 코멘트 번호 매기기(읽기 모드 '코멘트 보기'·코멘트 포함 인쇄 공용). 순수 함수만 둔다.
// 번호는 본문 위치(from) 순, 같은 위치면 구간 끝(to) 순, 그래도 같으면 입력 순서. 위치를 잃은 코멘트(접힌 범위·범위 없음)는 번호 없이 목록 끝에만 들어간다.
import type { Thread } from '../works/types';

export interface Range { from: number; to: number }

/** 위치를 잃었는가: 범위가 없거나 접혔다(from >= to) */
export const lostRange = (r: Range | undefined): boolean => !r || r.from >= r.to;

/** 번호가 붙은 코멘트 id → 번호(1부터). 위치를 잃은 것은 들어 있지 않다 */
export function numberComments(items: readonly { id: string }[], ranges: Record<string, Range | undefined>): Record<string, number> {
  const placed = items
    .map((c, i) => ({ id: c.id, i, r: ranges[c.id] }))
    .filter((x): x is { id: string; i: number; r: Range } => !lostRange(x.r));
  placed.sort((a, b) => a.r.from - b.r.from || a.r.to - b.r.to || a.i - b.i);
  const out: Record<string, number> = {};
  placed.forEach((x, k) => { out[x.id] = k + 1; });
  return out;
}

export interface CommentRow {
  id: string;
  /** 본문 배지 번호. 위치를 잃었으면 null */
  n: number | null;
  quote: string;
  /** 첫 메시지 */
  text: string;
  /** 나머지 메시지 */
  replies: string[];
  resolved: boolean;
}

/** '코멘트' 절의 행: 번호 순으로 먼저, 위치를 잃은 것은 그 뒤에(입력 순서). 열린·해결됨 모두 포함한다 */
export function commentRows(
  items: readonly Pick<Thread, 'id' | 'anchor' | 'messages' | 'resolved'>[],
  ranges: Record<string, Range | undefined>,
): CommentRow[] {
  const nums = numberComments(items, ranges);
  const rows = items.map((c): CommentRow => ({
    id: c.id,
    n: nums[c.id] ?? null,
    quote: c.anchor.quote,
    text: c.messages[0]?.text ?? '',
    replies: c.messages.slice(1).map((m) => m.text),
    resolved: c.resolved,
  }));
  const placed = rows.filter((r) => r.n !== null).sort((a, b) => a.n! - b.n!);
  return [...placed, ...rows.filter((r) => r.n === null)];
}
