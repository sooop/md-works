import { describe, it, expect } from 'vitest';
import {
  addDays, addDelta, cleanDays, createTracker, currentStreak, dateKey, isDateKey, KEEP_DAYS, level, longestStreak, MAX_ABS, MAX_DAYS,
  mergeDays, parseStats, pruneDays, serializeStats, summarize, weekGrid, signed, type Days,
} from '../../src/lib/stats/logic';

/** 현지 시각 */
const at = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

describe('날짜 키', () => {
  it('현지 날짜로 만든다', () => {
    expect(dateKey(at(2026, 11, 14, 0, 5))).toBe('2026-11-14');
    expect(dateKey(at(2026, 11, 14, 23, 59))).toBe('2026-11-14');
  });
  it('addDays 는 달·해를 넘긴다', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });
  it('isDateKey 는 형식과 실제 날짜를 검사한다', () => {
    expect(isDateKey('2026-11-14')).toBe(true);
    for (const k of ['2026-2-3', '2026-02-30', '2026-13-01', '20261114', '', 5, null]) expect(isDateKey(k)).toBe(false);
  });
});

describe('변화량 추적', () => {
  const t0 = at(2026, 11, 14, 10);
  it('같은 글 안의 변화량을 오늘에 더한다 (500자 쓰고 200자 지우면 +300)', () => {
    const t = createTracker();
    t.observe('a', 1000, t0); // 처음 열기: 기준값만
    t.observe('a', 1500, t0);
    t.observe('a', 1300, t0);
    expect(t.take()).toEqual({ '2026-11-14': 300 });
    expect(t.take()).toEqual({});
  });
  it('글을 바꾸면 기준값만 다시 잡고 세지 않는다', () => {
    const t = createTracker();
    t.observe('a', 100, t0);
    t.observe('a', 110, t0);
    expect(t.observe('b', 900, t0)).toBe(0); // 100 → 900 이 아니라 새 글의 기준
    t.observe('b', 905, t0);
    expect(t.take()).toEqual({ '2026-11-14': 15 });
  });
  it('처음 여는 순간의 0 → N 은 세지 않는다', () => {
    const t = createTracker();
    expect(t.observe('a', 0, t0)).toBe(0);
    expect(t.observe(null, 0, t0)).toBe(0); // 글을 닫음
    expect(t.observe('b', 800, t0)).toBe(0);
    expect(t.take()).toEqual({});
  });
  it('같은 식별자로 다시 열어도 글을 닫으면(null) 기준을 다시 잡는다', () => {
    const t = createTracker();
    t.observe('a', 10, t0);
    t.observe(null, 0, t0);
    expect(t.observe('a', 5000, t0)).toBe(0);
  });
  it('한 번의 변화가 2,000자를 넘으면(절댓값) 세지 않고 기준은 따라간다', () => {
    const t = createTracker();
    t.observe('a', 0, t0);
    expect(t.observe('a', 2000, t0)).toBe(2000); // 경계는 센다
    expect(t.observe('a', 4001, t0)).toBe(0); // +2001 → 제외
    expect(t.observe('a', 4010, t0)).toBe(9); // 기준은 4001 로 따라갔다
    expect(t.observe('a', 1000, t0)).toBe(0); // -3010 → 제외
    expect(t.take()).toEqual({ '2026-11-14': 2009 });
  });
  it('줄어든 날은 음수가 된다', () => {
    const t = createTracker();
    t.observe('a', 500, t0);
    t.observe('a', 380, t0);
    expect(t.take()).toEqual({ '2026-11-14': -120 });
  });
  it('자정을 넘기면 이후 변화는 새 날짜에 쌓인다', () => {
    const t = createTracker();
    t.observe('a', 100, at(2026, 11, 14, 23, 59));
    t.observe('a', 130, at(2026, 11, 14, 23, 59));
    t.observe('a', 150, at(2026, 11, 15, 0, 1));
    expect(t.take()).toEqual({ '2026-11-14': 30, '2026-11-15': 20 });
  });
});

describe('연속 작성일', () => {
  const today = '2026-11-14';
  it('오늘이 양수면 오늘부터 센다', () => {
    expect(currentStreak({ '2026-11-14': 5, '2026-11-13': 1, '2026-11-12': 9 }, today)).toBe(3);
  });
  it('오늘이 아직 0 이면 어제부터 센다', () => {
    expect(currentStreak({ '2026-11-13': 1, '2026-11-12': 9 }, today)).toBe(2);
    expect(currentStreak({ '2026-11-14': 0, '2026-11-13': 1 }, today)).toBe(1);
  });
  it('오늘이 음수여도 어제 기준으로 센다', () => {
    expect(currentStreak({ '2026-11-14': -3, '2026-11-13': 1 }, today)).toBe(1);
  });
  it('하루 건너뛰면 끊긴다', () => {
    expect(currentStreak({ '2026-11-14': 5, '2026-11-12': 9, '2026-11-11': 9 }, today)).toBe(1);
    expect(currentStreak({ '2026-11-12': 9 }, today)).toBe(0); // 어제도 0
  });
  it('0·음수인 날도 끊는다', () => {
    expect(currentStreak({ '2026-11-14': 1, '2026-11-13': 0, '2026-11-12': 1 }, today)).toBe(1);
    expect(currentStreak({ '2026-11-14': 1, '2026-11-13': -1, '2026-11-12': 1 }, today)).toBe(1);
  });
  it('달 경계를 넘는다', () => {
    expect(currentStreak({ '2026-03-01': 1, '2026-02-28': 1, '2026-02-27': 1 }, '2026-03-01')).toBe(3);
  });
  it('최장 연속', () => {
    const d: Days = { '2026-01-01': 1, '2026-01-02': 1, '2026-01-03': 1, '2026-01-05': 1, '2026-01-06': 1, '2026-01-07': -5, '2026-01-08': 1 };
    expect(longestStreak(d)).toBe(3);
    expect(longestStreak({})).toBe(0);
  });
});

