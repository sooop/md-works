// 글감 본문의 '스마트 마커' 해석(순수 함수). 본문은 입력한 그대로 저장하고, 카드를 그릴 때만 해석한다.
//   `# 제목`            글감 제목(처음 나온 한 줄)
//   `@출처 https://…`    원전. URL 만, 글자만, 둘 다 가능
//   줄 전체가 URL        원전 링크(@ 없이도)
// 같은 마커가 여럿이면 처음 것만 인정하고 나머지는 본문 글자로 둔다(원전은 @ 줄과 URL 줄을 합쳐 하나).
//   `> 인용`            발췌 — 따로 해석하지 않고 본문에서 인용 모양으로 보인다
import type { Snippet } from '../works/types';

export interface ParsedSource { label: string; url: string }
export interface ParsedSnippet { title: string; source: ParsedSource | null; rest: string }

const URL_RE = /https?:\/\/[^\s<>"]+/i;
const URL_LINE = /^https?:\/\/\S+$/i;
const TRAIL = /[.,;:!?)\]}'"]+$/;

function parseSource(text: string): ParsedSource {
  const m = URL_RE.exec(text);
  if (!m) return { label: text, url: '' };
  const url = m[0].replace(TRAIL, '');
  const label = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  return { label, url };
}

export function parseSnippet(body: string): ParsedSnippet {
  let title = '';
  let source: ParsedSource | null = null;
  const rest: string[] = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!title && /^#\s+\S/.test(t)) { title = t.replace(/^#\s+/, '').trim(); continue; }
    if (!source && /^@\s*\S/.test(t)) { source = parseSource(t.replace(/^@\s*/, '')); continue; }
    if (!source && URL_LINE.test(t)) { source = { label: '', url: t.replace(TRAIL, '') }; continue; }
    rest.push(line);
  }
  return { title, source, rest: rest.join('\n').replace(/^\s*\n+/, '').replace(/\s+$/, '') };
}

/** 수정 화면에 보일 글: 옛 글감의 원전 필드(source)는 마커 줄로 풀어 본문 위에 놓는다(저장하면 새 방식으로 바뀐다) */
export function editableText(s: Pick<Snippet, 'body' | 'source'>): string {
  const src = s.source;
  if (!src) return s.body;
  const head: string[] = [];
  if (src.excerpt) head.push(...src.excerpt.split('\n').map((l) => `> ${l}`));
  const at = [src.title, src.url].filter(Boolean).join(' ');
  if (at) head.push(`@${at}`);
  return head.length ? `${head.join('\n')}\n\n${s.body}` : s.body;
}
