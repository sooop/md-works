// 글 이름 변경·이동 뒤, 그 글을 가리키던 다른 글의 `[[…]]` 를 새 이름으로 고쳐 저장한다.
// 각 모드의 이름 변경 함수 끝에서 updateLinksAfterMove(notify.ts)를 한 줄 부른다. 가리키는 글이 없으면 아무것도 저장하지 않는다.
import type { LinkHost } from './host';
import { docPath, norm, renameWikiLinks } from './parse';

export interface LinkMove { from: string; to: string }
export interface FixResult { docs: number; links: number; failed: number }

/** 글(또는 폴더 아래 모든 글)의 옛 경로 → 새 경로. from 은 옮기기 전 경로, to 는 옮긴 뒤 경로(글이면 같은 글, 폴더면 접두어) */
export const movePairs = (paths: string[], from: string, to: string): LinkMove[] =>
  paths.filter((p) => /\.md$/i.test(p)).map((p) => ({ from: p, to: to + p.slice(from.length) }));

const same = (a: string, b: string) => norm(a) === norm(b);

/**
 * moves 로 글이 옮겨진 뒤의 상태(host.docs())에서, 옛 경로를 가리키던 링크를 모든 글에서 고친다.
 * 한 글에 여러 이동이 걸리면(폴더 이름 변경) 이동을 차례로 적용하고, 단계마다 '그 단계까지 적용된 글 목록'으로 이름형/경로형을 고른다.
 */
export async function fixLinksAfterMove(host: LinkHost, moves: LinkMove[]): Promise<FixResult> {
  const out: FixResult = { docs: 0, links: 0, failed: 0 };
  const mv = moves.map((m) => ({ from: docPath(m.from), to: docPath(m.to) })).filter((m) => !same(m.from, m.to));
  if (!mv.length) return out;
  const docs = host.docs();
  // k 단계 직후의 글 목록: 뒤 단계의 새 경로는 아직 옛 경로다
  const stepDocs = mv.map((_, k) => docs.map((d) => {
    const later = mv.slice(k + 1).find((m) => same(m.to, d.path));
    return { path: later ? later.from : d.path };
  }));
  const cand = await host.candidates?.();
  const pick = cand ? new Set(cand) : null;
  for (const d of docs) {
    if (pick && !pick.has(d.key)) continue;
    const text = await host.read(d.key);
    if (!text || !text.includes('[[')) continue;
    let next = text;
    let n = 0;
    for (let k = 0; k < mv.length; k++) {
      const r = renameWikiLinks(next, mv[k].from, mv[k].to, stepDocs[k]);
      next = r.text;
      n += r.count;
    }
    if (!n) continue;
    if (await host.write(d.key, next)) { out.docs++; out.links += n; } else out.failed++;
  }
  return out;
}
