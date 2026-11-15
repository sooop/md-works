// 바꾸기의 순수 로직: 바꿀 말의 캡처 참조 풀이(문서 안 바꾸기가 쓴다)와 마크다운 원문 치환(전체 바꾸기가 쓴다).
import { buildMatcher, type SearchOpts } from '../../../server/searchCore.js';

type MatchLike = RegExpMatchArray;

// 정규식 모드의 바꿀 말: String.prototype.replace 와 같은 규칙($$, $&, $`, $', $n, $nn, $<이름>)을 일치 하나에 적용한다.
export function expandReplacement(template: string, m: MatchLike): string {
  if (!template.includes('$')) return template;
  const index = m.index ?? 0;
  const input = m.input ?? m[0];
  const groups = m.length - 1;
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (c !== '$' || i === template.length - 1) { out += c; continue; }
    const n = template[i + 1];
    if (n === '$') { out += '$'; i++; }
    else if (n === '&') { out += m[0]; i++; }
    else if (n === '`') { out += input.slice(0, index); i++; }
    else if (n === "'") { out += input.slice(index + m[0].length); i++; }
    else if (n >= '0' && n <= '9') {
      const two = template.slice(i + 1, i + 3);
      if (/^\d\d$/.test(two) && +two >= 1 && +two <= groups) { out += m[+two] ?? ''; i += 2; }
      else if (+n >= 1 && +n <= groups) { out += m[+n] ?? ''; i++; }
      else out += c; // 없는 그룹 번호는 글자 그대로
    } else if (n === '<' && m.groups) {
      const end = template.indexOf('>', i + 2);
      if (end < 0) { out += c; continue; }
      out += m.groups[template.slice(i + 2, end)] ?? '';
      i = end;
    } else out += c;
  }
  return out;
}

// 일치 하나의 대체 문자열: 정규식 모드면 캡처 참조를 풀고, 아니면 글자 그대로(`$` 해석 없음)
export const replacementFor = (template: string, m: MatchLike, regex: boolean): string => (regex ? expandReplacement(template, m) : template);

// 전체 검색(searchCore.searchText)과 같게 이미지 데이터는 찾지 않는다: 같은 길이의 공백으로 가려 찾고, 바꿀 때는 원문 위치를 쓴다
const MASK = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]*|idb:[0-9a-f-]{36}/gi;
const mask = (line: string) => (line.includes('data:image/') || line.includes('idb:') ? line.replace(MASK, (s) => ' '.repeat(s.length)) : line);

// 줄 번호 → 바꾸지 않을 줄인가. YAML 프런트매터(맨 앞 --- … --- 또는 ...)와 펜스 코드 블록(``` / ~~~)을 건너뛴다.
export function protectedLines(lines: string[]): boolean[] {
  const skip = new Array<boolean>(lines.length).fill(false);
  let i = 0;
  if (lines.length && lines[0].replace(/^﻿/, '').trimEnd() === '---') {
    let end = -1;
    for (let j = 1; j < lines.length; j++) if (/^(---|\.\.\.)\s*$/.test(lines[j])) { end = j; break; }
    if (end > 0) { for (let j = 0; j <= end; j++) skip[j] = true; i = end + 1; }
  }
  for (; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!open || (open[1][0] === '`' && open[2].includes('`'))) continue;
    const ch = open[1][0];
    const len = open[1].length;
    const close = new RegExp(`^ {0,3}\\${ch}{${len},}\\s*$`);
    skip[i] = true;
    for (i++; i < lines.length; i++) {
      skip[i] = true;
      if (close.test(lines[i])) break;
    }
  }
  return skip;
}

export interface ReplaceResult { text: string; count: number; error?: string }

// 마크다운 원문 텍스트에서 줄 단위로 찾아 바꾼다(서버 검색과 같은 의미). 빈 일치는 세지도 바꾸지도 않는다.
export function replaceInMarkdown(text: string, query: string, opts: SearchOpts, replacement: string): ReplaceResult {
  const m = buildMatcher(query, opts);
  if (m.error !== undefined) return { text, count: 0, error: m.error };
  // 줄바꿈(\r\n 포함)은 그대로 보존한다: [줄, 줄바꿈, 줄, …]
  const parts = text.split(/(\r?\n)/);
  const lines = parts.filter((_, k) => k % 2 === 0);
  const skip = protectedLines(lines);
  let count = 0;
  for (let n = 0; n < lines.length; n++) {
    if (skip[n]) continue;
    const orig = lines[n];
    const seen = mask(orig);
    let out = '';
    let pos = 0;
    for (const r of seen.matchAll(m.re!)) {
      if (!r[0]) continue;
      out += orig.slice(pos, r.index) + replacementFor(replacement, r, !!opts.regex);
      pos = r.index! + r[0].length;
      count++;
    }
    if (pos) lines[n] = out + orig.slice(pos);
  }
  if (!count) return { text, count: 0 };
  return { text: lines.map((l, k) => (k ? parts[2 * k - 1] + l : l)).join(''), count };
}
