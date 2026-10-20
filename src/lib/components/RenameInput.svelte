<script lang="ts">
  // 목록 항목 이름을 그 자리에서 고치는 입력. Enter·바깥 클릭은 확정, Esc 는 취소(한글 조합 중 Enter 는 무시).
  import { onMount } from 'svelte';
  let { value, onCommit, onCancel }: { value: string; onCommit: (v: string) => void; onCancel: () => void } = $props();
  // svelte-ignore state_referenced_locally
  let draft = $state(value); // 편집을 시작할 때의 이름으로만 채운다
  let el = $state<HTMLInputElement>();
  let done = false;
  onMount(() => { el?.focus(); el?.select(); });
  function finish(ok: boolean) {
    if (done) return;
    done = true;
    const v = draft.trim();
    if (ok && v && v !== value) onCommit(v); else onCancel();
  }
  function onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  }
</script>

<input class="rename-input" bind:this={el} bind:value={draft} onkeydown={onKey} onblur={() => finish(true)} onclick={(e) => e.stopPropagation()} spellcheck="false" aria-label="새 이름" />

<style>
  .rename-input {
    flex: 1; min-width: 0; font: inherit; font-size: 14px; padding: 2px 6px; margin: 1px 0;
    color: var(--text); background: var(--surface); border: 1px solid var(--accent); border-radius: 6px;
  }
</style>
