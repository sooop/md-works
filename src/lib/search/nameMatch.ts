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

/** 검색어(공백으로 나눈 단어마다)가 target 에서 처음 일치하는 구간 [시작, 끝) 들. 겹치면 합친다(하이라이트용, 초성 가능) */
export function matchRanges(target: string, query: string): [number, number][] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const orig = [...target];
  const low = orig.map((c) => c.toLowerCase());
  const offs: number[] = [];
  let o = 0;
  for (const c of orig) { offs.push(o); o += c.length; }
  const found: [number, number][] = [];
  for (const term of terms) {
    const q = [...term];
    for (let i = 0; i + q.length <= low.length; i++) {
      if (q.every((ch, j) => same(ch, low[i + j]))) {
        found.push([offs[i], offs[i + q.length - 1] + orig[i + q.length - 1].length]);
        break;
      }
    }
  }
  found.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of found) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
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

/** 일치 구간을 표시한 조각들(하이라이트용): 일치가 없으면 통째로 한 조각 */
export function highlight(text: string, query: string): { t: string; hit: boolean }[] {
  const out: { t: string; hit: boolean }[] = [];
  let pos = 0;
  for (const [a, b] of matchRanges(text, query)) {
    if (a > pos) out.push({ t: text.slice(pos, a), hit: false });
    out.push({ t: text.slice(a, b), hit: true });
    pos = b;
  }
  if (pos < text.length || !out.length) out.push({ t: text.slice(pos), hit: false });
  return out;
}
