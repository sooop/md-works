// 번들 코어와 모드별 저장소 사이의 경계. 코어(core.ts)는 순수 로직이고, 글·이미지의 읽기/쓰기는 모드별 호스트가 맡는다.
//   - 스탠드얼론 호스트: IndexedDB 문서·이미지, worksStore = IndexedDB
//   - 서버 호스트: 서버 API(글 목록·읽기·쓰기·에셋), worksStore = `.works/` 사이드카
import type { WorksStore } from '../works/store';
import type { Design } from '../design';

/** 번들 안의 파일(경로는 zip 내부 경로 = 서버 노트 폴더 기준 경로) */
export interface BundleAsset { path: string; data: Uint8Array }

/** 보관소에 있는 글 한 편. name 은 번들에서 글을 식별하는 이름(서버는 루트 기준 경로, 스탠드얼론은 문서 이름 + .md) */
export interface HostDocInfo {
  name: string;
  /** 이력·스레드 파티션(docKey). 스탠드얼론은 문서 id, 서버는 경로(=name) */
  key: string;
  updatedAt: number;
}

export interface HostDocBody {
  /** 번들 형식 본문: 이미지는 `assets/…` 상대 링크 */
  content: string;
  /** 그 본문이 참조하는 이미지 */
  assets: BundleAsset[];
  /** 보관소의 원래 본문(스탠드얼론은 `idb:` 참조). 이력 버전으로 남길 때 쓴다 */
  raw: string;
}

/** 가져오기 한 번 동안 쓰는 변환·쓰기 세션 (이미지 중복 저장 방지용 캐시를 가진다) */
export interface ImportSession {
  /**
   * 번들 형식 본문 → 보관소 형식 본문. srcPath 는 번들 안에서 그 본문이 속한 글의 원래 경로(이미지 링크의 기준 폴더).
   * 스탠드얼론은 이미지를 저장하고 `idb:` 로 바꾼다. 서버는 그대로 돌려준다.
   */
  text(srcPath: string, text: string): Promise<string>;
  /** 글을 만들거나 덮어쓴다. content 는 text() 를 거친 값. 돌려주는 값은 docKey */
  putDoc(srcPath: string, name: string, content: string, updatedAt: number): Promise<string>;
  /** 마무리(서버: 글이 참조하지 않는 나머지 에셋 중 없는 것을 쓴다) */
  close(): Promise<void>;
}

export interface BundleHost {
  readonly mode: 'server' | 'html';
  /** 이력·글감·스레드 저장소 */
  readonly store: WorksStore;
  /** 이력 버전 본문에도 이미지 변환이 필요한지(스탠드얼론) */
  readonly convertsImages: boolean;
  /** 디자인 설정 입출력. 생략하면 localStorage 기반 기본 구현(design/io)을 쓴다. 앱은 반응형 상태를 갱신하는 importDesign 을 넘긴다 */
  readonly design?: { current(): string; apply(d: Design): void };
  /** 내보내기·가져오기 전에 대기 중인 편집을 저장한다 */
  prepare(): Promise<void>;
  /** 번들의 글 이름을 이 보관소의 이름으로 바꾼다(스탠드얼론: 폴더 펼치기·대소문자 맞춤). 같은 이름끼리 충돌하면 코어가 오류로 처리한다 */
  normalizeName(name: string): string;
  listDocs(): Promise<HostDocInfo[]>;
  readDoc(d: HostDocInfo): Promise<HostDocBody>;
  /** 글 밖의 본문(이력 버전)을 번들 형식으로. 파일 이름은 이미지 id 기반(stable) */
  textToBundle(stem: string, text: string): Promise<{ text: string; assets: BundleAsset[] }>;
  /** assets: 번들에 들어 있는 모든 에셋(경로 → 데이터) */
  beginImport(assets: ReadonlyMap<string, Uint8Array>): ImportSession;
  /**
   * 글 한 편을 지운다(다른 기기에서 지운 글을 따라 지울 때). 이력·스레드·글감 연결·이미지 정리는 앱의 삭제 경로와 같은 규칙을 따른다.
   * 묘비는 기록하지 않는다(코어가 번들의 묘비를 그대로 저장한다). 없는 글이면 아무것도 하지 않는다
   */
  deleteDoc(name: string): Promise<void>;
  /** 이름의 대소문자를 구분하지 않는 보관소인가(윈도·맥 파일 시스템). 번들 안에 대소문자만 다른 글이 있으면 충돌로 다룬다 */
  readonly foldsCase?: boolean;
  /** 이력·스레드의 id 가 파티션과 무관하게 저장소 전체에서 유일한 키인가(스탠드얼론 IndexedDB). 병합이 다른 파티션의 같은 id 를 덮어쓰지 않도록 건너뛴다 */
  readonly globalIds?: boolean;
  /** 쓰기 전에(계획 단계) 이 보관소가 받을 수 없는 이름·크기가 있으면 BundleError 를 던진다. docs 는 실제로 쓸 글, partitions 는 이력·스레드를 쓸 글 이름, assets 는 번들의 모든 이미지 경로 */
  validateImport?(w: { docs: { name: string; content: string; updatedAt?: number }[]; partitions: string[]; assets: string[] }): void;
  /** 가져오기 시작(true)·끝(false) 알림. 스탠드얼론은 그동안 이미지 정리(gc)를 멈춘다 */
  setImporting?(on: boolean): void;
  /** 가져오기가 끝난 뒤(성공이든 실패든 쓴 것이 있을 때) 화면 상태를 다시 읽는다 */
  afterApply?(): Promise<void>;
}

let current: BundleHost | undefined;
/** 셸이 시작할 때 모드에 맞는 호스트를 등록한다 */
export function useBundleHost(host: BundleHost) { current = host; }
export function bundleHost(): BundleHost {
  if (!current) throw new Error('BundleHost 가 등록되지 않았습니다');
  return current;
}
