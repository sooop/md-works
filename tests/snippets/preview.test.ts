import { describe, it, expect } from 'vitest';
import { matchRanges } from '../../src/lib/search/nameMatch';
import { preview } from '../../src/lib/snippets/preview';

describe('matchRanges', () => {
  it('단어마다 처음 일치 구간, 초성도 가능', () => {
    expect(matchRanges('오늘 회의록 정리', '회의')).toEqual([[3, 5]]);
    expect(matchRanges('오늘 회의록 정리', 'ㅎㅇㄹ')).toEqual([[3, 6]]);
    expect(matchRanges('오늘 회의록 정리', '정리 오늘')).toEqual([[0, 2], [7, 9]]);
  });
  it('겹치면 합친다', () => {
    expect(matchRanges('abcdef', 'abc cde')).toEqual([[0, 5]]);
  });
  it('일치가 없거나 검색어가 비면 빈 배열', () => {
    expect(matchRanges('abc', 'x')).toEqual([]);
    expect(matchRanges('abc', '  ')).toEqual([]);
  });
});

describe('preview', () => {
  it('일치 부분에 표시를 붙인다', () => {
    expect(preview('가나다 라마바', '라마')).toEqual([{ t: '가나다 ', hit: false }, { t: '라마', hit: true }, { t: '바', hit: false }]);
  });
  it('긴 글은 일치 앞뒤만 잘라 말줄임표를 붙인다', () => {
    const long = '가'.repeat(100) + '찾기' + '나'.repeat(100);
    const parts = preview(long, '찾기', 30, 5);
    expect(parts.map((p) => p.t).join('')).toBe('…' + '가'.repeat(5) + '찾기' + '나'.repeat(23) + '…');
    expect(parts.find((p) => p.hit)?.t).toBe('찾기');
  });
  it('일치가 없으면(관련도순 등) 앞부분만', () => {
    expect(preview('가나다', '').map((p) => p.t).join('')).toBe('가나다');
  });
});

import { highlight } from '../../src/lib/search/nameMatch';
describe('highlight', () => {
  it('일치 구간을 나눈다', () => {
    expect(highlight('회의록 정리', '의록')).toEqual([{ t: '회', hit: false }, { t: '의록', hit: true }, { t: ' 정리', hit: false }]);
    expect(highlight('abc', '')).toEqual([{ t: 'abc', hit: false }]);
  });
});
