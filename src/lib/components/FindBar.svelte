<script lang="ts">
  import { tip } from '../tooltip.svelte';
  import { panelFx } from '../motion';
  import { tick } from 'svelte';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import X from '@lucide/svelte/icons/x';
  import { finder, searchOpts, persistSearchOpts, ui } from '../search/state.svelte';

  let input = $state<HTMLInputElement>();

  // 검색어·옵션·에디터가 바뀌면 다시 찾는다. 전체 검색에서 넘어온 경우 n번째 일치로 이동한다.
  $effect(() => {
    const ctl = finder.ctl;
    if (!ctl) return;
    const query = ui.findOpen ? finder.query : '';
    ctl.setQuery(query, { caseSensitive: searchOpts.caseSensitive, regex: searchOpts.regex });
    const jump = finder.jump;
    // 이동할 문서의 에디터가 준비된 뒤에만 처리한다(문서를 여는 동안 이전 에디터가 먼저 받지 않도록)
    if (jump && ui.findOpen && finder.ctlPath === jump.id) {
      finder.jump = null;
      ctl.goto(jump.nth);
    }
  });

  $effect(() => {
    ui.findFocus;
    void tick().then(() => { input?.focus(); input?.select(); });
  });

  function close() {
    ui.findOpen = false;
    finder.jump = null;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) finder.ctl?.prev(); else finder.ctl?.next(); }
  }

  const status = $derived(
    finder.error ? finder.error
      : !finder.query ? ''
      : finder.total ? `${finder.current + 1} / ${finder.total}` : '결과 없음',
  );
</script>

{#if ui.findOpen}
  <div class="findbar-anchor" transition:panelFx={{ side: 'right' }}>
  <div class="findbar" role="search">
    <input
      bind:this={input}
      bind:value={finder.query}
      onkeydown={onKey}
      placeholder="문서에서 찾기"
      aria-label="문서에서 찾기"
      spellcheck="false"
      class:invalid={!!finder.error}
    />
    <button
      class="toggle" class:on={searchOpts.caseSensitive} use:tip={'대소문자 구분'} aria-label="대소문자 구분" aria-pressed={searchOpts.caseSensitive}
      onclick={() => { searchOpts.caseSensitive = !searchOpts.caseSensitive; persistSearchOpts(); }}
    >Aa</button>
    <button
      class="toggle" class:on={searchOpts.regex} use:tip={'정규식'} aria-label="정규식" aria-pressed={searchOpts.regex}
      onclick={() => { searchOpts.regex = !searchOpts.regex; persistSearchOpts(); }}
    >.*</button>
    <span class="count" class:err={!!finder.error} use:tip={finder.error}>{status}</span>
    <button class="icon-btn" use:tip={'이전 (Shift+Enter)'} aria-label="이전 일치" disabled={!finder.total} onclick={() => finder.ctl?.prev()}><ChevronUp size={16} /></button>
    <button class="icon-btn" use:tip={'다음 (Enter)'} aria-label="다음 일치" disabled={!finder.total} onclick={() => finder.ctl?.next()}><ChevronDown size={16} /></button>
    <button class="icon-btn" use:tip={'닫기 (Esc)'} aria-label="검색 닫기" onclick={close}><X size={16} /></button>
  </div>
  </div>
{/if}
