<script lang="ts">
  // 상단 바의 '폴더 경로 배지 + 문서 제목'과 그 우클릭 메뉴. 서버 모드와 단일 모드가 같이 쓰고, 모드별 동작은 ctl 로 받는다(트리 행 메뉴와 같은 동작).
  import PathBadges from './PathBadges.svelte';
  import DocTitle from './DocTitle.svelte';
  import MovePicker from './MovePicker.svelte';
  import { openContextMenuAt, ctx, type CtxItem } from '../contextmenu.svelte';
  import { moveTargetsMany } from '../treeKeys';
  import { sortTree, splitArchived, splitPath, type DocNode } from '../docTree';
  import { treeUi } from '../docTree.svelte';
  import { stripExt } from '../utils';
  import type { TreeCtl } from './treeCtl';

  interface Props {
    ctl: TreeCtl;
    /** 폴더 트리 전체(이동 대상 목록에 쓴다) */
    nodes: DocNode[];
    /** 열린 글의 키(없으면 '') · 파일 이름(확장자 포함) · 든 폴더 경로 */
    docPath: string;
    docName: string;
    folder: string;
    dirty?: boolean;
    onPick: (path: string) => void;
    onRenameDoc: (name: string) => void | Promise<void>;
  }
  let { ctl, nodes, docPath, docName, folder, dirty = false, onPick, onRenameDoc }: Props = $props();

  let renamingFolder = $state<string | null>(null);
  let title = $state<{ start: () => void }>();
  let mover = $state<{ node: DocNode; x: number; y: number } | null>(null);

  const folderNode = (path: string): DocNode => {
    const { folder: dir, name } = splitPath(path);
    return { type: 'dir', name, path, dir };
  };
  const docNode = (): DocNode => ({ type: 'file', name: docName, path: docPath, dir: folder });
  const at = () => ({ x: ctx.x, y: ctx.y });

  const folderMenu = (path: string): CtxItem[] => [
    { label: '새 문서', run: () => ctl.createDoc(path) },
    { label: '새 폴더', run: () => ctl.createFolder(path) },
    { label: '이름 변경', run: () => { renamingFolder = path; }, sep: true },
    { label: '이동…', run: () => { mover = { node: folderNode(path), ...at() }; } },
    { label: '목록에서 위치 보기', run: () => onPick(path), sep: true },
  ];
  const titleMenu = (): CtxItem[] => [
    { label: '이름 변경', run: () => title?.start() },
    { label: '이동…', run: () => { mover = { node: docNode(), ...at() }; } },
    { label: '목록에서 위치 보기', run: () => onPick(folder) },
    { label: '휴지통으로 이동', run: () => ctl.remove(docNode()), danger: true, sep: true },
  ];

  // 이동 대상: 보관된 폴더는 뺀다(보관됨 구역으로는 옮기지 않는다)
  const targets = $derived(mover ? moveTargetsMany(sortTree(splitArchived(nodes, new Set(treeUi.archived)).active, 'manual', treeUi.orders), [mover.node]) : []);
  async function pickMove(dest: string) {
    const m = mover;
    mover = null;
    if (m) await ctl.move(m.node, dest);
  }
  async function renameFolder(path: string, name: string) {
    renamingFolder = null;
    await ctl.rename(folderNode(path), name);
  }
</script>

{#if docPath}
  <PathBadges {folder} {onPick} menuFor={folderMenu} renaming={renamingFolder} onRename={(p, n) => void renameFolder(p, n)} onRenameEnd={() => (renamingFolder = null)} />
{/if}
<DocTitle bind:this={title} title={docPath ? stripExt(docName) : '문서를 선택하세요'} editable={!!docPath} {dirty} onRename={onRenameDoc} menu={docPath ? titleMenu : undefined} />
{#if mover}
  <MovePicker name={mover.node.type === 'file' ? stripExt(mover.node.name) : mover.node.name} targets={targets} x={mover.x} y={mover.y} onPick={pickMove} onClose={() => (mover = null)} />
{/if}
