// 표 확대 보기의 순수 계산: 숫자 읽기, 선택 영역 통계, 필터, 정렬, 열 순서.

/** 셀 글자 → 숫자. `1,234` `12%` `₩5,000` `$3.5` `(120)`(음수) `-3` `1.5e3` 를 읽고 숫자가 아니면 null */
export function parseNumber(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/^[₩$€£¥]\s*/, '').replace(/\s*(원|%|달러)$/, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export interface Stats {
  /** 비어 있지 않은 셀 수 */
  count: number;
  /** 그중 숫자로 읽은 셀 수 */
  numbers: number;
  sum: number;
  mean: number;
  min: number;
  max: number;
  median: number;
  /** 모분산 (n 으로 나눔) */
  variance: number;
  /** 모표준편차 */
  stdev: number;
}

/** 선택한 셀들의 통계. 숫자가 하나도 없으면 count 만 의미 있고 나머지는 null */
export function computeStats(cells: string[]): { count: number; numbers: number; stats: Stats | null } {
  const filled = cells.filter((c) => c.trim() !== '');
  const nums = filled.map(parseNumber).filter((n): n is number => n !== null);
  if (!nums.length) return { count: filled.length, numbers: 0, stats: null };
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    count: filled.length,
    numbers: nums.length,
    stats: { count: filled.length, numbers: nums.length, sum, mean, min: sorted[0], max: sorted[sorted.length - 1], median, variance, stdev: Math.sqrt(variance) },
  };
}

/** 통계 숫자를 읽기 좋게(소수 넷째 자리까지, 천 단위 쉼표) */
export const fmtNum = (n: number): string => n.toLocaleString('ko-KR', { maximumFractionDigits: 4 });

/**
 * 열 필터 한 칸의 식을 셀이 만족하는가.
 * - 비어 있으면 모두 통과
 * - `>10` `>=10` `<10` `<=10` `=10` `!=10`: 숫자 비교(셀이 숫자여야 함)
 * - `=글자` `!=글자`: 정확히 같음/다름(대소문자 무시)
 * - 그 밖: 부분 일치(대소문자 무시)
 */
export function matchesColumnFilter(cell: string, expr: string): boolean {
  const e = expr.trim();
  if (!e) return true;
  const m = /^(>=|<=|!=|=|>|<)\s*(.*)$/.exec(e);
  if (!m) return cell.toLowerCase().includes(e.toLowerCase());
  const [, op, rhs] = m;
  const a = parseNumber(cell);
  const b = parseNumber(rhs);
  if (a !== null && b !== null) {
    switch (op) {
      case '>': return a > b;
      case '>=': return a >= b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '=': return a === b;
      default: return a !== b;
    }
  }
  if (op === '=') return cell.trim().toLowerCase() === rhs.trim().toLowerCase();
  if (op === '!=') return cell.trim().toLowerCase() !== rhs.trim().toLowerCase();
  return false; // 숫자가 아닌 셀에 크기 비교는 통과시키지 않는다
}

/** 전체 검색어(모든 열 부분 일치) + 열별 필터를 모두 만족하는 행만 */
export function filterRows(rows: string[][], query: string, colFilters: string[]): string[][] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !r.some((c) => c.toLowerCase().includes(q))) return false;
    return colFilters.every((f, i) => matchesColumnFilter(r[i] ?? '', f));
  });
}

/** 한 열 기준 정렬(원래 순서가 같은 값끼리는 유지). 숫자로 읽히는 값끼리는 크기순, 아니면 자연 정렬 */
export function sortRows(rows: string[][], col: number, dir: 1 | -1): string[][] {
  const cmp = (x: string, y: string) => {
    const a = parseNumber(x), b = parseNumber(y);
    if (a !== null && b !== null) return a - b;
    return x.localeCompare(y, undefined, { numeric: true });
  };
  return rows.map((r, i) => ({ r, i })).sort((p, q) => dir * cmp(p.r[col] ?? '', q.r[col] ?? '') || p.i - q.i).map((p) => p.r);
}

/** 열 순서 배열에서 from 위치의 열을 to 위치로 옮긴다 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/**
 * 표의 행·열을 바꾼다. rows 는 헤더 행을 포함한 전체 행.
 * 헤더가 켜진 표는 첫 열이 새 헤더가 된다. 헤더가 꺼진 표(첫 행이 빈 헤더)는 그 빈 행을 빼고 본문만 바꾼 뒤 빈 헤더 행을 다시 앞에 둔다.
 * 짧은 행은 빈 칸으로 채운다.
 */
export function transposeRows(rows: string[][], headerOn: boolean): string[][] {
  const body = headerOn ? rows : rows.slice(1);
  const width = Math.max(0, ...body.map((r) => r.length));
  const t = Array.from({ length: width }, (_, c) => body.map((r) => r[c] ?? ''));
  return headerOn ? t : [body.map(() => ''), ...t];
}
