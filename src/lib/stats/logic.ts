// 집필 통계 순수 로직: 날짜 키·변화량 추적·병합·연속 작성일·요약. 저장소·시계는 인자로 받아 테스트할 수 있다.

/** 날짜별 하루 작성량(공백 제외 글자 수의 순증가). 키는 기기의 현지 날짜 'YYYY-MM-DD' */
export type Days = Record<string, number>;

/** 한 번의 변화가 이보다 크면(붙여넣기·가져오기·버전 복구) 세지 않는다 */
export const MAX_STEP = 2000;
/** 보관 일수. 오래된 날짜는 쓸 때 정리한다 */
export const KEEP_DAYS = 400;
/** 번들에서 읽을 날짜 수 상한과 값의 절댓값 상한 */
export const MAX_DAYS = 2000;
export const MAX_ABS = 1_000_000;

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 기기의 현지 날짜 키 */
export const dateKey = (ms: number) => fmt(new Date(ms));

/** 'YYYY-MM-DD' 형식이고 실제로 있는 날짜인가 (2월 30일 같은 값은 거른다) */
export function isDateKey(k: unknown): k is string {
  if (typeof k !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
  const [y, m, d] = k.split('-').map(Number);
  return fmt(new Date(y, m - 1, d, 12)) === k;
}

/** 날짜 키에 n 일을 더한다. 정오 기준이라 서머타임 전환일에도 어긋나지 않는다 */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return fmt(new Date(y, m - 1, d + n, 12));
}

/** 요일(0=일 … 6=토) */
export function weekday(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getDay();
}

const validValue = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= MAX_ABS;

/** 알 수 없는 값 → 올바른 항목만 남긴 Days. 날짜 수가 상한을 넘으면 최근 날짜부터 남긴다. 망가진 항목은 그것만 버린다 */
export function cleanDays(raw: unknown): Days {
  const out: Days = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  const keys = Object.keys(src).filter((k) => isDateKey(k) && validValue(src[k]));
  keys.sort().reverse();
  for (const k of keys.slice(0, MAX_DAYS)) out[k] = src[k] as number;
  return out;
}

/** 저장 JSON 의 `{ days }` → Days. 형식이 깨졌으면 빈 값 */
export function parseStats(text: string | null | undefined): Days {
  if (!text) return {};
  try {
    const j = JSON.parse(text) as unknown;
    return j && typeof j === 'object' ? cleanDays((j as { days?: unknown }).days) : {};
  } catch { return {}; }
}

export const serializeStats = (days: Days) => JSON.stringify({ days: cleanDays(days) });

/** 같은 날짜는 큰 값 우선으로 합친다 */
export function mergeDays(a: Days, b: Days): Days {
  const out: Days = { ...cleanDays(a) };
  for (const [k, v] of Object.entries(cleanDays(b))) out[k] = k in out ? Math.max(out[k], v) : v;
  return out;
}

/** 보관 기간(최근 KEEP_DAYS 일)보다 오래된 날짜를 뺀다 */
export function pruneDays(days: Days, today: string): Days {
  const cutoff = addDays(today, -(KEEP_DAYS - 1));
  const out: Days = {};
  for (const [k, v] of Object.entries(days)) if (k >= cutoff) out[k] = v;
  return out;
}

/** days 에 증분을 더한 새 객체. 값은 상한 안으로 맞춘다 */
export function addDelta(days: Days, delta: Days): Days {
  const out: Days = { ...days };
  for (const [k, d] of Object.entries(delta)) {
    if (!isDateKey(k) || !Number.isFinite(d) || d === 0) continue;
    out[k] = Math.max(-MAX_ABS, Math.min(MAX_ABS, (out[k] ?? 0) + Math.trunc(d)));
  }
  return out;
}

// ---- 변화량 추적 ----
export interface Tracker {
  /** 지금 글(식별자)과 공백 제외 글자 수를 알린다. 센 변화량(세지 않았으면 0)을 돌려준다 */
  observe(id: string | null, count: number, nowMs: number): number;
  /** 모은 증분을 꺼내고 비운다 */
  take(): Days;
  /** 모은 증분을 비우지 않고 본다 */
  peek(): Days;
}

