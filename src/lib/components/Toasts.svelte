<script lang="ts">
  import { toasts, status } from '../store.svelte';
</script>

{#if status.text}
  <div class="status" role="status"><span class="spinner" aria-hidden="true"></span>{status.text}</div>
{/if}

<div class="toasts" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class="toast" class:error={t.kind === 'error'}>{t.text}</div>
  {/each}
</div>
