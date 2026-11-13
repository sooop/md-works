<script lang="ts">
  // 켜짐/꺼짐을 뜻하는 설정의 토글 스위치(체크박스 대신). 라벨 전체를 눌러도 바뀐다.
  // children 을 생략하면 스위치만 그린다(라벨이 옆 칸에 따로 있을 때 — 이때는 label 로 접근 가능한 이름을 준다).
  // 여러 항목 중 고르는 체크리스트는 이걸 쓰지 않고 체크박스로 둔다.
  import type { Snippet } from 'svelte';
  import { tip, type TipContent } from '../tooltip.svelte';

  interface Props {
    checked?: boolean;
    /** md: 34×20(기본, 라벨 옆), lg: 42×24(설정 창의 행) */
    size?: 'md' | 'lg';
    disabled?: boolean;
    /** children 이 없을 때의 접근 가능한 이름 */
    label?: string;
    /** 툴팁 */
    tooltip?: TipContent;
    /** 바뀐 값으로 부른다(bind 가 먼저 갱신된 뒤) */
    onchange?: (checked: boolean) => void;
    children?: Snippet;
  }
  let { checked = $bindable(false), size = 'md', disabled = false, label, tooltip, onchange, children }: Props = $props();

  function toggle() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button type="button" class="swl" class:lg={size === 'lg'} class:bare={!children} role="switch" aria-checked={checked} aria-label={children ? undefined : label} {disabled} use:tip={tooltip} onclick={toggle}>
  <span class="track"><span class="knob"></span></span>
  {#if children}<span class="lbl">{@render children()}</span>{/if}
</button>

<style>
  .swl { display: inline-flex; align-items: center; gap: 8px; padding: 2px 4px; border: 0; background: transparent; font-size: 13px; color: var(--text); white-space: nowrap; }
  .swl:hover:not(:disabled) { background: transparent; }
  .swl.bare { padding: 0; min-width: 0; min-height: 0; }
  .track { position: relative; flex: none; width: 34px; height: 20px; border-radius: 10px; border: 1px solid var(--border-strong); background: var(--border); transition: background-color var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out); }
  .knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); transition: transform var(--dur-2) var(--ease-spring), width var(--dur-1) var(--ease-out); }
  .lg .track { width: 42px; height: 24px; border-radius: 12px; }
  .lg .knob { width: 18px; height: 18px; }
  /* 누르고 있는 동안 손잡이가 눌려 늘어난다 */
  .swl:active:not(:disabled) .knob { width: 18px; }
  .swl.lg:active:not(:disabled) .knob { width: 22px; }
  .swl[aria-checked='true']:active:not(:disabled) .knob { transform: translateX(10px); }
  .swl.lg[aria-checked='true']:active:not(:disabled) .knob { transform: translateX(14px); }
  .swl[aria-checked='true'] .track { background: var(--primary); border-color: var(--primary); }
  .swl[aria-checked='true'] .knob { transform: translateX(14px); }
  .swl.lg[aria-checked='true'] .knob { transform: translateX(18px); }
  .swl:focus-visible .track { outline: 2px solid var(--accent); outline-offset: 1px; }
  .lbl { white-space: normal; }
</style>
