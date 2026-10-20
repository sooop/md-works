// 글감·이력·스레드 레코드 스키마. 번들 병합(P2)이 id·updatedAt·deletedAt 만으로 되도록 모든 레코드가 같은 머리를 가진다.
export interface WorksRecord {
  id: string;
  updatedAt: number;
  /** 있으면 휴지통에 있다(소프트 삭제). 복구하면 지운다. */
  deletedAt?: number;
}

export type SnippetColor = 'yellow' | 'pink' | 'green' | 'blue' | 'purple' | 'gray';
export const SNIPPET_COLORS: SnippetColor[] = ['yellow', 'pink', 'green', 'blue', 'purple', 'gray'];

export interface SnippetSource { url: string; title?: string; excerpt?: string }

/** 글감(포스트잇). 전역 보관함에 쌓이고 글에는 붙이기/떼기로만 연결한다. */
export interface Snippet extends WorksRecord {
  body: string; // 짧은 마크다운(이미지는 본문에 포함)
  source?: SnippetSource;
  color: SnippetColor;
  createdAt: number;
  /** 붙어 있는 글의 docKey 목록(스탠드얼론은 문서 id, 서버는 루트 기준 경로) */
  attachedDocs: string[];
  /** 휴지통으로 가기 직전에 붙어 있던 글. 복구하면 attachedDocs 로 되돌린다. */
  trashedFrom?: string[];
  /** 글별 정렬 값(키 = 붙은 글의 docKey, 작을수록 위). 없는 글에서는 맨 위에 최근 수정 순. 휴지통에서도 보존한다. */
  orders?: Record<string, number>;
  /** 휴지통에서 완전히 지운 글감의 묘비. body 는 비어 있고, 번들 병합이 되살림을 막는 데만 쓴다. */
  purged?: boolean;
}

export interface ThreadAnchor { quote: string; prefix: string; suffix: string }
export interface ThreadMessage { id: string; text: string; ts: number }

/** 본문 구간에 매달린 대화. 답글은 역할 구분 없이 순서대로 쌓인다. */
export interface Thread extends WorksRecord {
  docKey: string;
  anchor: ThreadAnchor;
  messages: ThreadMessage[];
  resolved: boolean;
  createdAt: number;
}

/** 글 한 편의 수정 이력 한 건. content 는 enc 에 따라 원문 또는 압축 문자열. */
export interface Version extends WorksRecord {
  docKey: string;
  ts: number;
  content: string;
  enc: 'raw' | 'deflate-b64';
  /** 이름을 붙인 버전은 솎아내기에서 제외하고 영구 보존한다. */
  name?: string;
}

/** 글 삭제 묘비(전역, 파티션 없음). id = 이름에서 만든 안전한 id, name = 글 이름(서버는 경로), updatedAt = deletedAt */
export interface Tombstone extends WorksRecord {
  name: string;
  deletedAt: number;
}

export type Coll = 'versions' | 'snippets' | 'threads' | 'tombstones';
/** 컬렉션이 문서별 파티션을 쓰는지. false 면 파티션은 GLOBAL_PART 하나다. */
export const PARTITIONED: Record<Coll, boolean> = { versions: true, snippets: false, threads: true, tombstones: false };
export const GLOBAL_PART = '_';

export const newId = (): string => crypto.randomUUID();
