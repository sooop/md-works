// YAML frontmatter(`---` … `---`) 분리·재결합. 마크다운 파서는 이를 가로줄 + 제목(setext h2)으로 읽고 저장할 때 형태를 바꿔 버리므로,
// 에디터에는 본문만 넘기고 frontmatter 는 원문 그대로 따로 들고 있다가 저장 시 다시 앞에 붙인다.
const FM = /^(﻿?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*)(?:\r?\n|$)/;

export function splitFrontmatter(md: string): { front: string; body: string } {
  const m = FM.exec(md);
  if (!m) return { front: '', body: md };
  return { front: m[1], body: md.slice(m[0].length).replace(/^(?:[ \t]*\r?\n)+/, '') };
}

export function joinFrontmatter(front: string, body: string): string {
  if (!front) return body;
  return body ? `${front}\n\n${body}` : `${front}\n`;
}

/** 편집용 텍스트(앞뒤 `---` 줄 제외) ↔ 원문 */
export const frontInner = (front: string): string =>
  front.replace(/^﻿?---[ \t]*\r?\n/, '').replace(/(?:^|\r?\n)(?:---|\.\.\.)[ \t]*$/, '');
export const frontOuter = (inner: string): string => (inner.trim() ? `---\n${inner.replace(/\s+$/, '')}\n---` : '');
