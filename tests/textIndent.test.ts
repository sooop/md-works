import { describe, it, expect } from 'vitest';
import { indentEdit, newlineEdit, type TextEdit } from '../src/lib/textIndent';

/** 편집을 문자열에 적용하고 선택 범위를 | 로 표시한다 */
function run(text: string, fn: (v: string, s: number, e: number) => TextEdit | null): string | null {
  const s = text.indexOf('|'), e0 = text.lastIndexOf('|');
  const value = text.replaceAll('|', '');
  const e = e0 === s ? s : e0 - 1;
  const ed = fn(value, s, e);
  if (!ed) return null;
  const out = value.slice(0, ed.from) + ed.insert + value.slice(ed.to);
  return ed.start === ed.end
    ? out.slice(0, ed.start) + '|' + out.slice(ed.start)
    : out.slice(0, ed.start) + '|' + out.slice(ed.start, ed.end) + '|' + out.slice(ed.end);
}
const tab = (t: string) => run(t, (v, s, e) => indentEdit(v, s, e));
const untab = (t: string) => run(t, (v, s, e) => indentEdit(v, s, e, true));
const enter = (t: string) => run(t, newlineEdit);

describe('Tab 들여쓰기', () => {
  it('일반 줄에서는 커서 자리에 공백 2칸을 넣는다', () => {
    expect(tab('가|나')).toBe('가  |나');
    expect(tab('|')).toBe('  |');
  });
  it('목록 줄에서는 줄 전체를 들여쓰고 커서는 같은 글자 옆에 남는다', () => {
    expect(tab('- 항|목')).toBe('  - 항|목');
    expect(tab('위\n1. 하|나')).toBe('위\n  1. 하|나');
  });
  it('선택이 걸친 줄을 모두 들여쓰고 빈 줄은 건너뛴다', () => {
    expect(tab('a|b\n\ncd|e')).toBe('  a|b\n\n  cd|e');
  });
  it('선택이 다음 줄 맨 앞에서 끝나면 그 줄은 들여쓰지 않는다', () => {
    expect(tab('|ab\n|cd')).toBe('  |ab\n|cd');
  });
  it('한 줄 안의 선택은 지우지 않고 줄을 들여쓴다', () => {
    expect(tab('a|bc|d')).toBe('  a|bc|d');
  });
});

describe('Shift+Tab 내어쓰기', () => {
  it('공백 2칸·1칸·탭 하나를 뗀다', () => {
    expect(untab('    가|')).toBe('  가|');
    expect(untab(' 가|')).toBe('가|');
    expect(untab('\t가|')).toBe('가|');
  });
  it('뗄 것이 없으면 아무것도 하지 않는다', () => {
    expect(untab('가|나')).toBeNull();
  });
  it('커서가 들여쓰기 안에 있어도 줄 시작 앞으로 넘어가지 않는다', () => {
    expect(untab('앞\n |  가')).toBe('앞\n| 가');
  });
  it('여러 줄을 함께 내어쓴다', () => {
    expect(untab('  a|b\n  c|d')).toBe('a|b\nc|d');
  });
});

describe('줄바꿈 때 이어받기', () => {
  it('들여쓰기를 다음 줄로 이어받는다', () => {
    expect(enter('  가나|')).toBe('  가나\n  |');
  });
  it('목록 기호를 이어받고 번호는 하나 올린다', () => {
    expect(enter('- 하나|')).toBe('- 하나\n- |');
    expect(enter('  2. 둘|')).toBe('  2. 둘\n  3. |');
  });
  it('빈 목록 항목에서는 기호를 지워 목록을 끝낸다', () => {
    expect(enter('- 하나\n- |')).toBe('- 하나\n|');
  });
  it('이어받을 것이 없으면 기본 줄바꿈에 맡긴다', () => {
    expect(enter('가나|')).toBeNull();
    expect(enter('a - b|')).toBeNull();
  });
  it('줄 가운데에서 나누면 뒷부분이 새 항목이 된다', () => {
    expect(enter('- 앞|뒤')).toBe('- 앞\n- |뒤');
  });
});
