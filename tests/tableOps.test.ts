import { describe, it, expect } from 'vitest';
import { parseNumber, computeStats, matchesColumnFilter, filterRows, sortRows, moveItem, transposeRows } from '../src/lib/tableOps';
import { toHtml, toAscii, toMarkdown, textWidth } from '../src/lib/tableFormats';

describe('parseNumber', () => {
  it('여러 표기를 읽는다', () => {
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('12%')).toBe(12);
    expect(parseNumber('₩5,000')).toBe(5000);
    expect(parseNumber('$3.5')).toBe(3.5);
    expect(parseNumber('(120)')).toBe(-120);
    expect(parseNumber('-3')).toBe(-3);
    expect(parseNumber('1.5e3')).toBe(1500);
    expect(parseNumber('3,000원')).toBe(3000);
  });
  it('숫자가 아니면 null', () => {
    for (const s of ['', 'abc', '12abc', '1,23', '--1', '1.2.3']) expect(parseNumber(s), s).toBeNull();
  });
});

describe('computeStats', () => {
  it('합계·평균·최소·최대·중앙값·분산·표준편차', () => {
    const r = computeStats(['2', '4', '4', '4', '5', '5', '7', '9', '', 'x']);
    expect(r.count).toBe(9);
    expect(r.numbers).toBe(8);
    expect(r.stats).toMatchObject({ sum: 40, mean: 5, min: 2, max: 9, median: 4.5, variance: 4, stdev: 2 });
  });
  it('숫자가 없으면 stats 가 null', () => {
    expect(computeStats(['a', 'b', ''])).toEqual({ count: 2, numbers: 0, stats: null });
  });
});

describe('필터', () => {
  it('부분 일치와 숫자 비교', () => {
    expect(matchesColumnFilter('Apple', 'app')).toBe(true);
    expect(matchesColumnFilter('12', '>10')).toBe(true);
    expect(matchesColumnFilter('12', '<=10')).toBe(false);
    expect(matchesColumnFilter('1,200', '>=1000')).toBe(true);
    expect(matchesColumnFilter('abc', '>1')).toBe(false);
    expect(matchesColumnFilter('Abc', '=abc')).toBe(true);
    expect(matchesColumnFilter('Abc', '!=abd')).toBe(true);
    expect(matchesColumnFilter('x', '')).toBe(true);
  });
  it('전체 검색어 + 열 필터를 함께 쓴다', () => {
    const rows = [['a', '1'], ['b', '5'], ['ab', '9']];
    expect(filterRows(rows, 'a', ['', '>3'])).toEqual([['ab', '9']]);
    expect(filterRows(rows, '', ['', ''])).toEqual(rows);
  });
});

describe('정렬·열 이동', () => {
  it('숫자는 크기순, 같은 값은 원래 순서 유지', () => {
    const rows = [['b', '10'], ['a', '2'], ['c', '10']];
    expect(sortRows(rows, 1, 1).map((r) => r[0])).toEqual(['a', 'b', 'c']);
    expect(sortRows(rows, 1, -1).map((r) => r[0])).toEqual(['b', 'c', 'a']);
  });
  it('moveItem', () => {
    expect(moveItem([0, 1, 2, 3], 3, 1)).toEqual([0, 3, 1, 2]);
    expect(moveItem([0, 1], 0, 5)).toEqual([0, 1]);
  });
});

describe('표 형식 변환', () => {
  const rows = [['이름', '값'], ['사과', '1,200'], ['kiwi', '30']];
  it('textWidth: 한글은 2칸', () => {
    expect(textWidth('가a')).toBe(3);
  });
  it('아스키 표: 한글 폭을 맞추고 숫자 열은 오른쪽 맞춤', () => {
    expect(toAscii(rows)).toBe([
      '+------+-------+',
      '| 이름 |    값 |',
      '+======+=======+',
      '| 사과 | 1,200 |',
      '| kiwi |    30 |',
      '+------+-------+',
    ].join('\n'));
  });
  it('HTML: 이스케이프와 줄바꿈', () => {
    const h = toHtml([['a<b', 'x'], ['1\n2', '&']]);
    expect(h).toContain('<th>a&lt;b</th>');
    expect(h).toContain('<td>1<br>2</td>');
    expect(h).toContain('<td>&amp;</td>');
  });
  it('마크다운: 파이프 이스케이프', () => {
    expect(toMarkdown([['a|b', 'c'], ['1', '2']])).toBe('| a\\|b | c |\n| --- | --- |\n| 1 | 2 |');
  });
});

describe('transposeRows', () => {
  const t = [['이름', 'A', 'B'], ['x', '1', '2'], ['y', '3', '4']];
  it('헤더가 켜진 표는 첫 열이 새 헤더가 되고 두 번 하면 원래대로', () => {
    const r = transposeRows(t, true);
    expect(r).toEqual([['이름', 'x', 'y'], ['A', '1', '3'], ['B', '2', '4']]);
    expect(transposeRows(r, true)).toEqual(t);
  });
  it('헤더가 꺼진 표는 빈 헤더 행을 유지한다', () => {
    expect(transposeRows([['', ''], ['1', '2'], ['3', '4']], false)).toEqual([['', ''], ['1', '3'], ['2', '4']]);
  });
});
