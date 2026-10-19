// 솎아내기 정책(순수 함수): 최근 24시간은 전부, 24시간~7일은 시간당 1개, 7일 초과는 일당 1개(그 구간의 마지막 것).
// 이름이 붙은 버전과 가장 최근 버전은 절대 지우지 않는다.
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
export const RECENT_MS = DAY;
export const HOURLY_MS = 7 * DAY;

export interface ThinItem { id: string; ts: number; name?: string }

/** 지워야 할 버전의 id 목록 */
export function thinVersions(items: ThinItem[], now: number): string[] {
  if (!items.length) return [];
  const newest = items.reduce((a, b) => (b.ts > a.ts ? b : a));
  const keep = new Set<string>([newest.id]);
  const last = new Map<string, ThinItem>(); // 버킷 → 그 버킷의 마지막 버전
  for (const it of items) {
    if (it.name) { keep.add(it.id); continue; }
    const age = now - it.ts;
    if (age < RECENT_MS) { keep.add(it.id); continue; }
    const bucket = age < HOURLY_MS ? `h${Math.floor(it.ts / HOUR)}` : `d${Math.floor(it.ts / DAY)}`;
    const cur = last.get(bucket);
    if (!cur || it.ts > cur.ts) last.set(bucket, it);
  }
  for (const it of last.values()) keep.add(it.id);
  return items.filter((it) => !keep.has(it.id)).map((it) => it.id);
}
