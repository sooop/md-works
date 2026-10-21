<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import Dialog from './lib/components/Dialog.svelte';
  import Toasts from './lib/components/Toasts.svelte';
  import TableViewer from './lib/components/TableViewer.svelte';
  import ListToTable from './lib/components/ListToTable.svelte';
  import TableToList from './lib/components/TableToList.svelte';
  import TooltipHost from './lib/components/TooltipHost.svelte';
  import ContextMenuHost from './lib/components/ContextMenuHost.svelte';
  import BusyBar from './lib/components/BusyBar.svelte';
  import { settings, applyTheme } from './lib/store.svelte';

  let { Shell }: { Shell: Component } = $props();

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
<TableViewer />
<ListToTable />
<TableToList />
<TooltipHost />
<ContextMenuHost />
<BusyBar />
