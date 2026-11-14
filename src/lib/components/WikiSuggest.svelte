<script lang="ts">
  // `[[` 자동 완성 후보 목록. 커서 아래에 고정 위치로 띄운다. 키 처리는 wikilink/suggest.ts 의 플러그인이 하고, 여기는 보여 주고 마우스 선택만 받는다.
  import type { SuggestView } from '../wikilink/suggest';

  let { v, onpick }: { v: SuggestView | null; onpick: (i: number) => void } = $props();

  let panel = $state<HTMLElement>();
  let pos = $state({ left: 0, top: 0 });

  // 화면 밖으로 나가지 않게: 아래 공간이 모자라면 커서 위로
  $effect(() => {
    if (!v || !panel) return;
    const h = panel.offsetHeight, w = panel.offsetWidth;
    let top = v.y + 6;
    if (top + h > innerHeight - 8) top = Math.max(8, v.y - 26 - h);
    pos = { left: Math.max(8, Math.min(v.x, innerWidth - w - 8)), top };
  });
  $effect(() => { if (v) panel?.querySelector<HTMLElement>('.on')?.scrollIntoView({ block: 'nearest' }); });
</script>

{#if v}
  <div class="wl-suggest" role="listbox" aria-label="글 이름 후보" bind:this={panel} style:left="{pos.left}px" style:top="{pos.top}px">
    {#each v.items as c, i (c.path)}
      <!-- 눌러도 에디터가 포커스를 잃지 않게 mousedown 을 막는다 -->
      <button type="button" role="option" class="wl-item" class:on={i === v.index} aria-selected={i === v.index}
        onmousedown={(e) => { e.preventDefault(); onpick(i); }}>
        <span class="wl-name">{c.name}</span>
        {#if c.folder}<span class="wl-folder">{c.folder}</span>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .wl-suggest {
    position: fixed; z-index: 1600; box-sizing: border-box; min-width: 180px; max-width: min(360px, calc(100vw - 16px)); max-height: 260px; overflow-y: auto;
    padding: 4px; display: flex; flex-direction: column; gap: 1px;
    background: var(--surface); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: var(--shadow);
  }
  .wl-item {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px; text-align: left; width: 100%;
    border: 0; background: transparent; border-radius: 6px; padding: 5px 8px; font-size: 13px; color: var(--text);
  }
  .wl-item.on { background: var(--accent-soft); }
  .wl-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wl-folder { flex: none; font-size: 11px; color: var(--muted); max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
