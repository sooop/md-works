import { describe, it, expect } from 'vitest';
import { isEmptyBlock, displayBlock, displaySegs, diffText, EMPTY_LABEL } from '../../src/lib/history/diff';

describe('이력 diff 표시용 변환', () => {
  it('빈 문단 <br /> 블록을 알아본다', () => {
    expect(isEmptyBlock('<br />')).toBe(true);
    expect(isEmptyBlock(' <br/> ')).toBe(true);
    expect(isEmptyBlock('<BR>')).toBe(true);
    expect(isEmptyBlock('글 <br />')).toBe(false);
    expect(isEmptyBlock('')).toBe(false);
  });
  it('표시 문자열만 바꾸고 원문 블록은 그대로다', () => {
    expect(displayBlock('<br />')).toBe(EMPTY_LABEL);
    expect(displayBlock('문단')).toBe('문단');
    const h = diffText('가\n\n<br />\n\n나', '가\n\n나');
    expect(h).toHaveLength(1);
    expect(h[0].ver).toEqual(['<br />']); // 되돌리기 데이터는 원문 유지
  });
  it('한쪽이 빈 문단인 변경 쌍은 통째 교체로 보인다', () => {
    const [h] = diffText('<br />', '새 문단');
    expect(displaySegs(h.pairs[0])).toEqual([
      { type: 'del', text: EMPTY_LABEL }, { type: 'add', text: '새 문단' },
    ]);
  });
  it('일반 쌍은 단어 diff 를 그대로 쓴다', () => {
    const [h] = diffText('가 나', '가 다');
    expect(displaySegs(h.pairs[0])).toBe(h.pairs[0].segs);
  });
});
