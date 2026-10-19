import { describe, it, expect } from 'vitest';
import { countChars, countText, stripMarkdown } from '../../src/lib/writing/countChars';
import { parseGoal, goalProgress, formatProgress, loadGoal, saveGoal, GOAL_PREFIX } from '../../src/lib/writing/goal';
import { typewriterDelta, clampScrollTop } from '../../src/lib/writing/typewriter';

describe('countChars', () => {
  it('공백 포함/제외', () => {
    expect(countChars('안녕 하세요 세계', { spaces: true })).toBe(9);
    expect(countChars('안녕 하세요 세계', { spaces: false })).toBe(7);
  });
  it('줄바꿈은 세지 않는다', () => {
    expect(countChars('가나\n\n다라\r\n마', { spaces: true })).toBe(5);
  });
  it('이모지·서로게이트 페어는 1자', () => {
    expect(countChars('가😀나', { spaces: true })).toBe(3);
    expect(countChars('👨‍👩‍👧', { spaces: true })).toBe(1);
    expect(countChars('𠮷野家', { spaces: false })).toBe(3);
  });
  it('코드 블록 제외', () => {
    const md = '앞\n\n```js\nconst a = 1;\n```\n\n뒤';
    expect(countChars(md, { spaces: false })).toBe(2);
    expect(countChars('앞\n~~~\ncode\n~~~\n뒤', { spaces: false })).toBe(2);
    expect(countChars('앞\n```\n닫히지 않음', { spaces: false })).toBe(1);
  });
  it('이미지 제외, 링크는 글자만', () => {
    expect(countChars('![대체 텍스트](https://x.com/a.png)가나', { spaces: false })).toBe(2);
    expect(countChars('[링크글](https://example.com/very/long) 끝', { spaces: false })).toBe(4);
  });
  it('프론트매터·서식 기호 제외', () => {
    expect(countChars('---\ntitle: x\n---\n본문', { spaces: false })).toBe(2);
    expect(countChars('# 제목\n\n- **굵게** 글\n> 인용', { spaces: false })).toBe(8);
    expect(stripMarkdown('- [x] 할 일')).toBe('할 일');
  });
  it('빈 문자열', () => {
    expect(countChars('', { spaces: true })).toBe(0);
  });
  it('countText: 렌더된 선택 텍스트', () => {
    expect(countText('가 나\n다', { spaces: true })).toBe(4);
    expect(countText('가 나\n다', { spaces: false })).toBe(3);
  });
});

describe('목표 분량', () => {
  it('parseGoal', () => {
    expect(parseGoal('5,000')).toBe(5000);
    expect(parseGoal('')).toBeNull();
    expect(parseGoal('0')).toBeNull();
    expect(parseGoal('-3')).toBeNull();
    expect(parseGoal('abc')).toBeNull();
    expect(parseGoal(1200.9)).toBe(1200);
  });
  it('goalProgress', () => {
    expect(goalProgress(10, null)).toBeNull();
    expect(goalProgress(1234, 5000)).toEqual({ ratio: 0.2468, percent: 24, reached: false });
    expect(goalProgress(6000, 5000)).toEqual({ ratio: 1, percent: 120, reached: true });
    expect(goalProgress(0, 100)?.ratio).toBe(0);
  });
  it('formatProgress', () => {
    expect(formatProgress(1234, 5000)).toBe('1,234 / 5,000자');
  });
  it('localStorage 보관', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    saveGoal('a.md', 3000, store);
    expect(m.get(GOAL_PREFIX + 'a.md')).toBe('3000');
    expect(loadGoal('a.md', store)).toBe(3000);
    saveGoal('a.md', null, store);
    expect(loadGoal('a.md', store)).toBeNull();
  });
});

describe('타자기 스크롤', () => {
  it('중앙 근처면 움직이지 않는다', () => {
    expect(typewriterDelta({ caretTop: 290, caretBottom: 310, viewHeight: 600 })).toBe(0);
  });
  it('캐럿이 아래에 있으면 양수', () => {
    expect(typewriterDelta({ caretTop: 480, caretBottom: 500, viewHeight: 600 })).toBe(190);
  });
  it('캐럿이 위에 있으면 음수', () => {
    expect(typewriterDelta({ caretTop: 40, caretBottom: 60, viewHeight: 600 })).toBe(-250);
  });
  it('뷰 높이 0 이면 0', () => {
    expect(typewriterDelta({ caretTop: 10, caretBottom: 20, viewHeight: 0 })).toBe(0);
  });
  it('clampScrollTop', () => {
    expect(clampScrollTop(100, -500, 2000, 600)).toBe(0);
    expect(clampScrollTop(1300, 500, 2000, 600)).toBe(1400);
    expect(clampScrollTop(0, 10, 300, 600)).toBe(0);
  });
});
