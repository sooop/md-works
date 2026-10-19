// 번들(백업·동기화) 공개 계약. 구현은 bundle/core(작업 P2a), 암호화·전송·UI 는 작업 P2b 가 이 계약에만 의존한다.
// 번들 = 글(.md)·이미지·이력·글감·스레드·디자인을 담은 zip. 서버 노트 폴더 구조의 상위 집합이라 풀면 그대로 노트 폴더가 된다.
//
//   manifest.json                       {schema:'md-works-bundle', version:1, createdAt, mode, app}
//   <경로>.md, assets/<문서명>/<n>.<ext>  글과 이미지(기존 archive.ts 와 같은 형식)
//   .works/docs.json                    {<글 이름(경로)>: {updatedAt}}  — 글 식별은 이름(서버는 경로)
//   .works/versions/<글 이름>/<id>.json 서버 사이드카와 같은 배치(파티션 = 글 이름). 스탠드얼론 id 는 내보낼 때 이름으로 바꾼다
//   .works/snippets/_/<id>.json
//   .works/threads/<글 이름>/<id>.json
//   .works/design.json                  serializeDesign() 결과
//   .works/tombstones.json              {docs:{<이름>:deletedAt}}  (글 삭제는 전파하지 않고 기록만 한다)

export interface BundleSummary {
  docs: number;
  images: number;
  versions: number;
  snippets: number;
  threads: number;
  bytes: number;
}

export type DocAction = 'add' | 'update' | 'conflict' | 'same' | 'keep-local';
export interface MergePreview {
  createdAt: number;
  mode: 'server' | 'html';
  docs: { name: string; action: DocAction }[];
  snippets: { add: number; update: number; same: number; keepLocal: number };
  threads: { add: number; update: number; same: number; keepLocal: number };
  versions: { add: number; same: number };
  /** 번들에 디자인 설정이 있고 현재와 다른지 */
  designDiffers: boolean;
}

export interface MergeResult {
  docsAdded: number;
  docsUpdated: number;
  /** 양쪽이 다르게 바뀐 글 — 진 쪽 내용을 '병합 전' 이름의 버전으로 이력에 남긴다 */
  conflicts: string[];
  snippets: number;
  threads: number;
  versions: number;
  designApplied: boolean;
}

/** 현재 보관소를 번들(zip 바이트)로 만든다. 암호화는 호출자(작업 P2b)가 한다. */
export async function buildBundle(): Promise<{ bytes: Uint8Array; summary: BundleSummary }> {
  throw new Error('buildBundle: 구현되지 않았습니다 (작업 P2a)');
}

/** 번들을 읽어 병합했을 때 무엇이 바뀌는지 미리 계산한다. 아무것도 쓰지 않는다. */
export async function previewBundle(_bytes: Uint8Array): Promise<MergePreview> {
  throw new Error('previewBundle: 구현되지 않았습니다 (작업 P2a)');
}

/** 번들을 현재 보관소에 병합한다. options.applyDesign 이 true 면 번들의 디자인도 적용한다. */
export async function applyBundle(_bytes: Uint8Array, _options?: { applyDesign?: boolean }): Promise<MergeResult> {
  throw new Error('applyBundle: 구현되지 않았습니다 (작업 P2a)');
}
