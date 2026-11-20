<script lang="ts">
  // 열린 글이 든 폴더 경로를 '폴더 › 폴더' 배지로 보여 준다. 배지를 누르면 그 폴더를 고른다(트리에서 선택·스크롤은 셸이 한다).
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Folder from '@lucide/svelte/icons/folder';
  import { tip } from '../tooltip.svelte';
  import { openContextMenu, longPress, type CtxItem } from '../contextmenu.svelte';
  import RenameInput from './RenameInput.svelte';

  interface Props {
    /** 열린 글이 든 폴더 경로('' = 최상위) */
    folder: string;
    onPick: (path: string) => void;
    /** 폴더 배지의 우클릭(길게 누르기) 메뉴 항목 */
    menuFor?: (path: string) => CtxItem[];
    /** 이름을 고치는 중인 폴더 경로(없으면 null). 확정하면 onRename, 취소하면 onRenameEnd */
    renaming?: string | null;
    onRename?: (path: string, name: string) => void;
    onRenameEnd?: () => void;
  }
  let { folder, onPick, menuFor, renaming = null, onRename, onRenameEnd }: Props = $props();

  /** 이 단계 수보다 깊으면 앞쪽은 '…' 배지 하나로 줄인다 */
  const SHOWN = 3;
  const crumbs = $derived(folder.split('/').filter(Boolean).map((name, i, a) => ({ name, path: a.slice(0, i + 1).join('/') })));
  const hidden = $derived(Math.max(0, crumbs.length - SHOWN));
  const shown = $derived(crumbs.slice(hidden));
</script>

{#if crumbs.length}
  <nav class="crumbs" aria-label="현재 문서 위치">
    {#if hidden}
      <button class="crumb more" use:tip={{ title: crumbs[hidden - 1].path, lines: ['눌러서 상위 폴더 선택'] }} onclick={() => onPick(crumbs[hidden - 1].path)}
        oncontextmenu={(e) => menuFor && openContextMenu(e, menuFor(crumbs[hidden - 1].path))} use:longPress={() => menuFor?.(crumbs[hidden - 1].path) ?? []}>…</button>
      <ChevronRight size={12} class="sep" />
    {/if}
    {#each shown as c, i (c.path)}
      {#if renaming === c.path}
        <span class="crumb editing"><Folder size={12} /><RenameInput value={c.name} onCommit={(v) => onRename?.(c.path, v)} onCancel={() => onRenameEnd?.()} /></span>
      {:else}
        <button class="crumb" class:last={i === shown.length - 1} use:tip={{ title: c.path, lines: ['눌러서 이 폴더 선택', '오른쪽 클릭: 새 글·이름 변경·이동'] }} onclick={() => onPick(c.path)}
          oncontextmenu={(e) => menuFor && openContextMenu(e, menuFor(c.path))} use:longPress={() => menuFor?.(c.path) ?? []}>
          <Folder size={12} /><span>{c.name}</span>
        </button>
      {/if}
      {#if i < shown.length - 1}<ChevronRight size={12} class="sep" />{/if}
    {/each}
  </nav>
{/if}

<style>
  .crumbs { display: flex; align-items: center; gap: 2px; min-width: 0; flex: 0 1 auto; }
  .crumbs :global(.sep) { flex: none; color: var(--muted); }
  .crumb {
    display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 14ch; flex: 0 1 auto;
    padding: 1px 7px; font-size: 12px; line-height: 1.6; color: var(--muted);
    background: var(--surface); border: 1px solid var(--border); border-radius: 999px;
  }
  .crumb span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .crumb:hover { color: var(--text); background: var(--hover); }
  .crumb.last { color: var(--text); }
  .crumb.more { max-width: none; }
  .crumb.editing { max-width: 22ch; padding: 0 4px 0 7px; }
  .crumb.editing :global(.rename-input) { font-size: 12px; padding: 0 4px; margin: 0; min-width: 6ch; }
</style>
