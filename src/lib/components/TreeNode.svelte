<script lang="ts">
  import TreeNode from './TreeNode.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Folder from '@lucide/svelte/icons/folder';
  import FileText from '@lucide/svelte/icons/file-text';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import { doc } from '../store.svelte';
  import {
    nav, openDoc, createDoc, createFolder, renameNodeBy, removeNode, type TreeNode as Node,
  } from '../server-mode.svelte';
  import { stripExt, fmtDateTime } from '../utils';
  import { tip } from '../tooltip.svelte';
  import { openContextMenu } from '../contextmenu.svelte';
  import RenameInput from './RenameInput.svelte';

  let { node, depth = 0 }: { node: Node; depth?: number } = $props();
  let expanded = $state(true);
  let renaming = $state(false);
  const shownName = $derived(node.type === 'file' ? stripExt(node.name) : node.name);
  const menuItems = $derived([
    ...(node.type === 'dir' ? [{ label: '새 문서', run: () => createDoc(node.path) }, { label: '새 폴더', run: () => createFolder(node.path) }] : []),
    { label: '이름 변경', run: () => { renaming = true; }, sep: node.type === 'dir' },
    { label: '삭제…', run: () => removeNode(node), danger: true, sep: true },
  ]);
  const open = $derived(!!nav.filter.trim() || expanded); // 파일명 검색 중에는 일치 항목이 보이도록 모두 펼친다
</script>

<li>
  <div
    class="row"
    class:active={node.type === 'file' && doc.path === node.path}
    class:selected={node.type === 'dir' && nav.dir === node.path}
    style:padding-left="{8 + depth * 14}px"
    oncontextmenu={(e) => openContextMenu(e, menuItems)}
    role="presentation"
  >
    {#if renaming}
      <span class="name">
        <span class="twisty"></span>
        {#if node.type === 'dir'}<Folder size={15} class="ico" />{:else}<FileText size={15} class="ico" />{/if}
        <RenameInput value={shownName} onCommit={(v) => { renaming = false; void renameNodeBy(node, v); }} onCancel={() => (renaming = false)} />
      </span>
    {:else if node.type === 'dir'}
      <button class="name" ondblclick={() => (renaming = true)} onclick={() => { nav.dir = node.path; expanded = !expanded; }} aria-expanded={open} use:tip={{ title: node.name, lines: ['선택한 폴더에 새 문서가 만들어집니다', '더블 클릭: 이름 변경 · 우클릭: 메뉴'] }}>
        <span class="twisty">{#if open}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}</span>
        <Folder size={15} class="ico" />
        <span class="label">{node.name}</span>
      </button>
    {:else}
      <button class="name" ondblclick={() => (renaming = true)} onclick={() => openDoc(node.path)} use:tip={{ title: stripExt(node.name), lines: [node.path, ...(node.mtime ? [`수정 ${fmtDateTime(node.mtime)}`] : []), '더블 클릭: 이름 변경 · 우클릭: 메뉴'] }}>
        <span class="twisty"></span>
        <FileText size={15} class="ico" />
        <span class="label">{stripExt(node.name)}</span>
        {#if doc.path === node.path && doc.dirty}<span class="dot" use:tip={'저장 안 됨'}>●</span>{/if}
      </button>
    {/if}
    {#if node.type === 'dir' && !renaming}
    <span class="ops">
      {#if node.type === 'dir'}
        <button use:tip={'새 문서'} aria-label="새 문서" onclick={() => createDoc(node.path)}><FilePlus size={14} /></button>
        <button use:tip={'새 폴더'} aria-label="새 폴더" onclick={() => createFolder(node.path)}><FolderPlus size={14} /></button>
      {/if}
    </span>
    {/if}
  </div>
  {#if node.type === 'dir' && open && node.children?.length}
    <ul>
      {#each node.children as child (child.path)}
        <TreeNode node={child} depth={depth + 1} />
      {/each}
    </ul>
  {/if}
</li>
