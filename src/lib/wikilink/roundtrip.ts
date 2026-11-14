// 저장 왕복: Milkdown(remark-stringify)은 본문 글자 `[[글 이름]]` 을 `\[\[글 이름]]` 로, 안의 `*` 는 `\*` 로 이스케이프해 내보낸다.
// 문서 모델은 `[[…]]` 를 일반 글자로 두므로, 직렬화한 마크다운에서 링크 모양의 이스케이프만 되돌려 .md 에 글자 그대로 남긴다.
// 읽을 때는 되돌릴 것이 없다: `[[글]]` 은 정의가 없으면 참조 링크(`[a][b]`)가 아니라 그냥 글자로 읽힌다(tests/wikilink/roundtrip.test.ts).
// 알려진 한계: 같은 글에 `[글]: 주소` 정의가 있으면 `[[글]]` 의 안쪽 `[글]` 이 참조 링크로 읽힌다(마크다운 문법상 모호).
import { maskCode, MASK } from './parse';

// `\[\[` 로 시작해 `]]` 로 끝나고, 안에 대괄호·줄바꿈이 없는 것. 안의 `\x` 는 이스케이프로 본다
const ESCAPED = new RegExp(String.raw`\\\[\\\[((?:\\[^\n]|[^\\\n\[\]${MASK}])+?)\]\]`, 'g');
// 되돌릴 이스케이프: `|` 는 표 셀 안에서 구분자와 구별하려고 `\|` 로 둔 것이므로 그대로 둔다(읽을 때 표가 풀어 준다)
const UNESCAPE = /\\([\\`*_{}()#+\-.!<>~&])/g;

/** 직렬화한 마크다운에서 `\[\[…]]` 를 `[[…]]` 로 되돌린다. 코드 블록·인라인 코드 안은 건드리지 않는다 */
export function restoreWikiLinks(md: string): string {
  if (!md.includes('\\[\\[')) return md;
  const masked = maskCode(md);
  let out = '';
  let last = 0;
  for (const m of masked.matchAll(ESCAPED)) {
    const from = m.index!;
    const to = from + m[0].length;
    out += md.slice(last, from) + '[[' + md.slice(from + 4, to - 2).replace(UNESCAPE, '$1') + ']]'; // 안쪽 글자는 가리기 전 원문에서 읽는다
    last = to;
  }
  return last ? out + md.slice(last) : md;
}
