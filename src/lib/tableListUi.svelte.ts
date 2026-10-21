// 표 ↔ 목록 변환 창의 열림 상태와 마지막으로 고른 옵션(창을 다시 열어도 유지)
import type { InputFormat, ListExportFormat, ArrMode, HeaderMode } from './tableList';
import type { CodeSource } from './tableTools';

/** 목록·표 텍스트 → 표 (편집기에 삽입) */
export const listImport = $state({
  open: false,
  format: 'auto' as InputFormat,
  arr: 'cols' as ArrMode,
  headerMode: 'auto' as HeaderMode,
  /** 코드 블록에서 연 경우의 원본(내용을 미리 채우고, 삽입 위치를 그 블록 기준으로 한다) */
  src: null as CodeSource | null,
});

/** 표 → 목록 (복사·파일·코드 블록). rows 는 첫 행이 머리글 */
export const listExport = $state({
  rows: null as string[][] | null,
  index: 0,
  format: 'json' as ListExportFormat,
  infer: true,
  unflat: true,
  inclHeader: true,
});

export function openListImport(src: CodeSource | null = null) {
  listImport.src = src;
  listImport.open = true;
}
export function openListExport(rows: string[][], index: number) {
  listExport.rows = rows;
  listExport.index = index;
}
