// 글감·이력·스레드 저장소 인터페이스. 스탠드얼론은 IndexedDB(idbStore), 서버 버전은 `.works/` 사이드카(sidecarStore)가 구현한다.
import type { Coll, WorksRecord } from './types';
import { trackWrites } from './track';

export interface WorksStore {
  /** part: 문서 파티션 컬렉션이면 docKey, 글감처럼 전역 컬렉션이면 생략 */
  list<T extends WorksRecord>(coll: Coll, part?: string): Promise<T[]>;
  get<T extends WorksRecord>(coll: Coll, id: string, part?: string): Promise<T | undefined>;
  /** 같은 id 가 있으면 덮어쓴다. id 는 컬렉션 전체에서 유일해야 한다(uuid) — IndexedDB 구현은 id 하나가 한 파티션에만 속한다. */
  put<T extends WorksRecord>(coll: Coll, rec: T, part?: string): Promise<void>;
  putMany<T extends WorksRecord>(coll: Coll, recs: T[], part?: string): Promise<void>;
  remove(coll: Coll, id: string, part?: string): Promise<void>;
  /** 레코드가 하나라도 있는 파티션. 전역 컬렉션은 비어 있으면 [], 아니면 [GLOBAL_PART] */
  parts(coll: Coll): Promise<string[]>;
  removePart(coll: Coll, part: string): Promise<void>;
  /** 문서 이름 변경에 따라 파티션을 옮긴다. 대상 파티션에 이미 있는 레코드와 합쳐진다. */
  movePart(coll: Coll, from: string, to: string): Promise<void>;
}

let current: WorksStore | undefined;
/** 셸이 시작할 때 모드에 맞는 구현을 등록한다 */
export function useWorksStore(store: WorksStore) { current = trackWrites(store, () => writeListener?.()); }
// 쓰기 감지(백업의 '마지막 변경 시각'). 어떤 쓰기든 성공하면 알린다.
let writeListener: (() => void) | undefined;
export function onWorksWrite(fn: () => void) { writeListener = fn; }
/** 셸의 init() 이 저장소를 등록했는지(자식 컴포넌트의 onMount 가 init 보다 먼저 돌 수 있다) */
export const hasWorksStore = (): boolean => !!current;
export function worksStore(): WorksStore {
  if (!current) throw new Error('WorksStore 가 등록되지 않았습니다');
  return current;
}
