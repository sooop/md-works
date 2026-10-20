<script lang="ts">
  import { tip } from '../tooltip.svelte';
  import { tick } from 'svelte';

  interface Props {
    title: string;
    editable: boolean;
    dirty?: boolean;
    onRename: (name: string) => void | Promise<void>;
  }
  let { title, editable, dirty = false, onRename }: Props = $props();

  let editing = $state(false);
  let value = $state('');
  let input = $state<HTMLInputElement>();

  async function start() {
    if (!editable) return;
    value = title;
    editing = true;
    await tick();
    input?.focus();
    input?.select();
  }

  async function commit() {
    if (!editing) return;
    editing = false;
    const next = value.trim();
    if (next && next !== title) await onRename(next);
  }

  function onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); void commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); editing = false; }
  }
</script>

{#if editing}
  <input class="doc-title-input" bind:this={input} bind:value onkeydown={onKey} onblur={commit} spellcheck="false" aria-label="문서 이름" />
{:else}
  <h1 class="doc-title" ondblclick={start} use:tip={editable ? '더블 클릭하여 이름 변경' : undefined}>
    {title}
    {#if dirty}<span class="dot" use:tip={'저장 안 됨'}>●</span>{/if}
  </h1>
{/if}

<style>
  .doc-title-input {
    font: inherit; font-size: 16px; font-weight: 600; min-width: 0; width: min(420px, 50vw);
    padding: 2px 8px; color: var(--text); background: var(--surface);
    border: 1px solid var(--border-strong); border-radius: 6px;
  }
</style>
