// 읽기 전용 '코멘트' 절 DOM: 화면(읽기 모드 코멘트 보기)과 인쇄 사본이 같은 함수를 쓴다.
// 사용자 글은 모두 textContent 로만 넣는다(HTML 주입 없음). 저장되는 문서·마크다운과는 무관하다.
import type { CommentRow } from './numbering';

export function buildCommentSection(rows: readonly CommentRow[]): HTMLElement | null {
  if (!rows.length) return null;
  const sec = document.createElement('section');
  sec.className = 'cm-readsec';
  sec.setAttribute('aria-label', '코멘트');
  const h = document.createElement('h2');
  h.className = 'cm-readsec-title';
  h.textContent = '코멘트';
  sec.append(h);
  for (const r of rows) {
    const art = document.createElement('article');
    art.className = 'cm-readitem' + (r.resolved ? ' cm-resolved' : '') + (r.n === null ? ' cm-lostitem' : '');
    const head = document.createElement('div');
    head.className = 'cm-readhead';
    const badge = document.createElement('span');
    badge.className = 'cm-badge';
    badge.textContent = r.n === null ? '위치 잃음' : `C${r.n}`;
    head.append(badge);
    if (r.resolved) {
      const tag = document.createElement('span');
      tag.className = 'cm-readtag';
      tag.textContent = '해결됨';
      head.append(tag);
    }
    art.append(head);
    if (r.quote) {
      const q = document.createElement('blockquote');
      q.className = 'cm-readquote';
      q.textContent = r.quote;
      art.append(q);
    }
    const t = document.createElement('p');
    t.className = 'cm-readtext';
    t.textContent = r.text;
    art.append(t);
    for (const reply of r.replies) {
      const p = document.createElement('p');
      p.className = 'cm-readreply';
      p.textContent = reply;
      art.append(p);
    }
    sec.append(art);
  }
  return sec;
}
