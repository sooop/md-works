// 검색 결과의 한 줄 미리보기: 첫 일치 부분 근처를 잘라 일치 구간에 표시를 붙인다(순수 함수).
import { matchRanges } from '../search/nameMatch';

export interface PreviewPart { t: string; hit: boolean }

export function preview(text: string, query: string, max = 72, lead = 18): PreviewPart[] {
  const flat = text.replace(/\s+/g, ' ').trim();
  const ranges = matchRanges(flat, query);
  const start = ranges.length ? Math.max(0, ranges[0][0] - lead) : 0;
  const end = Math.min(flat.length, start + max);
  const parts: PreviewPart[] = [];
  let cur = start;
  for (const [a, b] of ranges) {
    if (b <= cur) continue;
    if (a >= end) break;
    const hs = Math.max(a, cur);
    const he = Math.min(b, end);
    if (hs > cur) parts.push({ t: flat.slice(cur, hs), hit: false });
    parts.push({ t: flat.slice(hs, he), hit: true });
    cur = he;
  }
  if (cur < end) parts.push({ t: flat.slice(cur, end), hit: false });
  if (!parts.length) return [];
  if (start > 0) parts[0] = { ...parts[0], t: '…' + parts[0].t };
  if (end < flat.length) parts[parts.length - 1] = { ...parts[parts.length - 1], t: parts[parts.length - 1].t + '…' };
  return parts;
}
