// md-works 전용 동기화 평문 타입(SyncPlain.data 의 모양)과 앱 id. 코어는 sync-kit 패키지에 있다.

export const APP_ID = 'md-works';

/** 글: 이름은 폴더 포함 전체 경로(예: "폴더/글"). 평문 안에만 있다 */
export interface DocData { name: string; content: string }
/** 글감: 글 참조는 docKey 가 아니라 글 이름(소문자 비교용 원문)으로 보낸다 */
export interface SnippetData {
  body: string;
  color: string;
  createdAt: number;
  source?: { url: string; title?: string; excerpt?: string };
  attachedDocNames: string[];
  trashedFromNames?: string[];
  /** 키 = 글 이름 */
  ordersByName?: Record<string, number>;
  deletedAt?: number;
  purged?: boolean;
}
export interface ThreadData {
  docName: string;
  anchor: { quote: string; prefix: string; suffix: string };
  messages: { id: string; text: string; ts: number }[];
  resolved: boolean;
  createdAt: number;
  deletedAt?: number;
}
