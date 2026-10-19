import { describe, it, expect } from 'vitest';
import { bodyLines } from '../../src/lib/snippets/filter';

describe('글감 카드 줄 렌더(인용·목록)', () => {
  it('인용과 목록 기호를 떼고 종류를 붙인다', () => {
    expect(bodyLines('> 인용\n- 항목\n* 별표\n본문')).toEqual([
      { kind: 'quote', text: '인용' },
      { kind: 'li', text: '항목' },
      { kind: 'li', text: '별표' },
      { kind: 'p', text: '본문' },
    ]);
  });
  it('기호 뒤 공백 없는 >, 단독 - 는 목록으로 보지 않는다', () => {
    expect(bodyLines('>붙여쓴')[0]).toEqual({ kind: 'quote', text: '붙여쓴' });
    expect(bodyLines('-하이픈')[0].kind).toBe('p');
    expect(bodyLines('a - b')[0].kind).toBe('p');
  });
  it('빈 줄은 유지하고 끝 개행 하나는 줄로 세지 않는다', () => {
    expect(bodyLines('가\n\n나\n').map((l) => l.text)).toEqual(['가', '', '나']);
    expect(bodyLines('')).toEqual([{ kind: 'p', text: '' }]);
  });
  it('HTML 은 해석하지 않고 문자열 그대로 둔다', () => {
    expect(bodyLines('> <b>x</b>')[0].text).toBe('<b>x</b>');
  });
});