describe('요약', () => {
  it('오늘·7일·30일·연속·최장', () => {
    const days: Days = { '2026-11-14': 10, '2026-11-13': 20, '2026-11-08': 5, '2026-11-07': 100, '2026-10-16': 1, '2026-10-15': 1000, '2026-06-01': 1, '2026-06-02': 1, '2026-06-03': 1, '2026-06-04': 1 };
    expect(summarize(days, '2026-11-14')).toEqual({ today: 10, week: 35, month: 136, streak: 2, best: 4 });
  });
  it('기록이 없으면 모두 0', () => {
    expect(summarize({}, '2026-11-14')).toEqual({ today: 0, week: 0, month: 0, streak: 0, best: 0 });
  });
  it('signed 는 부호와 천 단위 구분을 붙인다', () => {
    expect(signed(1234)).toBe('+1,234');
    expect(signed(-56)).toBe('−56');
    expect(signed(0)).toBe('0');
  });
});

describe('정리·병합', () => {
  it('400일보다 오래된 날짜를 뺀다', () => {
    const today = '2026-11-14';
    const edge = addDays(today, -(KEEP_DAYS - 1));
    const old = addDays(today, -KEEP_DAYS);
    expect(pruneDays({ [today]: 1, [edge]: 2, [old]: 3 }, today)).toEqual({ [today]: 1, [edge]: 2 });
  });
  it('같은 날짜는 큰 값 우선', () => {
    expect(mergeDays({ '2026-11-14': 5, '2026-11-13': -3 }, { '2026-11-14': 9, '2026-11-13': -8, '2026-11-12': 1 }))
      .toEqual({ '2026-11-14': 9, '2026-11-13': -3, '2026-11-12': 1 });
  });
  it('잘못된 항목만 버린다', () => {
    const raw = {
      '2026-11-14': 5, '2026-11-13': 1.5, '2026-11-12': '7', '2026-11-11': NaN, '2026-11-10': Infinity, '2026-11-09': null,
      '2026-2-3': 4, '2026-02-30': 4, 'x': 4, '2026-11-08': MAX_ABS + 1, '2026-11-07': -(MAX_ABS + 1), '2026-11-06': MAX_ABS, '2026-11-05': -MAX_ABS,
    };
    expect(cleanDays(raw)).toEqual({ '2026-11-14': 5, '2026-11-06': MAX_ABS, '2026-11-05': -MAX_ABS });
  });
  it('날짜 수 상한을 넘으면 최근 날짜를 남긴다', () => {
    const raw: Days = {};
    for (let i = 0; i < MAX_DAYS + 50; i++) raw[addDays('2020-01-01', i)] = 1;
    const out = cleanDays(raw);
    expect(Object.keys(out)).toHaveLength(MAX_DAYS);
    expect(out[addDays('2020-01-01', MAX_DAYS + 49)]).toBe(1);
    expect(out['2020-01-01']).toBeUndefined();
  });
  it('배열·문자열·null 은 빈 값', () => {
    for (const v of [[], 'x', null, 5, undefined]) expect(cleanDays(v)).toEqual({});
  });
  it('저장 JSON 왕복과 깨진 JSON', () => {
    expect(parseStats(serializeStats({ '2026-11-14': 3 }))).toEqual({ '2026-11-14': 3 });
    expect(parseStats('{깨짐')).toEqual({});
    expect(parseStats(null)).toEqual({});
    expect(parseStats('{"days":[1,2]}')).toEqual({});
  });
  it('addDelta 는 값 상한 안에서 더한다', () => {
    expect(addDelta({ '2026-11-14': MAX_ABS - 1 }, { '2026-11-14': 10 })).toEqual({ '2026-11-14': MAX_ABS });
    expect(addDelta({}, { 'x': 3 })).toEqual({});
  });
});

describe('그래프용', () => {
  it('농도 단계', () => {
    expect(level(0, 100)).toBe(0);
    expect(level(-5, 100)).toBe(0);
    expect(level(1, 100)).toBe(1);
    expect(level(26, 100)).toBe(2);
    expect(level(100, 100)).toBe(4);
  });
  it('주 격자: 12열 × 7행(월~일), 오늘 이후는 null', () => {
    const today = '2026-11-14'; // 토요일
    const g = weekGrid({ [today]: 50, '2026-11-09': 10 }, today, 12);
    expect(g).toHaveLength(12);
    expect(g.every((w) => w.length === 7)).toBe(true);
    const last = g[11];
    expect(last[0]?.date).toBe('2026-11-09'); // 월
    expect(last[5]?.date).toBe(today);
    expect(last[5]?.level).toBe(4);
    expect(last[6]).toBeNull(); // 일요일은 아직
    expect(g[0][0]?.date).toBe(addDays('2026-11-09', -77));
  });
});
