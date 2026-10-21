<script lang="ts">
  import { dialog } from '../store.svelte';

  let inputEl = $state<HTMLInputElement>();

  let actionsEl = $state<HTMLDivElement>();

  // 열릴 때의 기본 포커스: 입력창이 있으면 입력창(Enter 가 확인), 없으면 확인 단추 —
  // [취소, 확인] 쌍이면 확인(마지막), 선택지가 여럿이면(저장·버리기·취소 등) 맨 앞의 기본 선택지
  $effect(() => {
    if (!dialog.open) return;
    queueMicrotask(() => {
      if (dialog.input) { inputEl?.select(); return; }
      const btns = actionsEl?.querySelectorAll('button');
      if (!btns?.length) return;
      const confirmPair = dialog.buttons.length === 2 && dialog.buttons[0] === '취소';
      btns[confirmPair ? btns.length - 1 : 0].focus();
    });
  });

  const pick = (button: number) => dialog.resolve({ button, value: dialog.value });

  function onKey(e: KeyboardEvent) {
    if (!dialog.open) return;
    if (e.key === 'Escape') { e.preventDefault(); pick(-1); }
    else if (e.key === 'Enter' && dialog.input && !e.isComposing) { e.preventDefault(); pick(dialog.buttons.length - 1); }
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
      <div class="actions" bind:this={actionsEl}>
        {#each dialog.buttons as label, i}
          <button class:primary={i === dialog.buttons.length - 1} onclick={() => pick(i)}>{label}</button>
        {/each}
      </div>
    </div>
  </div>
{/if}
