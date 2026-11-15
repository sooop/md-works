// 트리 갱신 때 '이름만 바뀐 항목' 찾기. 직전 트리와 견줘 같은 자리(부모·종류·내용 서명이 같다)에서
// 사라진 것 하나와 나타난 것 하나가 짝이 되면 이름 바꾸기로 본다. parent+type+sig 키로 묶어 선형 시간에 맞춘다.
export interface TreeInfo { type: 'file' | 'dir'; parent: string; sig: string }

const keyOf = (i: TreeInfo) => `${i.type}\u0000${i.parent}\u0000${i.sig}`;

/** 이름 바꾸기로 판정된 옛·새 경로와 그 하위 경로 전부 */
export function renamedPaths(prev: Map<string, TreeInfo>, cur: Map<string, TreeInfo>): Set<string> {
  const goneBy = new Map<string, string[]>();
  const freshBy = new Map<string, string[]>();
  for (const [p, i] of prev) if (!cur.has(p)) { const k = keyOf(i); (goneBy.get(k) ?? goneBy.set(k, []).get(k)!).push(p); }
  for (const [p, i] of cur) if (!prev.has(p)) { const k = keyOf(i); (freshBy.get(k) ?? freshBy.set(k, []).get(k)!).push(p); }
  const quiet = new Set<string>();
  const oldRoots = new Set<string>(), newRoots = new Set<string>();
  for (const [k, gone] of goneBy) {
    const twins = freshBy.get(k);
    if (gone.length !== 1 || !twins || twins.length !== 1) continue; // 짝이 하나로 정해질 때만
    oldRoots.add(gone[0]); newRoots.add(twins[0]);
  }
  if (!oldRoots.size) return quiet;
  const mark = (paths: Iterable<string>, roots: Set<string>) => {
    for (const p of paths) {
      if (roots.has(p)) { quiet.add(p); continue; }
      for (let at = p.indexOf('/'); at >= 0; at = p.indexOf('/', at + 1)) {
        if (roots.has(p.slice(0, at))) { quiet.add(p); break; }
      }
    }
  };
  mark(prev.keys(), oldRoots);
  mark(cur.keys(), newRoots);
  return quiet;
}
