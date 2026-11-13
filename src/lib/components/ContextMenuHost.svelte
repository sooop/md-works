<script lang="ts">
  // 우클릭 메뉴를 그리는 단일 호스트(App 에 한 번만 둔다). 바깥 클릭·Esc·스크롤·창 전환으로 닫는다.
  // 키: ↑/↓ 이동(끝에서 돌아감), Home/End, Esc 는 닫고 메뉴를 연 요소로 포커스 복귀, Tab 은 닫는다.
  import { tick } from 'svelte';
  import { ctx, closeContextMenu } from '../contextmenu.svelte';
  import { hideTip } from '../tooltip.svelte';
  import { popFx } from '../motion';

  let el = $state<HTMLElement>();
  let pos = $state({ left: 0, top: 0 });

  $effect(() => {
    if (!ctx.open) return;
    hideTip();
    const { x, y } = ctx;
    void tick().then(() => {
      if (!el) return;
      pos = {
        left: Math.max(4, Math.min(x, innerWidth - el.offsetWidth - 4)),
        top: Math.max(4, Math.min(y, innerHeight - el.offsetHeight - 4)),
      };
      el.querySelector<HTMLElement>('button')?.focus();
    });
  });

  function onKey(e: KeyboardEvent) {
    if (!ctx.open) return;
    if (e.key === 'Escape') { e.preventDefault(); closeContextMenu(true); return; }
    if (e.key === 'Tab') { closeContextMenu(true); e.preventDefault(); return; }
    if (e.isComposing || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const btns = [...(el?.querySelectorAll<HTMLElement>('button') ?? [])];
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement as HTMLElement);
    const n = btns.length;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    btns[to]?.focus();
  }
  function run(fn: () => void | Promise<void>) {
    closeContextMenu();
    void fn();
  }
</script>

<svelte:window onkeydown={onKey} onblur={() => closeContextMenu()} onresize={() => closeContextMenu()} onscrollcapture={() => closeContextMenu()} onpointerdowncapture={(e) => { if (ctx.open && !el?.contains(e.target as Node)) closeContextMenu(); }} />

{#if ctx.open}
  <div bind:this={el} class="ctx-menu" role="menu" tabindex="-1" transition:popFx style:left="{pos.left}px" style:top="{pos.top}px" oncontextmenu={(e) => e.preventDefault()}>
    {#each ctx.items as it}
      {#if it.sep}<hr />{/if}
      <button role="menuitem" class:danger={it.danger} onclick={() => run(it.run)}>{it.label}</button>
    {/each}
  </div>
{/if}

<style>
  .ctx-menu {
    position: fixed; z-index: 90; min-width: 150px; padding: 4px; display: flex; flex-direction: column; gap: 2px;
    background: var(--surface); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: var(--shadow);
    -webkit-touch-callout: none;
  }
  .ctx-menu button { text-align: left; border: 0; background: transparent; padding: 6px 10px; border-radius: 6px; }
  .ctx-menu button.danger { color: var(--danger); }
  .ctx-menu hr { border: 0; border-top: 1px solid var(--border); margin: 2px 0; }
</style>
