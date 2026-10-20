// 명령 검색: 공백으로 나눈 모든 낱말이 (분류 + 이름 + 별칭 + 단축키) 안에 있어야 한다. 한글 초성·대소문자 무시.
// 순서: 이름이 검색어로 시작 > 이름에 포함 > 그 밖(분류·별칭에서만 일치). 같은 등급이면 원래 순서를 지킨다.
import { matchName } from '../search/nameMatch';
import type { Command } from './registry.svelte';

// 공백을 뺀 형태도 같이 둔다: 초성은 '새 문서' 를 'ㅅㅁㅅ' 처럼 띄어쓰기 없이 입력하기 때문
const hay = (c: Command) => {
  const h = `${c.group} ${c.title} ${c.keywords ?? ''} ${c.shortcut ?? ''}`;
  return `${h} ${h.replace(/\s+/g, '')}`;
};

function grade(c: Command, terms: string[]): number {
  const title = c.title.toLowerCase();
  const q = terms.join(' ');
  if (title.startsWith(q)) return 0;
  const flat = c.title.replace(/\s+/g, '');
  if (terms.every((t) => matchName(c.title, t) || matchName(flat, t))) return title.includes(terms[0]) ? 1 : 2;
  return 3;
}

export function rankCommands(cmds: Command[], query: string): Command[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return cmds;
  return cmds
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => terms.every((t) => matchName(hay(c), t)))
    .sort((a, b) => grade(a.c, terms) - grade(b.c, terms) || a.i - b.i)
    .map(({ c }) => c);
}
