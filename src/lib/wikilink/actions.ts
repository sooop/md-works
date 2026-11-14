// 링크를 여는 동작(에디터 클릭·링크 패널 공통): 있는 글은 열고, 없는 글은 물어서 만들고, 모호하면 후보를 고르게 한다.
// 글을 여는 동작·만드는 동작은 각 모드의 것을 LinkHost 로 주입받는다.
import { askChoose, askConfirm, toast } from '../store.svelte';
import type { LinkHost } from './host';
import { docName, docPath, norm, type Resolved } from './parse';

const BAD_NAME = /[\\:*?"<>|]/;

/** 새 글의 `폴더/이름`: 경로를 쓴 링크는 그 경로, 이름만 쓴 링크는 현재 글과 같은 폴더 */
export function newDocPath(target: string, currentPath: string | null): string {
  const t = docPath(target.trim());
  if (t.includes('/')) return t;
  const dir = currentPath && currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : '';
  return dir ? `${dir}/${t}` : t;
}

export async function openWikiLink(host: LinkHost, target: string, res: Resolved): Promise<void> {
  const keyOf = (path: string) => host.docs().find((d) => norm(d.path) === norm(path))?.key;
  if (res.kind === 'ok') {
    const key = keyOf(res.path);
    if (key !== undefined) await host.open(key);
    return;
  }
  if (res.kind === 'ambiguous') {
    const shown = res.paths.slice(0, 8);
    const i = await askChoose(`'${target}' 와(과) 이름이 같은 글이 여러 개 있습니다. 어느 글을 열까요?`, [...shown, '취소']);
    const key = i >= 0 && i < shown.length ? keyOf(shown[i]) : undefined;
    if (key !== undefined) await host.open(key);
    return;
  }
  const path = newDocPath(target, host.current()?.path ?? null);
  if (!validDocPath(path)) { toast(`'${target}' 은(는) 글 이름으로 쓸 수 없습니다`, 'error'); return; }
  if (await askConfirm(`'${docName(path)}' 글이 없습니다. 새로 만들까요?`, '만들기')) await host.create(path);
}

const validDocPath = (path: string) => !!docName(path) && !BAD_NAME.test(path) && !path.split('/').some((s) => !s || s === '.' || s === '..');

/** 없는 글을 묻지 않고 만든다(링크 패널의 '만들기' 단추). 현재 글과 같은 폴더에 만들고 연다 */
export async function createWikiDoc(host: LinkHost, target: string): Promise<void> {
  const path = newDocPath(target, host.current()?.path ?? null);
  if (!validDocPath(path)) { toast(`'${target}' 은(는) 글 이름으로 쓸 수 없습니다`, 'error'); return; }
  await host.create(path);
}
