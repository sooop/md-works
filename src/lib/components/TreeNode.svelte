<script lang="ts">
  import TreeNode from './TreeNode.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Folder from '@lucide/svelte/icons/folder';
  import FileText from '@lucide/svelte/icons/file-text';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { doc } from '../store.svelte';
  import {
    nav, openDoc, createDoc, createFolder, renameNode, removeNode, type TreeNode as Node,
  } from '../server-mode.svelte';
  import { stripExt } from '../utils';

  let { node, depth = 0 }: { node: Node; depth?: number } = $props();
  let expanded = $state(true);
  const open = $derived(!!nav.filter.trim() || expanded); // 파일명 검색 중에는 일치 항목이 보이도록 모두 펼친다
</script>

<li>
  <div
    class="row"
    class:active={node.type === 'file' && doc.path === node.path}
    class:selected={node.type === 'dir' && nav.dir === node.path}
    style:padding-left="{8 + depth * 14}px"
  >
    {#if node.type === 'dir'}
      <button class="name" onclick={() => { nav.dir = node.path; expanded = !expanded; }} aria-expanded={open} title="선택한 폴더에 새 문서가 만들어집니다">
        <span class="twisty">{#if open}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}</span>
        <Folder size={15} class="ico" />
        <span class="label">{node.name}</span>
      </button>
    {:else}
      <button class="name" onclick={() => openDoc(node.path)}>
        <span class="twisty"></span>
        <FileText size={15} class="ico" />
        <span class="label">{stripExt(node.name)}</span>
        {#if doc.path === node.path && doc.dirty}<span class="dot" title="저장 안 됨">●</span>{/if}
      </button>
    {/if}
    <span class="ops">
      {#if node.type === 'dir'}
        <button title="새 문서" aria-label="새 문서" onclick={() => createDoc(node.path)}><FilePlus size={14} /></button>
        <button title="새 폴더" aria-label="새 폴더" onclick={() => createFolder(node.path)}><FolderPlus size={14} /></button>
      {/if}
      <button title="이름 변경" aria-label="이름 변경" onclick={() => renameNode(node)}><Pencil size={14} /></button>
      <button title="삭제" aria-label="삭제" onclick={() => removeNode(node)}><Trash2 size={14} /></button>
    </span>
  </div>
  {#if node.type === 'dir' && open && node.children?.length}
    <ul>
      {#each node.children as child (child.path)}
        <TreeNode node={child} depth={depth + 1} />
      {/each}
    </ul>
  {/if}
</li>
