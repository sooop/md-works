<script lang="ts">
  // 글감 단축키(Ctrl+Alt+G 문구로 찾기, Ctrl+Alt+S 선택을 글감으로)와 에디터 선택 추적.
  // 사이드바를 닫아도 동작해야 해서 SnippetPanel 이 아닌 셸에 항상 마운트한다.
  import { onMount } from 'svelte';
  import { findByEditorText, sendSelection, trackEditorSelection } from '../snippets/state.svelte';

  onMount(() => trackEditorSelection());

  function onKey(e: KeyboardEvent) {
    if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return;
    if (e.code === 'KeyG') { e.preventDefault(); findByEditorText(); }
    else if (e.code === 'KeyS') { e.preventDefault(); void sendSelection(); }
  }
</script>

<svelte:window onkeydown={onKey} />
