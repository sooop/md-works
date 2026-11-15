// 두 모드(서버·스탠드얼론)가 글 사이 링크 기능에 내주는 작은 인터페이스. 에디터·패널·이름 변경 로직은 이것만 안다.
// 구현은 serverHost.ts / standaloneHost.ts 이고, 각 모드 파일이 자기 내부 함수를 주입해 만든다(공유 파일 수정을 줄이려고 로직은 여기에 둔다).

/** key: 모드가 글을 여는 식별자(서버=`폴더/이름.md` 경로, 스탠드얼론=글 id). path: `.md` 를 뗀 `폴더/이름` */
export interface LinkDoc { key: string; path: string }

/** 서버 모드의 줄 검색 결과 한 건: 그 줄 안에 `[[` 가 있다 */
export interface LineHit { key: string; path: string; line: number; text: string }

export interface LinkHost {
  /** 모든 글(반응형 상태를 읽어야 목록이 바뀔 때 화면이 다시 계산된다) */
  docs(): LinkDoc[];
  /** 지금 열린 글 */
  current(): LinkDoc | null;
  open(key: string): void | Promise<void>;
  /** `폴더/이름`(확장자 없음) 글을 새로 만들고 연다. 실패하면 이유를 직접 알린다 */
  create(path: string): Promise<void>;
  /** 이름 변경 뒤 훑을 글(key) 후보. 모르면 undefined(전부 훑는다) — 서버는 `[[` 를 포함한 파일만 */
  candidates?(): Promise<string[] | undefined>;
  /** 글 본문. 열린 글이면 편집 중인 최신 내용 */
  read(key: string): Promise<string | null>;
  /** 글 본문을 바꿔 저장한다. 열린 글이면 에디터도 새로 그린다. 저장하지 못하면 false */
  write(key: string, text: string): Promise<boolean>;
  /** 스탠드얼론: 메모리의 모든 글 본문 */
  sources?(): { key: string; path: string; content: string }[];
  /** 서버: name 을 가리킬 만한 `[[…]]` 가 있는 줄을 찾는다(전체 검색 API, 상한에 걸리면 truncated) */
  searchLines?(name: string, signal: AbortSignal): Promise<{ hits: LineHit[]; truncated: boolean }>;
}