/**
 * 같은 글 안의 글자 수 변화만 오늘 날짜에 모은다.
 * 글이 바뀌면(식별자가 다르면) 기준값만 다시 잡고 세지 않는다. 처음 여는 순간의 0 → N 도 세지 않는다.
 * 한 번의 변화가 MAX_STEP 을 넘으면 세지 않는다(기준값은 따라간다).
 */
export function createTracker(): Tracker {
  let id: string | null = null;
  let last = 0;
  let pending: Days = {};
  return {
    observe(next, count, nowMs) {
      if (next === null) { id = null; return 0; }
      if (next !== id) { id = next; last = count; return 0; }
      const d = count - last;
      last = count;
      if (d === 0 || Math.abs(d) > MAX_STEP) return 0;
      const k = dateKey(nowMs);
      pending[k] = (pending[k] ?? 0) + d;
      return d;
    },
    take() { const p = pending; pending = {}; return p; },
    peek() { return pending; },
  };
}

// ---- 요약 ----
export interface Summary { today: number; week: number; month: number; streak: number; best: number }

const sumRange = (days: Days, today: string, n: number) => {
  let s = 0;
  for (let i = 0; i < n; i++) s += days[addDays(today, -i)] ?? 0;
  return s;
};

/** 오늘(오늘이 아직 양수가 아니면 어제)부터 거꾸로, 작성량이 양수인 날이 끊기지 않고 이어진 일수 */
export function currentStreak(days: Days, today: string): number {
  let k = (days[today] ?? 0) > 0 ? today : addDays(today, -1);
  let n = 0;
  while ((days[k] ?? 0) > 0) { n++; k = addDays(k, -1); }
  return n;
}

/** 기록 전체에서 가장 길게 이어진 연속 작성일 */
export function longestStreak(days: Days): number {
  const keys = Object.keys(days).filter((k) => days[k] > 0).sort();
  let best = 0;
  let run = 0;
  let prev = '';
  for (const k of keys) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    if (run > best) best = run;
    prev = k;
  }
  return best;
}

export function summarize(days: Days, today: string): Summary {
  const streak = currentStreak(days, today);
  return { today: days[today] ?? 0, week: sumRange(days, today, 7), month: sumRange(days, today, 30), streak, best: Math.max(longestStreak(days), streak) };
}

// ---- 그래프용 ----
export const hasRecords = (days: Days) => Object.keys(days).length > 0;

/** 오늘까지 최근 n 일(오래된 날부터) */
export function lastDays(days: Days, today: string, n: number): { date: string; value: number }[] {
  return Array.from({ length: n }, (_, i) => { const date = addDays(today, i - (n - 1)); return { date, value: days[date] ?? 0 }; });
}

export interface Cell { date: string; value: number; level: 0 | 1 | 2 | 3 | 4 }

/** 양수 작성량의 농도 단계(1~4). 창 안 최댓값 대비 비율로 나눈다. 0 이하는 0 */
export function level(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((value / max) * 4))) as 1 | 2 | 3 | 4;
}

/** 최근 weeks 주의 월요일 시작 주 단위 열. 열마다 7칸(월~일), 오늘 이후는 null */
export function weekGrid(days: Days, today: string, weeks = 12): (Cell | null)[][] {
  const offset = (weekday(today) + 6) % 7; // 이번 주 월요일로부터 며칠째
  const start = addDays(today, -offset - 7 * (weeks - 1));
  let max = 0;
  for (let i = 0; i < weeks * 7; i++) max = Math.max(max, days[addDays(start, i)] ?? 0);
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, r) => {
    const date = addDays(start, w * 7 + r);
    if (date > today) return null;
    const value = days[date] ?? 0;
    return { date, value, level: level(value, max) };
  }));
}

/** '+1,234' / '−56' / '0' */
export function signed(n: number): string {
  const s = Math.abs(n).toLocaleString('en-US');
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : '0';
}

/** '11월 14일' */
export function dayLabel(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${m}월 ${d}일`;
}
