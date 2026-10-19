import type { LineMatch } from '../../../server/searchCore.js';

export type { LineMatch };

// 전체 검색 결과: 파일(문서) 단위로 묶는다. id 는 서버 모드의 경로, 스탠드얼론의 문서 id.
export interface FileHit {
  id: string;
  label: string;
  matches: LineMatch[];
  more: boolean; // 이 파일에 표시한 것보다 일치가 더 있음
}
export interface SearchResponse {
  results: FileHit[];
  count: number;
  truncated: boolean; // 전체 상한에 걸려 일부만 표시
}
