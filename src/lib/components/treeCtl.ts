// 글 목록 트리(DocTree·TreeNode)가 모드(서버/단일)와 상관없이 쓰는 동작 묶음. 각 셸이 자기 모드의 함수를 이어 준다.
import type { DocNode } from '../docTree';

export interface TreeCtl {
  isActive(node: DocNode): boolean;
  isDirty(node: DocNode): boolean;
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
export const dndUi: { pos: DropPos; indicate: (row: HTMLElement | null, pos: DropPos) => void; seedOrders: () => void } = { pos: '', indicate: () => {}, seedOrders: () => {} };
