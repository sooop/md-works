import type { LineMatch } from '../../../server/searchCore.js';

export type { LineMatch };

// 전체 검색 결과: 파일(문서) 단위로 묶는다. id 는 서버 모드의 경로, 스탠드얼론의 문서 id.
export interface FileHit {
  id: string;
  label: string;
  matches: LineMatch[];
  more: boolean; // 이 파일에 표시한 것보다 일치가 더 있음
}
// 코멘트(스레드) 검색 결과: 스레드마다 처음 일치한 메시지 한 줄. docId 는 FileHit.id 와 같다.
export interface CommentHit {
  docId: string;
  label: string;
  threadId: string;
  snippet: string; // 일치 주변 한 줄
  ranges: [number, number][]; // snippet 안의 일치 구간
  resolved: boolean;
}
export interface SearchResponse {
  results: FileHit[];
  count: number;
  truncated: boolean; // 전체 상한에 걸려 일부만 표시
  comments?: CommentHit[];
}
