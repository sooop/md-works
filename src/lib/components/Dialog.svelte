<script lang="ts">
  import { backdropFx, modalFx } from '../motion';
  import { dialog } from '../store.svelte';
  import { modal } from '../modal';

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
      // 되돌릴 수 없는 동작은 Enter 한 번으로 실행되지 않게 취소에 둔다
      btns[confirmPair && !dialog.danger ? btns.length - 1 : 0].focus();
    });
  });

  const pick = (button: number) => dialog.resolve({ button, value: dialog.value });

  // Esc·백드롭 닫기·포커스 트랩은 modal 이 맡는다. 여기서는 입력창이 있을 때의 Enter 만 처리한다
  function onKey(e: KeyboardEvent) {
    if (!dialog.open) return;
    if (e.key === 'Enter' && dialog.input && !e.isComposing) { e.preventDefault(); pick(dialog.buttons.length - 1); }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if dialog.open}
  <div class="overlay top" transition:backdropFx use:modal={{ onClose: () => pick(-1) }}>
    <div class="dialog" role="dialog" transition:modalFx aria-modal="true" aria-label={dialog.title || dialog.message}>
      {#if dialog.title}<h2>{dialog.title}</h2>{/if}
      {#if dialog.message}<p>{dialog.message}</p>{/if}
      {#if dialog.input}
        <input bind:this={inputEl} bind:value={dialog.value} spellcheck="false" />
      {/if}
      <div class="actions" bind:this={actionsEl}>
        {#each dialog.buttons as label, i}
          <button class:primary={i === dialog.buttons.length - 1} class:danger={dialog.danger && i === dialog.buttons.length - 1} onclick={() => pick(i)}>{label}</button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  /* 확대 보기·변환 창 같은 다른 모달 위에서 뜨는 확인·입력 창이라 그 아래에 깔리지 않게 한다 */
  .overlay.top { z-index: 200; }
  .dialog p { white-space: pre-wrap; overflow-wrap: anywhere; }
  .actions button.primary.danger { background: var(--danger); border-color: var(--danger); color: var(--bg); }
  .actions button.primary.danger:hover:not(:disabled) { background: var(--danger); }
</style>
