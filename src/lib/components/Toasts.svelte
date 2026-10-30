<script lang="ts">
  import { toasts, status } from '../store.svelte';
  import { toastFx } from '../motion';
</script>

{#if status.text}
  <div class="status" role="status" transition:toastFx><span class="spinner" aria-hidden="true"></span>{status.text}</div>
{/if}

<div class="toasts" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class="toast" transition:toastFx class:error={t.kind === 'error'}>{t.text}</div>
  {/each}
</div>
