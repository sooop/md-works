<script lang="ts">
  import { dialog } from '../store.svelte';

  let inputEl = $state<HTMLInputElement>();

  $effect(() => {
    if (dialog.open && dialog.input) queueMicrotask(() => inputEl?.select());
  });

  const pick = (button: number) => dialog.resolve({ button, value: dialog.value });

  function onKey(e: KeyboardEvent) {
    if (!dialog.open) return;
    if (e.key === 'Escape') { e.preventDefault(); pick(-1); }
    else if (e.key === 'Enter' && dialog.input) { e.preventDefault(); pick(dialog.buttons.length - 1); }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if dialog.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) pick(-1); }}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label={dialog.title || dialog.message}>
      {#if dialog.title}<h2>{dialog.title}</h2>{/if}
      {#if dialog.message}<p>{dialog.message}</p>{/if}
      {#if dialog.input}
        <input bind:this={inputEl} bind:value={dialog.value} spellcheck="false" />
      {/if}
      <div class="actions">
        {#each dialog.buttons as label, i}
          <button class:primary={i === dialog.buttons.length - 1} onclick={() => pick(i)}>{label}</button>
        {/each}
      </div>
    </div>
  </div>
{/if}
