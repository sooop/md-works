import { describe, it, expect } from 'vitest';
import { numberComments, commentRows, lostRange } from '../../src/lib/comments/numbering';

const t = (id: string, over: { resolved?: boolean; msgs?: string[]; quote?: string } = {}) => ({
  id, anchor: { quote: over.quote ?? `q-${id}`, prefix: '', suffix: '' },
  messages: (over.msgs ?? [`m-${id}`]).map((text, i) => ({ id: `${id}-${i}`, text, ts: i })),
  resolved: over.resolved ?? false,
});

describe('lostRange', () => {
  it('범위 없음·접힌 범위는 위치 잃음', () => {
    expect(lostRange(undefined)).toBe(true);
    expect(lostRange({ from: 5, to: 5 })).toBe(true);
    expect(lostRange({ from: 5, to: 4 })).toBe(true);
    expect(lostRange({ from: 5, to: 6 })).toBe(false);
  });
});

describe('numberComments', () => {
  it('입력 순서가 아니라 본문 위치 순으로 번호를 매긴다', () => {
    const n = numberComments([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { a: { from: 30, to: 40 }, b: { from: 1, to: 5 }, c: { from: 10, to: 12 } });
    expect(n).toEqual({ b: 1, c: 2, a: 3 });
  });
  it('위치를 잃은 코멘트는 번호를 건너뛰지 않고 번호 자체가 없다', () => {
    const n = numberComments([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], { a: { from: 9, to: 9 }, b: { from: 1, to: 2 }, d: { from: 7, to: 8 } });
    expect(n).toEqual({ b: 1, d: 2 });
    expect('a' in n).toBe(false);
    expect('c' in n).toBe(false);
  });
  it('같은 위치는 끝 위치 순, 그래도 같으면 입력 순서', () => {
    const n = numberComments([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { a: { from: 1, to: 9 }, b: { from: 1, to: 3 }, c: { from: 1, to: 3 } });
    expect(n).toEqual({ b: 1, c: 2, a: 3 });
  });
  it('빈 입력', () => { expect(numberComments([], {})).toEqual({}); });
});

describe('commentRows', () => {
  it('번호 순으로 먼저, 위치 잃은 것은 뒤에 입력 순서로', () => {
    const rows = commentRows([t('lost1'), t('a'), t('lost2'), t('b')], { a: { from: 20, to: 25 }, b: { from: 2, to: 4 }, lost2: { from: 3, to: 3 } });
    expect(rows.map((r) => [r.id, r.n])).toEqual([['b', 1], ['a', 2], ['lost1', null], ['lost2', null]]);
  });
  it('첫 메시지는 코멘트, 나머지는 답글. 해결됨도 포함한다', () => {
    const [r] = commentRows([t('a', { msgs: ['본문', '답1', '답2'], resolved: true, quote: '인용' })], { a: { from: 1, to: 2 } });
    expect(r).toEqual({ id: 'a', n: 1, quote: '인용', text: '본문', replies: ['답1', '답2'], resolved: true });
  });
  it('메시지가 없어도 죽지 않는다', () => {
    const [r] = commentRows([t('a', { msgs: [] })], {});
    expect(r.text).toBe('');
    expect(r.replies).toEqual([]);
  });
});
