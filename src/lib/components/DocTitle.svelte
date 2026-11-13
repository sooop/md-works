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
  let heading = $state<HTMLElement>();
  // 키보드(Enter·Esc)로 끝냈을 때만 제목으로 포커스를 돌려준다(바깥을 눌러 끝났으면 그 클릭의 포커스를 존중)
  let backToHeading = false;

  async function start() {
    if (!editable) return;
    value = title;
    editing = true;
    await tick();
    input?.focus();
    input?.select();
  }

  async function leave() {
    if (!backToHeading) return;
    backToHeading = false;
    await tick();
    heading?.focus();
  }

  async function commit() {
    if (!editing) return;
    editing = false;
    void leave();
    const next = value.trim();
    if (next && next !== title) await onRename(next);
  }

  // 제목에 포커스가 있을 때 Enter·F2 로 이름 변경 시작(한글 조합 중 키는 무시)
  function onTitleKey(e: KeyboardEvent) {
    if (e.target !== e.currentTarget || e.isComposing || e.keyCode === 229 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); void start(); }
  }

  function onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); backToHeading = true; void commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); backToHeading = true; editing = false; void leave(); }
  }
</script>

{#if editing}
  <input class="doc-title-input" bind:this={input} bind:value onkeydown={onKey} onblur={commit} spellcheck="false" aria-label="문서 이름" />
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <h1 class="doc-title" bind:this={heading} tabindex={editable ? 0 : undefined} ondblclick={start} onkeydown={onTitleKey} use:tip={editable ? '더블 클릭 또는 Enter·F2: 이름 변경' : undefined}>
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
  .doc-title:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
</style>
