<script lang="ts">
  import { flip } from 'svelte/animate';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import { toasts, status, dismissToast, holdToast, releaseToast } from '../store.svelte';
  import { toastFx, flipFx } from '../motion';
</script>

{#if status.text}
  <div class="status" role="status" transition:toastFx><span class="spinner" aria-hidden="true"></span>{status.text}</div>
{/if}

<div class="toasts" aria-live="polite">
  {#each toasts as t (t.id)}
    <!-- 누르면 바로 닫히고, 마우스를 올려 둔 동안에는 사라지지 않는다(긴 오류 문구를 읽을 시간) -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="toast" class:error={t.kind === 'error'} role={t.kind === 'error' ? 'alert' : undefined} animate:flip={flipFx()} transition:toastFx
      onclick={() => dismissToast(t.id)} onpointerenter={() => holdToast(t.id)} onpointerleave={() => releaseToast(t.id, t.action ? 8000 : 2000)}
    >{#if t.kind === 'error'}<CircleAlert size={16} />{/if}<span>{t.text}</span>{#if t.action}
      <!-- 액션 단추는 토스트 닫기와 다르다: 누르면 동작을 실행하고 닫는다(눌러서 닫기로 번지지 않게 전파를 막는다) -->
      <button
        class="toast-action" type="button"
        onclick={(e) => { e.stopPropagation(); const run = t.action!.run; dismissToast(t.id); run(); }}
      >{t.action.label}</button>
    {/if}</div>
  {/each}
</div>
