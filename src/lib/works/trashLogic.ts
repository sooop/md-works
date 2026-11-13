// 스탠드얼론 문서 휴지통의 순수 로직(저장소와 무관): 휴지통 항목 만들기, 복구할 이름 정하기, 30일 지난 항목 고르기.
// 글은 지우지 않고 레코드에 deletedAt 을 표시한다. 폴더를 지우면 안의 글이 같은 묶음 id(trashId)를 갖고,
// 폴더 자체(빈 폴더 포함)는 kv 'trashDirs' 의 TrashDir 로 기억한다.
import { fullPath, splitPath, withParents } from '../docTree';
import type { TrashItem } from '../trash';
import type { DocRec } from './docDb';

/** 휴지통에 든 폴더 하나: 폴더 경로와 그 아래의(빈 폴더 포함) 폴더 목록 */
export interface TrashDir { path: string; folders: string[]; deletedAt: number }
export type TrashDirs = Record<string, TrashDir>;

export const isTrashed = (r: Pick<DocRec, 'deletedAt'>): boolean => typeof r.deletedAt === 'number';
/** 휴지통에 없는 글만 */
export const liveDocs = <T extends Pick<DocRec, 'deletedAt'>>(recs: Iterable<T>): T[] => [...recs].filter((r) => !isTrashed(r));

/** 레코드에서 휴지통 표시를 걷어 낸다 */
export function untrashed(r: DocRec): DocRec {
  const { deletedAt: _d, trashId: _t, ...rest } = r;
  void _d; void _t;
  return rest;
}

export const folderOf = (r: Pick<DocRec, 'folder'>): string => r.folder ?? '';
export const inFolder = (r: Pick<DocRec, 'folder'>, path: string): boolean => folderOf(r) === path || folderOf(r).startsWith(`${path}/`);
export const remap = (p: string, from: string, to: string): string => (p === from || p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);

/** kv 에서 읽은 값을 TrashDirs 로 다듬는다(깨진 항목은 버린다) */
export function sanitizeDirs(v: unknown): TrashDirs {
  const out: TrashDirs = {};
  if (!v || typeof v !== 'object') return out;
  for (const [id, d] of Object.entries(v as Record<string, unknown>)) {
    const o = d as Partial<TrashDir> | null;
    if (!o || typeof o.path !== 'string' || !o.path || typeof o.deletedAt !== 'number') continue;
    out[id] = { path: o.path, deletedAt: o.deletedAt, folders: Array.isArray(o.folders) ? o.folders.filter((f): f is string => typeof f === 'string' && !!f) : [] };
  }
  return out;
}

/** 휴지통 목록: 폴더 묶음은 한 항목, 나머지는 글 하나가 한 항목. 최근 삭제 먼저 */
export function trashItems(recs: Iterable<DocRec>, dirs: TrashDirs): TrashItem[] {
  const out: TrashItem[] = [];
  const count = new Map<string, number>();
  for (const r of recs) {
    if (!isTrashed(r)) continue;
    if (r.trashId && dirs[r.trashId]) { count.set(r.trashId, (count.get(r.trashId) ?? 0) + 1); continue; }
    out.push({ id: r.id, path: fullPath(folderOf(r), r.name), name: r.name, type: 'file', deletedAt: r.deletedAt!, docs: 1 });
  }
  for (const [id, d] of Object.entries(dirs)) out.push({ id, path: d.path, name: splitPath(d.path).name, type: 'dir', deletedAt: d.deletedAt, docs: count.get(id) ?? 0 });
  return out.sort((a, b) => b.deletedAt - a.deletedAt || a.path.localeCompare(b.path, 'ko'));
}

/** 폴더 목록(빈 폴더 포함)과 글에서 알 수 있는 모든 폴더 경로(상위 폴더 포함) */
export function foldersOf(folders: Iterable<string>, live: Iterable<DocRec>): Set<string> {
  const out = new Set<string>();
  for (const f of folders) for (const p of withParents(f)) out.add(p);
  for (const r of live) for (const p of withParents(folderOf(r))) out.add(p);
  return out;
}

/** 그 폴더 바로 아래의 하위 폴더 이름(소문자) */
function subFolderNames(folder: string, all: Set<string>): Set<string> {
  return new Set([...all].filter((f) => splitPath(f).folder === folder).map((f) => splitPath(f).name.toLowerCase()));
}

/**
 * 글을 복구할 이름: 같은 폴더에 같은 이름의 글·폴더가 있으면 '이름 (2).md'(기존 uniqueName 규칙).
 * live: 지금 있는 글, folders: 지금 있는 모든 폴더 경로
 */
export function restoreName(name: string, folder: string, live: Iterable<DocRec>, folders: Set<string>): string {
  const names = new Set([...live].filter((r) => folderOf(r) === folder).map((r) => r.name.toLowerCase()));
  for (const n of subFolderNames(folder, folders)) names.add(n);
  const stem = name.replace(/\.md$/i, '');
  for (let i = 1; ; i++) {
    const cand = i === 1 ? `${stem}.md` : `${stem} (${i}).md`;
    if (!names.has(cand.toLowerCase())) return cand;
  }
}

/** 폴더를 복구할 경로: 같은 이름의 폴더·글이 있으면 '폴더 (2)'(서버 휴지통과 같은 규칙) */
export function restoreFolderPath(path: string, live: Iterable<DocRec>, folders: Set<string>): string {
  const { folder: parent, name } = splitPath(path);
  const taken = new Set([...folders].map((f) => f.toLowerCase()));
  const docNames = new Set([...live].filter((r) => folderOf(r) === parent).map((r) => r.name.toLowerCase()));
  for (let i = 1; ; i++) {
    const leaf = i === 1 ? name : `${name} (${i})`;
    if (!taken.has(fullPath(parent, leaf).toLowerCase()) && !docNames.has(leaf.toLowerCase())) return fullPath(parent, leaf);
  }
}

/** 보관 기간(maxAge)이 지난 항목의 id */
export function expiredIds(recs: Iterable<DocRec>, dirs: TrashDirs, now: number, maxAge: number): string[] {
  return trashItems(recs, dirs).filter((i) => now - i.deletedAt >= maxAge).map((i) => i.id);
}
