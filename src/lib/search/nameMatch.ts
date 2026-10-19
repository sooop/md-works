// 파일명 검색: 부분 문자열 + 한글 초성. 'ㅎㅇ' → '회의록', '회ㅇ' → '회의록'
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

function choseong(ch: string): string {
  const c = ch.charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3 ? CHO[Math.floor((c - 0xac00) / 588)] : '';
}

// 검색어 글자 하나가 대상 글자와 맞는지: 같은 글자(대소문자 무시)이거나, 초성 자모가 대상 글자의 초성과 같으면 일치
function same(q: string, t: string): boolean {
  if (q === t) return true;
  if (CHO.includes(q)) return choseong(t) === q || q === t;
  return false;
}

export function matchName(target: string, query: string): boolean {
  const q = [...query.trim().toLowerCase()];
  if (!q.length) return true;
  const t = [...target.toLowerCase()];
  for (let i = 0; i + q.length <= t.length; i++) {
    let ok = true;
    for (let j = 0; j < q.length; j++) {
      if (!same(q[j], t[i + j])) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// 트리에서 경로가 일치하거나 일치하는 하위 항목이 있는 노드만 남긴다
export function filterTree<T extends { path: string; type: 'file' | 'dir'; children?: T[] }>(
  nodes: T[],
  query: string,
): T[] {
  const out: T[] = [];
  for (const n of nodes) {
    const label = n.type === 'file' ? n.path.replace(/\.md$/i, '') : n.path;
    if (n.type === 'file') {
      if (matchName(label, query)) out.push(n);
    } else {
      const kids = filterTree(n.children ?? [], query);
      if (kids.length) out.push({ ...n, children: kids });
      else if (matchName(label, query)) out.push({ ...n, children: [] });
    }
  }
  return out;
}
