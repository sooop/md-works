// 스탠드얼론의 LinkHost. 글은 메모리(standalone-mode 의 all)에 모두 올라 있어 훑기가 싸다.
import type { LinkDoc, LinkHost } from './host';
import { docPath } from './parse';

export interface StandaloneDeps {
  /** 글 목록(id, `폴더/이름.md`) — 반응형 상태(lib.docs)를 읽어야 한다 */
  list(): { id: string; path: string }[];
  /** 메모리의 글 본문 */
  recs(): { id: string; path: string; content: string }[];
  openId(): string;
  /** 대기 중인 입력을 저장 줄에 넣고 끝날 때까지 기다린다 */
  flush(): Promise<void>;
  content(): string;
  /** 열린 글을 바꿔 에디터에 다시 그리고 저장한다(되돌리기 직전 내용은 이력에 남는다) */
  restore(text: string): Promise<void>;
  /** 열려 있지 않은 글을 바꿔 저장한다. 저장하지 못하면 false */
  saveOther(id: string, text: string): Promise<boolean>;
  open(id: string): void | Promise<void>;
  create(path: string): Promise<void>;
}

export function createStandaloneLinkHost(deps: StandaloneDeps): LinkHost {
  const toDoc = (r: { id: string; path: string }): LinkDoc => ({ key: r.id, path: docPath(r.path) });
  return {
    docs: () => deps.list().map(toDoc),
    current() {
      const id = deps.openId();
      const r = id ? deps.list().find((x) => x.id === id) : undefined;
      return r ? toDoc(r) : null;
    },
    open: (key) => deps.open(key),
    create: (path) => deps.create(path),
    async read(key) {
      if (key === deps.openId()) { await deps.flush(); return deps.content(); }
      return deps.recs().find((r) => r.id === key)?.content ?? null;
    },
    async write(key, text) {
      try {
        if (key === deps.openId()) { await deps.restore(text); return true; }
        return await deps.saveOther(key, text);
      } catch { return false; }
    },
    sources: () => deps.recs().map((r) => ({ key: r.id, path: docPath(r.path), content: r.content })),
  };
}
