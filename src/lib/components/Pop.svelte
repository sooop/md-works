<script lang="ts">
  // 아이콘 버튼 따위의 트리거 아래에 뜨는 팝오버. 패널은 fixed 로 띄워 스크롤하는 사이드바 안에서도 잘리지 않는다.
  // 바깥을 누르거나 Esc 를 누르면 닫히고, Esc 로 닫으면 트리거로 포커스가 돌아간다.
  import { tick, type Snippet } from 'svelte';
  import { popFx } from '../motion';

  interface Props {
    open?: boolean;
    label: string;
    width?: number;
    trigger: Snippet<[{ open: boolean; toggle: () => void }]>;
    children: Snippet<[{ close: () => void }]>;
  }
  let { open = $bindable(false), label, width = 260, trigger, children }: Props = $props();

  let wrap = $state<HTMLElement>();
  let panel = $state<HTMLElement>();
  let pos = $state({ left: 0, top: 0 });

  const toggle = () => { open = !open; };
  const close = () => { open = false; };

  $effect(() => {
    if (!open || !wrap) return;
    const r = wrap.getBoundingClientRect();
    void tick().then(() => {
      const h = panel?.offsetHeight ?? 0;
      const w = Math.min(width, innerWidth - 16);
      let top = r.bottom + 6;
      if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
      pos = { left: Math.max(8, Math.min(r.left, innerWidth - w - 8)), top };
    });
  });

  function onKey(e: KeyboardEvent) {
    if (!open || e.key !== 'Escape' || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    close();
    wrap?.querySelector<HTMLElement>('button')?.focus();
  }
</script>

<svelte:window onkeydowncapture={onKey} />

<span class="pop-wrap" bind:this={wrap}>{@render trigger({ open, toggle })}</span>
{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="pop-backdrop" onpointerdown={close}></div>
  <div bind:this={panel} class="pop-panel" role="dialog" transition:popFx aria-label={label} style:left="{pos.left}px" style:top="{pos.top}px" style:width="min({width}px, calc(100vw - 16px))">
    {@render children({ close })}
  </div>
{/if}

<style>
  .pop-wrap { display: inline-flex; }
  .pop-backdrop { position: fixed; inset: 0; z-index: 1500; }
  .pop-panel {
    position: fixed; z-index: 1501; box-sizing: border-box; padding: 6px; display: flex; flex-direction: column; gap: 2px;
    background: var(--surface); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: var(--shadow);
  }
  /* 팝오버 안의 공용 항목 모양: 아이콘 + 제목 + 설명 */
  .pop-panel :global(.pop-row) {
    display: flex; align-items: center; gap: 10px; text-align: left; border: 0; background: transparent; padding: 8px 10px; border-radius: 8px; width: 100%;
  }
  .pop-panel :global(.pop-row:hover) { background: var(--hover); }
  .pop-panel :global(.pop-row.on) { background: var(--accent-soft); }
  .pop-panel :global(.pop-row .txt) { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .pop-panel :global(.pop-row small) { color: var(--muted); font-size: 11.5px; line-height: 1.35; }
</style>
