<script lang="ts">
  // 모바일(≤720px)에서 사이드바가 하단 시트일 때의 반투명 배경·핸들. 탭하면 닫는다.
  // 데스크톱에서는 CSS 로 숨겨진다(writing.css). 문서를 열면 시트를 자동으로 닫는다.
  import { untrack } from 'svelte';
  import { doc } from '../store.svelte';
  import { isMobile } from '../writing/state.svelte';
  import { backdropFx, panelFx } from '../motion';
  import '../writing/writing.css';

  interface Props { open: boolean; onClose: () => void }
  let { open, onClose }: Props = $props();

  $effect(() => {
    void doc.key; // 문서가 바뀌면
    untrack(() => { if (open && isMobile()) onClose(); });
  });
</script>

<svelte:window onkeydown={(e) => { if (open && isMobile() && e.key === 'Escape' && !e.defaultPrevented) onClose(); }} />

{#if open}
  <button class="sheet-backdrop" tabindex="-1" transition:backdropFx aria-label="사이드바 닫기" onclick={onClose}></button>
  <button class="sheet-handle" transition:panelFx={{ side: 'bottom' }} aria-label="사이드바 닫기" onclick={onClose}></button>
{/if}
