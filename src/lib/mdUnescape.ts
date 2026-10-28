// 다른 앱에서 복사하면서 마크다운 기호가 이스케이프된 글(`\# 제목\`, `\- 항목\`, `\| a \| b \|\`)을 되돌린다.
const BLOCK_START = /^\s*(\\?#{1,6}\s|\\?[-*+>]\s|\\?\d+\\?[.)]\s|\\?\||\\?`{3}|\\?~{3})/;

/** 줄머리에 이스케이프된 블록 기호(`\#` `\-` `\*` `\>` `\|` `1\.` …)가 있거나, 줄 대부분이 `\` 로 끝나면 이스케이프된 마크다운으로 본다 */
export function isEscapedMarkdown(text: string): boolean {
  const ls = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (ls.length < 2) return false;
  const escStart = ls.filter((l) => /^\s*(\\[#\-*+>|`~]|\d+\\[.)])/.test(l)).length;
  const endBs = ls.filter((l) => /\\\s*$/.test(l)).length;
  return escStart >= 1 && (escStart >= 2 || endBs >= ls.length / 2) || endBs >= Math.max(2, ls.length * 0.6) && ls.some((l) => BLOCK_START.test(l));
}

/** 이스케이프를 푼다: `\` + 기호 → 기호, 블록 줄 끝의 강제 줄바꿈 `\` 제거 */
export function unescapeMarkdown(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map((l) => {
    const un = l.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1');
    return BLOCK_START.test(l) ? un.replace(/\\\s*$/, '') : un;
  }).join('\n');
}
