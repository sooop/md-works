<script lang="ts">
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { doc } from '../store.svelte';
  import { tip } from '../tooltip.svelte';

  let { onRetry }: { onRetry: () => void } = $props();
</script>

<!-- 저장이 실패한 동안 상단바에 계속 보인다(토스트는 한 번만). 누르면 즉시 다시 저장하고, 성공하면 사라진다 -->
{#if doc.saveFailed}
  <span class="save-fail-wrap" role="alert">
    <button
      class="save-fail" disabled={doc.saving} onclick={onRetry}
      use:tip={{ title: '저장하지 못함', lines: [doc.saveError || '저장하지 못했습니다', '누르면 지금 다시 시도합니다'] }}
    ><TriangleAlert size={15} /><span>저장하지 못함 · 다시 시도</span></button>
  </span>
{/if}
