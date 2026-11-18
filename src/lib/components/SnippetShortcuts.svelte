<script lang="ts">
  // 글감 단축키(Ctrl+Alt+G 문구로 찾기, Ctrl+Alt+S 선택을 글감으로)와 에디터 선택 추적.
  // 사이드바를 닫아도 동작해야 해서 SnippetPanel 이 아닌 셸에 항상 마운트한다.
  import { onMount } from 'svelte';
  import { findByEditorText, sendSelection, trackEditorSelection, openLibrary, closeLibrary, lib } from '../snippets/state.svelte';
  import SnippetLibrary from './SnippetLibrary.svelte';

  onMount(() => trackEditorSelection());

  function onKey(e: KeyboardEvent) {
    if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return;
    if (e.code === 'KeyG') { e.preventDefault(); findByEditorText(); }
    else if (e.code === 'KeyS') { e.preventDefault(); void sendSelection(); }
    else if (e.code === 'KeyL') { e.preventDefault(); if (lib.open) closeLibrary(); else openLibrary(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- 글감 보관함 모달: 단축키·명령 팔레트·사이드바 카드 어디서든 열리도록 셸에 항상 마운트된 이 컴포넌트가 함께 맡는다 -->
<SnippetLibrary />
