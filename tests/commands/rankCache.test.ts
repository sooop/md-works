import { describe, it, expect } from 'vitest';
import { rankCommands, indexOf } from '../../src/lib/commands/rank';
import { matchName, matchPrepared, prepareQuery, prepareTarget } from '../../src/lib/search/nameMatch';
import type { Command } from '../../src/lib/commands/registry.svelte';

const mk = (id: string, title: string, group = '글'): Command => ({ id, title, group, run: () => {} });

describe('순위 계산 캐시', () => {
  it('같은 Command 는 정규화 색인을 재사용한다', () => {
    const c = mk('a', '회의록 정리');
    const first = indexOf(c);
    rankCommands([c], '회의');
    expect(indexOf(c)).toBe(first);
  });
  it('캐시를 거쳐도 순서·결과가 같다(시작 > 포함 > 그 밖)', () => {
    const list = [mk('1', '새 회의록'), mk('2', '회의록'), mk('3', '다른', '회의')];
    const first = rankCommands(list, '회의').map((c) => c.id);
    expect(first).toEqual(['2', '1', '3']);
    expect(rankCommands(list, '회의').map((c) => c.id)).toEqual(first);
    expect(rankCommands(list, 'ㅎㅇㄹ').map((c) => c.id)).toEqual(['1', '2']); // 초성은 시작 등급에 안 잡혀 원래 순서
  });
  it('matchPrepared 는 matchName 과 같은 답', () => {
    for (const [t, q] of [['회의록', 'ㅎㅇ'], ['Hello World', 'WORLD'], ['abc', 'abd'], ['abc', '']] as const) {
      expect(matchPrepared(prepareTarget(t), prepareQuery(q))).toBe(matchName(t, q));
    }
  });
});
