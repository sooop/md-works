<script lang="ts">
  // 툴팁을 그리는 단일 호스트(App 에 한 번만 둔다). 앵커 아래에 띄우고, 화면 밖으로 나가면 위로·안쪽으로 밀어 넣는다.
  import { tipState, hideTip } from '../tooltip.svelte';
  import { tipFx } from '../motion';

  let el = $state<HTMLElement>();
  let pos = $state({ left: 0, top: 0 });

  $effect(() => {
    const r = tipState.rect;
    void tipState.body;
    if (!r || !el) return;
    const w = el.offsetWidth, h = el.offsetHeight, gap = 8, pad = 8;
    let top = r.y + r.h + gap;
    if (top + h > innerHeight - pad) top = Math.max(pad, r.y - h - gap);
    const left = Math.min(Math.max(pad, r.x + r.w / 2 - w / 2), Math.max(pad, innerWidth - w - pad));
    pos = { left, top };
  });
</script>

<svelte:window onscrollcapture={hideTip} onblur={hideTip} />

{#if tipState.body}
  <div bind:this={el} class="tip" role="tooltip" transition:tipFx style:left="{pos.left}px" style:top="{pos.top}px">
    <div class="tip-title">{tipState.body.title}{#if tipState.body.kbd}<kbd>{tipState.body.kbd}</kbd>{/if}</div>
    {#each tipState.body.lines as l}<div class="tip-line">{l}</div>{/each}
  </div>
{/if}

<style>
  .tip {
    position: fixed; z-index: 2000; max-width: min(320px, calc(100vw - 16px)); pointer-events: none;
    padding: 6px 10px; border-radius: 8px; font-size: 12px; line-height: 1.45;
    background: var(--text); color: var(--bg); box-shadow: var(--shadow);
  }
  .tip-title { font-weight: 600; word-break: break-all; display: flex; gap: 8px; align-items: baseline; }
  .tip-line { opacity: 0.8; word-break: break-all; }
  kbd {
    font: inherit; font-size: 11px; padding: 0 5px; border-radius: 4px; opacity: 0.85;
    border: 1px solid color-mix(in srgb, currentColor 40%, transparent); white-space: nowrap;
  }
</style>
