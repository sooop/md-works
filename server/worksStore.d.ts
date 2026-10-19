export const WORKS_DIR: string;
export const COLLS: Record<string, boolean>;
export const GLOBAL_PART: string;
export class WorksError extends Error { status: number; constructor(status: number, message: string); }
export interface WorksFs {
  list(coll: string, part?: string): Promise<unknown[]>;
  put(coll: string, part: string | undefined, rec: unknown): Promise<void>;
  remove(coll: string, part: string | undefined, id: string): Promise<void>;
  parts(coll: string): Promise<string[]>;
  removePart(coll: string, part: string): Promise<void>;
  movePart(coll: string, from: string, to: string): Promise<void>;
  moveDoc(fromRel: string, toRel: string, isFile: boolean): Promise<void>;
  deleteDoc(relPath: string, isFile: boolean): Promise<void>;
}
export function createWorksFs(safe: (rel: string, opts?: { mustExist?: boolean }) => Promise<string>): WorksFs;
