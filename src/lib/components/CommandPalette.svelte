<script lang="ts">
  import { backdropFx, modalFx } from '../motion';
  // 명령 팔레트: Ctrl+K 또는 Ctrl+Space 로 열어 이름(초성 가능)으로 명령·단축키·메뉴·서식·글을 찾아 실행한다.
  // ↑↓ 선택, Enter 실행, Esc 닫기. 검색어가 없으면 명령만, 있으면 글 이동도 함께 검색한다.
  import { tick } from 'svelte';
  import Search from '@lucide/svelte/icons/search';
  import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
  import { palette, closePalette, togglePalette, type Command } from '../commands/registry.svelte';
  import { rankCommands } from '../commands/rank';
  import { tip } from '../tooltip.svelte';

  let { commands, docCommands }: { commands: () => Command[]; docCommands: () => Command[] } = $props();

  let query = $state('');
  let sel = $state(0);
  let inputEl = $state<HTMLInputElement>();
  let listEl = $state<HTMLElement>();

  const MAX = 60;
  const results = $derived.by(() => {
    if (!palette.open) return [];
    const base = commands().filter((c) => !c.when || c.when());
    const all = query.trim() ? [...base, ...docCommands()] : base;
    return rankCommands(all, query).slice(0, MAX);
  });
  // 검색어가 바뀌면 맨 위부터
  $effect(() => { void query; sel = 0; });
  // 열릴 때 입력창에 포커스, 닫히면 검색어를 비운다
  $effect(() => {
    if (palette.open) void tick().then(() => inputEl?.focus());
    else query = '';
  });

  function run(c: Command | undefined) {
    if (!c) return;
    closePalette();
    // 팔레트가 닫히며 포커스가 돌아간 뒤에 실행해야 편집기 명령이 편집기에 먹는다
    setTimeout(() => { void c.run(); }, 0);
  }

  function scrollToSel() {
    void tick().then(() => listEl?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  }
  function onInputKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, results.length - 1); scrollToSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); scrollToSel(); }
    else if (e.key === 'Home' && !query) { e.preventDefault(); sel = 0; scrollToSel(); }
    else if (e.key === 'End' && !query) { e.preventDefault(); sel = results.length - 1; scrollToSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(results[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
  }

  // 전역 단축키: Ctrl+K, Ctrl+Space (한글 조합 중에는 건드리지 않는다)
  function onKey(e: KeyboardEvent) {
    if (e.isComposing || e.altKey || e.shiftKey || !(e.ctrlKey || e.metaKey)) return;
    if (e.key.toLowerCase() === 'k' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); togglePalette(); }
  }
</script>

<svelte:window onkeydowncapture={onKey} />

{#if palette.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay cp-overlay" transition:backdropFx onclick={(e) => { if (e.target === e.currentTarget) closePalette(); }}>
    <div class="cp" role="dialog" transition:modalFx aria-modal="true" aria-label="명령 팔레트">
      <div class="cp-input">
        <Search size={16} />
        <input
          bind:this={inputEl} bind:value={query} onkeydown={onInputKey}
          role="combobox" aria-expanded="true" aria-controls="cp-list" aria-activedescendant={results[sel] ? `cp-${sel}` : undefined} aria-autocomplete="list"
          placeholder="명령이나 글 이름을 입력하세요 (초성 가능)" spellcheck="false" autocomplete="off"
        />
        <kbd>Esc</kbd>
      </div>
      <ul class="cp-list" id="cp-list" role="listbox" bind:this={listEl}>
        {#each results as c, i (c.id)}
          {#if i === 0 || results[i - 1].group !== c.group}<li class="cp-group" role="presentation">{c.group}</li>{/if}
          <li id={`cp-${i}`} role="option" aria-selected={i === sel} class:sel={i === sel}
            onmousemove={() => { if (sel !== i) sel = i; }} onclick={() => run(c)}>
            <span class="t">{c.title}</span>
            {#if c.shortcut}<kbd class="sc">{c.shortcut}</kbd>{/if}
            {#if i === sel}<CornerDownLeft size={13} class="ret" />{/if}
          </li>
        {:else}
          <li class="cp-none" role="presentation">'{query}' 와 맞는 명령이 없습니다.</li>
        {/each}
      </ul>
      <div class="cp-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 이동</span><span><kbd>Enter</kbd> 실행</span><span class="hint">Ctrl+K · Ctrl+Space</span></div>
    </div>
  </div>
{/if}

<style>
  .cp-overlay { align-items: start; padding-top: 12vh; background: rgba(20, 20, 19, 0.35); }
  .cp {
    width: min(620px, calc(100vw - 24px)); max-height: min(560px, 76vh); display: flex; flex-direction: column;
    background: var(--bg); border: 1px solid var(--border-strong); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden;
  }
  .cp-input { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--border); color: var(--muted); }
  .cp-input input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--text); font: inherit; font-size: 15px; }
  kbd { font: inherit; font-size: 11px; padding: 1px 6px; border-radius: 5px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--muted); white-space: nowrap; }
  .cp-list { list-style: none; margin: 0; padding: 6px; overflow: auto; flex: 1; min-height: 0; }
  .cp-group { padding: 8px 10px 3px; font-size: 11.5px; font-weight: 600; color: var(--muted); letter-spacing: 0.02em; }
  .cp-list li[role='option'] { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 8px; cursor: pointer; }
  .cp-list li.sel { background: var(--accent-soft); }
  .cp-list .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cp-list .sc { margin-left: auto; }
  .cp-list :global(.ret) { color: var(--muted); flex: none; }
  .cp-none { padding: 22px 12px; color: var(--muted); text-align: center; }
  .cp-foot { display: flex; align-items: center; gap: 14px; padding: 7px 14px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); }
  .cp-foot .hint { margin-left: auto; }
  @media (max-width: 720px) { .cp-overlay { padding-top: 4vh; } .cp-foot { display: none; } }
</style>
