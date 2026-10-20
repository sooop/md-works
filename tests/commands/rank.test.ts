import { describe, it, expect } from 'vitest';
import { rankCommands } from '../../src/lib/commands/rank';
import type { Command } from '../../src/lib/commands/registry.svelte';

const mk = (id: string, title: string, group = '기타', extra: Partial<Command> = {}): Command => ({ id, title, group, run: () => {}, ...extra });
const list = [
  mk('a', '설정', '보기'),
  mk('b', '백업 · 가져오기', '파일', { keywords: 'backup' }),
  mk('c', '새 문서', '파일'),
  mk('d', '글자 크기 설정 열기', '보기'),
  mk('e', '굵게', '서식', { shortcut: 'Ctrl+B', keywords: 'bold' }),
];

describe('rankCommands', () => {
  it('빈 검색어는 전체를 그대로', () => expect(rankCommands(list, '  ').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']));
  it('이름이 검색어로 시작하는 것이 먼저, 포함은 그다음', () => {
    expect(rankCommands(list, '설정').map((c) => c.id)).toEqual(['a', 'd']);
  });
  it('초성으로 찾는다', () => expect(rankCommands(list, 'ㅅㅁㅅ').map((c) => c.id)).toEqual(['c']));
  it('별칭·분류·단축키로도 찾는다', () => {
    expect(rankCommands(list, 'backup').map((c) => c.id)).toEqual(['b']);
    expect(rankCommands(list, '서식').map((c) => c.id)).toEqual(['e']);
    expect(rankCommands(list, 'ctrl+b').map((c) => c.id)).toEqual(['e']);
  });
  it('여러 낱말은 모두 들어 있어야 한다', () => {
    expect(rankCommands(list, '파일 문서').map((c) => c.id)).toEqual(['c']);
    expect(rankCommands(list, '파일 굵게')).toEqual([]);
  });
});
