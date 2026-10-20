<script lang="ts">
  // 서버 응답이 0.5초 넘게 걸릴 때 화면 맨 위에 흐르는 얇은 진행 표시줄(끝을 알 수 없는 형태)
  import { net } from '../netBusy.svelte';
</script>

{#if net.slow}
  <div class="busybar" role="progressbar" aria-label="불러오는 중" aria-busy="true"><span></span></div>
{/if}

<style>
  .busybar { position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 200; overflow: hidden; background: color-mix(in srgb, var(--accent) 18%, transparent); pointer-events: none; }
  .busybar span {
    position: absolute; top: 0; bottom: 0; width: 35%; border-radius: 2px; background: var(--accent);
    animation: busy-slide 1.1s ease-in-out infinite;
  }
  @keyframes busy-slide { 0% { left: -35%; } 100% { left: 100%; } }
  @media (prefers-reduced-motion: reduce) { .busybar span { width: 100%; animation: busy-pulse 1.4s ease-in-out infinite; } @keyframes busy-pulse { 50% { opacity: 0.35; } } }
</style>
