<script lang="ts">
  // 라벨 옆의 토글 스위치(체크박스 대신). 라벨 전체를 눌러도 바뀐다.
  import type { Snippet } from 'svelte';
  let { checked = $bindable(false), children }: { checked?: boolean; children: Snippet } = $props();
</script>

<button type="button" class="swl" role="switch" aria-checked={checked} onclick={() => (checked = !checked)}>
  <span class="track"><span class="knob"></span></span>
  <span class="lbl">{@render children()}</span>
</button>

<style>
  .swl { display: inline-flex; align-items: center; gap: 8px; padding: 2px 4px; border: 0; background: transparent; font-size: 13px; color: var(--text); white-space: nowrap; }
  .swl:hover:not(:disabled) { background: transparent; }
  .track { position: relative; flex: none; width: 34px; height: 20px; border-radius: 10px; border: 1px solid var(--border-strong); background: var(--border); transition: background 0.15s; }
  .knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); transition: transform 0.15s; }
  .swl[aria-checked='true'] .track { background: var(--primary); border-color: var(--primary); }
  .swl[aria-checked='true'] .knob { transform: translateX(14px); }
  .swl:focus-visible .track { outline: 2px solid var(--accent); outline-offset: 1px; }
  .lbl { white-space: normal; }
</style>
