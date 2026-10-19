// 문서별 버전 이력(v2): worksStore() 의 'versions' 컬렉션(파티션 = docKey)에 압축해서 보관한다.
// 스탠드얼론은 IndexedDB, 서버 모드는 노트 폴더의 `.works/` 사이드카가 정본이라 이력도 폴더와 함께 기기를 옮겨 다닌다.
// 스탠드얼론은 문서 id, 서버 모드는 루트 기준 파일 경로를 docKey 로 쓴다.
import { worksStore } from './works/store';
import { newId, type Version as StoredVersion } from './works/types';
import { compress, decompress } from './history/compress';
import { thinVersions } from './history/thinning';

export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

/** 호출처에는 항상 복원된 평문 content 로 돌려준다(enc 는 'raw') */
export type Version = StoredVersion;

const COLL = 'versions';

function plain(v: StoredVersion): Version | undefined {
  try { return { ...v, content: decompress(v.content, v.enc), enc: 'raw' }; } catch { return undefined; /* 깨진 레코드는 건너뜀 */ }
}

// 최신순 목록
export async function listVersions(docKey: string): Promise<Version[]> {
  const list = await worksStore().list<StoredVersion>(COLL, docKey);
  return list.filter((v) => !v.deletedAt).sort((a, b) => b.ts - a.ts).map(plain).filter((v): v is Version => !!v);
}

// 현재 내용을 버전으로 남긴다. 내용이 직전 버전과 같으면 건너뛰고,
// force 가 아니면 직전 버전 이후 SNAPSHOT_INTERVAL_MS 가 지나야 남긴다. 남긴 뒤에는 솎아내기 정책으로 오래된 것을 정리한다.
export async function snapshot(docKey: string, content: string, force = false): Promise<void> {
  if (!docKey || !content.trim()) return;
  const store = worksStore();
  const list = (await store.list<StoredVersion>(COLL, docKey)).filter((v) => !v.deletedAt);
  const latest = list.reduce<StoredVersion | undefined>((a, b) => (!a || b.ts > a.ts ? b : a), undefined);
  const now = Date.now();
  if (latest) {
    if (!force && now - latest.ts < SNAPSHOT_INTERVAL_MS) return;
    if (plain(latest)?.content === content) return;
  }
  const rec: StoredVersion = { id: newId(), docKey, ts: now, updatedAt: now, ...compress(content) };
  await store.put(COLL, rec, docKey);
  for (const id of thinVersions([...list, rec], now)) await store.remove(COLL, id, docKey);
}

/** 버전에 이름을 붙인다(고정). name 이 비면 해제한다. */
export async function setVersionName(docKey: string, id: string, name: string | undefined): Promise<void> {
  const store = worksStore();
  const v = await store.get<StoredVersion>(COLL, id, docKey);
  if (!v) return;
  const next: StoredVersion = { ...v, updatedAt: Date.now() };
  const n = name?.trim();
  if (n) next.name = n; else delete next.name;
  await store.put(COLL, next, docKey);
}

// key 자신과 그 아래 경로(`key/…`)의 이력을 대상으로 한다 (서버 모드의 폴더 이동/삭제)
const under = (docKey: string, key: string) => docKey === key || docKey.startsWith(key + '/');
const partsUnder = async (key: string) => (await worksStore().parts(COLL)).filter((p) => under(p, key));

export async function removeHistory(key: string): Promise<void> {
  for (const p of await partsUnder(key)) await worksStore().removePart(COLL, p);
}

// 이름·경로가 바뀌면 이력의 파티션도 따라 옮긴다.
// 서버 모드는 서버 API 가 이미 사이드카 파티션을 옮기므로 여기서는 옮길 것이 없어 무해하게 끝난다.
export async function moveHistory(from: string, to: string): Promise<void> {
  if (from === to) return;
  for (const p of await partsUnder(from)) await worksStore().movePart(COLL, p, to + p.slice(from.length));
}

// 이미지 정리가 이력이 참조하는 이미지를 남기도록 모든 버전의 평문 본문을 돌려준다
export async function allContents(): Promise<string[]> {
  const store = worksStore();
  const out: string[] = [];
  for (const p of await store.parts(COLL)) {
    for (const v of await store.list<StoredVersion>(COLL, p)) {
      const pv = plain(v);
      if (pv) out.push(pv.content);
    }
  }
  return out;
}
