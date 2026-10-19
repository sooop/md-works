// 번들 병합 규칙(순수 함수). 저장소·zip 을 모르고, 레코드 배열만 받아 무엇을 쓸지 계산한다.
//   글        : 이름이 같고 내용이 같으면 same, 로컬에 없으면 add, 다르면 updatedAt 비교(update / keep-local / conflict)
//   글감·스레드: id 가 같으면 updatedAt 큰 쪽(같으면 deletedAt 있는 쪽), 없는 id 는 추가, 로컬에만 있는 것은 유지
//   이력 버전  : id 합집합 뒤 솎아내기 규칙을 다시 돌린다
import type { DocAction } from './api';
import { thinVersions } from '../history/thinning';
import { compress } from '../history/compress';
import type { Version, WorksRecord } from '../works/types';

// ---- 글 ----
export interface DocSide { content: string; updatedAt?: number }
export type DocDecision = { action: DocAction; winner: 'local' | 'remote' | 'none' };

/**
 * 같은 이름의 글을 어떻게 병합할지.
 * 마지막 공통 기준 이후 양쪽이 모두 바뀌었는지는 알 수 없다. 그래서 한쪽의 updatedAt 이 '확실히' 클 때만(엄격히 큼) 그쪽을 최신으로 보고,
 * 같은 시각이거나 번들에 시각이 없으면 conflict 로 분류한다. conflict 에서는 로컬을 지키고 번들 쪽 내용을 이력에 남긴다.
 */
export function classifyDoc(local: DocSide | undefined, remote: DocSide): DocDecision {
  if (!local) return { action: 'add', winner: 'remote' };
  if (local.content === remote.content) return { action: 'same', winner: 'none' };
  const l = local.updatedAt;
  const r = remote.updatedAt;
  if (r !== undefined && l !== undefined && r > l) return { action: 'update', winner: 'remote' };
  if (r !== undefined && l !== undefined && r < l) return { action: 'keep-local', winner: 'local' };
  return { action: 'conflict', winner: 'local' };
}

// ---- 글감·스레드 ----
/** 번들 레코드가 로컬 레코드를 이기는가 */
export function remoteWins(local: WorksRecord, remote: WorksRecord): boolean {
  if (remote.updatedAt !== local.updatedAt) return remote.updatedAt > local.updatedAt;
  return !!remote.deletedAt && !local.deletedAt;
}

export interface RecordMerge<T> {
  add: T[];
  update: T[];
  /** 같아서 건드리지 않는 것 */
  same: number;
  /** 로컬이 더 최신이거나 로컬에만 있어 그대로 두는 것 */
  keepLocal: number;
}

/**
 * skipIds: 이 파티션이 아닌 다른 파티션에 이미 있는 id. 저장소가 id 를 전역 키로 쓰면(스탠드얼론 IndexedDB) 같은 id 를 쓰는 순간
 * 다른 글의 레코드를 덮어쓰므로(글 이름이 바뀐 뒤 옛 이름 번들을 가져올 때) 건너뛴다.
 */
export function mergeRecords<T extends WorksRecord>(local: T[], remote: T[], skipIds?: ReadonlySet<string>): RecordMerge<T> {
  const byId = new Map(local.map((r) => [r.id, r]));
  const out: RecordMerge<T> = { add: [], update: [], same: 0, keepLocal: 0 };
  const seen = new Set<string>();
  for (const r of remote) {
    if (seen.has(r.id)) continue; // 번들 안의 중복 id 는 첫 것만
    seen.add(r.id);
    const l = byId.get(r.id);
    if (!l && skipIds?.has(r.id)) { out.same++; continue; }
    if (!l) out.add.push(r);
    else if (remoteWins(l, r)) out.update.push(r);
    else if (remoteWins(r, l)) out.keepLocal++;
    else out.same++;
  }
  for (const l of local) if (!seen.has(l.id)) out.keepLocal++;
  return out;
}

// ---- 이력 버전 ----
export interface VersionMerge {
  /** 새로 쓸 버전(새 id + 더 최신인 같은 id). 솎아내기로 지워질 것은 빠져 있다 */
  put: Version[];
  /** 로컬 저장소에서 지울 버전 id (솎아내기 결과) */
  remove: string[];
  add: number;
  same: number;
}

/**
 * id 합집합. 같은 id 는 같은 내용이라 이름(고정)이 바뀐 경우처럼 updatedAt 이 더 큰 쪽만 취한다.
 * 합친 뒤 thinVersions 를 다시 돌려, 두 기기의 이력이 쌓여도 솎아내기 정책(이름 붙은 버전은 영구)이 유지된다.
 */
export function mergeVersions(local: Version[], remote: Version[], now: number, skipIds?: ReadonlySet<string>): VersionMerge {
  const byId = new Map(local.map((v) => [v.id, v]));
  const adds: Version[] = [];
  const updates: Version[] = [];
  const seen = new Set<string>();
  for (const r of remote) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const l = byId.get(r.id);
    if (!l && skipIds?.has(r.id)) continue;
    if (!l) { adds.push(r); byId.set(r.id, r); }
    else if (r.updatedAt > l.updatedAt) { updates.push(r); byId.set(r.id, r); }
  }
  const live = [...byId.values()].filter((v) => !v.deletedAt);
  const thinned = new Set(thinVersions(live.map((v) => ({ id: v.id, ts: v.ts, ...(v.name ? { name: v.name } : {}) })), now));
  const localIds = new Set(local.map((v) => v.id));
  const keptAdds = adds.filter((v) => !thinned.has(v.id));
  return {
    put: [...keptAdds, ...updates.filter((v) => !thinned.has(v.id))],
    remove: [...thinned].filter((id) => localIds.has(id)),
    add: keptAdds.length,
    same: seen.size - adds.length, // 건너뛴 id 도 '이미 있는 것'으로 센다
  };
}

// ---- '병합 전' 이력 버전 ----
const pad = (n: number) => String(n).padStart(2, '0');
export function preMergeName(now: number): string {
  const d = new Date(now);
  return `병합 전(${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())})`;
}

/** 문자열의 비암호 해시(cyrb53 두 개 → 26자 16진). 같은 내용·같은 글이면 같은 버전 id 가 되어 되풀이 가져오기가 버전을 늘리지 않는다 */
export function contentHash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57, g1 = 0x9e3779b9, g2 = 0x85ebca6b;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    g1 = Math.imul(g1 ^ c, 2246822519); g2 = Math.imul(g2 ^ c, 3266489917);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  g1 = Math.imul(g1 ^ (g1 >>> 16), 2246822507) ^ Math.imul(g2 ^ (g2 >>> 13), 3266489909);
  g2 = Math.imul(g2 ^ (g2 >>> 16), 2246822507) ^ Math.imul(g1 ^ (g1 >>> 13), 3266489909);
  return [h1, h2, g1, g2].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('').slice(0, 26);
}

/**
 * 병합에서 진 쪽 내용을 남기는 이력 버전. 이름이 붙어 있어 솎아내기에서 영구 보존된다.
 * docName 은 번들 이름(기기 사이에 같다), docKey 는 이 보관소의 파티션, ts 는 그 내용이 마지막으로 바뀐 시각(모르면 now).
 */
export function preMergeVersion(docName: string, docKey: string, content: string, ts: number | undefined, now: number): Version {
  return {
    id: `m${contentHash(`${docName}\0${content}`)}`, docKey, ts: ts ?? now, updatedAt: now,
    name: preMergeName(now), ...compress(content),
  };
}
