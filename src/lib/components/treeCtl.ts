// 글 목록 트리(DocTree·TreeNode)가 모드(서버/단일)와 상관없이 쓰는 동작 묶음. 각 셸이 자기 모드의 함수를 이어 준다.
import type { DocNode } from '../docTree';

export interface TreeCtl {
  isActive(node: DocNode): boolean;
  isDirty(node: DocNode): boolean;
  /** 지금 열린 글의 키(없으면 '')와 그 글이 든 폴더 경로 */
  activePath(): string;
  activeDir(): string;
  open(node: DocNode): void;
  /** 새 글이 만들어질 폴더 */
  selectedDir(): string;
  selectDir(path: string): void;
  createDoc(dir: string): void;
  createFolder(dir: string): void;
  rename(node: DocNode, input: string): Promise<void>;
  remove(node: DocNode): Promise<void>;
  /** 글·폴더를 destDir('' = 최상위) 안으로 옮긴다 */
  move(node: DocNode, destDir: string): Promise<void>;
  /** 툴팁에 보일 보조 줄(경로·수정일 등) */
  tipLines(node: DocNode): string[];

  // ---- 다중 선택 일괄 동작(선택). 대상은 이미 정규화되어 있다(폴더와 그 안의 항목을 함께 골랐으면 상위 폴더만) ----
  /** 여러 항목을 한 번에 지운다(확인창은 호출 전에 트리가 띄운다). 결과 개수를 돌려준다 */
  removeMany?(nodes: DocNode[]): Promise<BulkResult>;
  /** 여러 항목을 destDir 로 옮긴다. 이미 그 폴더에 있거나 자기 하위로 가는 항목은 트리가 미리 뺀다 */
  moveMany?(nodes: DocNode[], destDir: string): Promise<BulkResult>;
  /** 여러 항목을 파일 하나로 내려받는다. format: 'zip'(기본) | 'json' | 'md' — 폴더 우클릭 내보내기와 같은 형식 */
  downloadMany?(nodes: DocNode[], format?: string): Promise<void>;
}

/** 일괄 동작의 결과: 성공·실패 개수와 첫 실패 이유(사용자가 취소해 아무것도 하지 않았으면 둘 다 0) */
export interface BulkResult { ok: number; failed: number; error?: string }

export const TREE_CTL = Symbol('treeCtl');

/** 끌고 있는 항목(트리 전체가 공유). nodes 는 선택된 항목을 끌 때 함께 움직이는 묶음(정규화됨, 둘 이상일 때만 채운다) */
export interface DragState { node: DocNode | null; hint: string; nodes?: DocNode[] }

export type DropPos = '' | 'before' | 'after' | 'into';
/**
 * 놓을 위치 표시: 행마다 반응형 상태를 바꾸면 끄는 동안 모든 행이 다시 계산돼 표시가 마우스를 늦게 따라온다.
 * 그래서 표시 요소 하나를 DocTree 가 직접 옮기게 하고(indicate), 마지막 위치만 여기에 적어 둔다.
 */
export const dndUi: {
  pos: DropPos;
  indicate: (row: HTMLElement | null, pos: DropPos) => void;
  seedOrders: () => void;
  /** 끌기 시작 때 만든 고스트 복제본과, 마우스가 행 안에서 잡은 위치(놓을 때 이 고스트가 자리로 날아간다) */
  ghost: { el: HTMLElement; dx: number; dy: number; width: number; height: number } | null;
  /** 놓은 직후 트리가 갱신되는 동안 true: 옮기기를 삭제·삽입 효과(빨강·초록 flash)로 보이지 않게 한다 */
  moving: boolean;
  /** 끌던 항목이 접혀 있던 자리를 애니메이션 없이 곧바로 되돌린다(놓은 자리가 이미 펼쳐져 있어 주변이 다시 움직이지 않게) */
  restoreSource: (() => void) | null;
} = { pos: '', indicate: () => {}, seedOrders: () => {}, ghost: null, moving: false, restoreSource: null };

/**
 * 키보드·메뉴 조작 연결부: 행(TreeNode)이 트리(DocTree)에 부탁하는 일. DocTree 가 채워 넣는다.
 * 반응형 상태가 아니라 호출만 하므로 dndUi 처럼 평범한 객체로 둔다.
 */
export const kbUi: {
  /** 그 항목의 행으로 포커스를 옮긴다(보이도록 스크롤) */
  focus: (path: string) => void;
  /** 삭제·이름 변경처럼 행이 사라지거나 다시 그려진 뒤 포커스가 바닥으로 떨어졌으면 가까운 행으로 되돌린다(잠깐 동안 목록이 바뀔 때마다 시도) */
  expectRefocus: () => void;
  /** '이동…' 대상 고르기 패널을 연다. at 은 패널을 띄울 화면 좌표, from 은 닫을 때 포커스를 돌려줄 요소 */
  moveTo: (node: DocNode, at: { x: number; y: number }, from?: HTMLElement | null) => void;
} = { focus: () => {}, expectRefocus: () => {}, moveTo: () => {} };

/**
 * 다중 선택 연결부: 행(TreeNode)이 트리(DocTree)에 부탁하는 일. DocTree 가 채워 넣는다(kbUi 와 같은 방식).
 * 선택 상태 자체는 treeSelect.svelte.ts 의 tsel.
 */
export const selUi: {
  /** 끌기·우클릭의 묶음: node 가 선택돼 있으면 정규화된 선택 전체(트리 순서), 아니면 node 하나 */
  group: (node: DocNode) => DocNode[];
  /** nodes 를 destDir 로 옮긴다(결과를 알린다) */
  moveNodes: (nodes: DocNode[], destDir: string) => Promise<void>;
  /** 선택 이동 패널을 연다(at: 화면 좌표, from: 닫을 때 포커스를 돌려줄 요소) */
  moveTo: (at: { x: number; y: number }, from?: HTMLElement | null) => void;
  /** 선택을 지정한 형식으로 내려받는다 */
  download: (format: string) => Promise<void>;
  /** 확인창을 거쳐 선택을 지운다 */
  remove: () => Promise<void>;
} = { group: (n) => [n], moveNodes: async () => {}, moveTo: () => {}, download: async () => {}, remove: async () => {} };
