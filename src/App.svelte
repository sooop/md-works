<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import Dialog from './lib/components/Dialog.svelte';
  import Toasts from './lib/components/Toasts.svelte';
  import TooltipHost from './lib/components/TooltipHost.svelte';
  import ContextMenuHost from './lib/components/ContextMenuHost.svelte';
  import BusyBar from './lib/components/BusyBar.svelte';
  import { settings, applyTheme } from './lib/store.svelte';
  import { tableViewer } from './lib/tableViewer.svelte';
  import { listImport, listExport } from './lib/tableListUi.svelte';
  import { lazyComponent } from './lib/lazy.svelte';

  let { Shell }: { Shell: Component } = $props();

  // 표 확대 보기·목록↔표 변환 창은 표를 열 때 처음 받는다(표를 쓰지 않는 세션에서는 받지 않는다).
  // 열림 상태가 true 가 되는 즉시 받기 시작하고, 받은 뒤에는 계속 마운트해 닫힘 애니메이션을 유지한다. 실패하면 열림 상태를 되돌린다
  const viewer = lazyComponent(() => import('./lib/components/TableViewer.svelte'));
  const listToTable = lazyComponent(() => import('./lib/components/ListToTable.svelte'));
  const tableToList = lazyComponent(() => import('./lib/components/TableToList.svelte'));
  $effect(() => { if (tableViewer.table) viewer.load(() => (tableViewer.table = null)); });
  $effect(() => { if (listImport.open) listToTable.load(() => (listImport.open = false)); });
  $effect(() => { if (listExport.rows) tableToList.load(() => (listExport.rows = null)); });

  // 시스템 테마 변경을 따라간다
  onMount(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => { if (settings.theme === 'system') applyTheme(); };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });
</script>

<Shell />
<Dialog />
<Toasts />
{#if viewer.Comp}{@const TableViewer = viewer.Comp}<TableViewer />{/if}
{#if listToTable.Comp}{@const ListToTable = listToTable.Comp}<ListToTable />{/if}
{#if tableToList.Comp}{@const TableToList = tableToList.Comp}<TableToList />{/if}
<TooltipHost />
<ContextMenuHost />
<BusyBar />
