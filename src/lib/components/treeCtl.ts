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
}

export const TREE_CTL = Symbol('treeCtl');

/** 끌고 있는 항목(트리 전체가 공유) */
export interface DragState { node: DocNode | null; hint: string }

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
