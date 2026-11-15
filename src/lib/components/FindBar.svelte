<script lang="ts">
  import { tip } from '../tooltip.svelte';
  import { panelFx } from '../motion';
  import { tick } from 'svelte';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import X from '@lucide/svelte/icons/x';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { doc, toast } from '../store.svelte';
  import { finder, searchOpts, persistSearchOpts, ui } from '../search/state.svelte';

  let input = $state<HTMLInputElement>();
  let replInput = $state<HTMLInputElement>();
  let repl = $state(''); // 바꿀 말(검색 바를 닫았다 열어도 남는다)

  // 입력창 값은 즉시 보이되 전체 문서 탐색(finder.query)은 150ms 멈춘 뒤에 반영한다. Enter 는 즉시 반영한 뒤 다음 일치로
  let typed = $state(finder.query);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function flush() { clearTimeout(timer); timer = undefined; if (finder.query !== typed) finder.query = typed; }
  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(flush, 150);
  }
  // 바깥(Ctrl+F 선택어, 전체 검색 이동)에서 검색어가 바뀌면 입력창도 따라간다
  $effect(() => { const q = finder.query; if (q !== typed && timer === undefined) typed = q; });
  $effect(() => () => clearTimeout(timer));

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
    // Ctrl+H 로 열면 바꿀 말 입력창에서 시작한다(찾을 말이 이미 있을 때)
    void tick().then(() => {
      const el = ui.replaceOpen && finder.query && replInput ? replInput : input;
      el?.focus(); el?.select();
    });
  });

  function close() {
    flush();
    ui.findOpen = false;
    finder.jump = null;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); flush(); if (e.shiftKey) finder.ctl?.prev(); else finder.ctl?.next(); }
  }

  // 일치가 상한을 넘었거나 검색이 오래 걸려 일부만 표시하는 중(Editor 가 finder 에 실어 준다)
  const notice = $derived(finder.notice);
  const canReplace = $derived(doc.edit && !!finder.total && !finder.error);

  // 입력창의 아직 반영되지 않은 검색어까지 에디터에 넘긴 뒤 바꾼다
  function ready() {
    flush();
    finder.ctl?.setQuery(finder.query, { caseSensitive: searchOpts.caseSensitive, regex: searchOpts.regex });
    return finder.ctl;
  }
  function replaceOne() {
    if (!canReplace) return;
    ready()?.replaceCurrent(repl);
  }
  function replaceAll() {
    if (!canReplace) return;
    const r = ready()?.replaceAll(repl);
    if (!r) return;
    toast(r.partial ? `일부(${r.count}곳)만 바꿨습니다. 다시 실행해 주세요` : `${r.count}곳을 바꿨습니다`);
  }
  function onReplKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey || e.metaKey) replaceAll(); else replaceOne(); }
  }
  const status = $derived(
    finder.error ? finder.error
      : !finder.query ? ''
      : finder.total ? `${finder.current + 1} / ${finder.total}${notice ? '+' : ''}` : '결과 없음',
  );
</script>

{#if ui.findOpen}
  <div class="findbar-anchor" transition:panelFx={{ side: 'right' }}>
  <div class="findbar" role="search">
    <button
      class="icon-btn fold" class:open={ui.replaceOpen} use:tip={'바꾸기 펼치기 (Ctrl+H)'} aria-label="바꾸기 펼치기"
      aria-expanded={ui.replaceOpen} onclick={() => { ui.replaceOpen = !ui.replaceOpen; }}
    ><ChevronRight size={16} /></button>
    <input
      bind:this={input}
      bind:value={typed}
      oninput={onInput}
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
    <span class="count" class:err={!!finder.error} use:tip={finder.error || notice}>{status}</span>
    <button class="icon-btn" use:tip={'이전 (Shift+Enter)'} aria-label="이전 일치" disabled={!finder.total} onclick={() => finder.ctl?.prev()}><ChevronUp size={16} /></button>
    <button class="icon-btn" use:tip={'다음 (Enter)'} aria-label="다음 일치" disabled={!finder.total} onclick={() => finder.ctl?.next()}><ChevronDown size={16} /></button>
    <button class="icon-btn" use:tip={'닫기 (Esc)'} aria-label="검색 닫기" onclick={close}><X size={16} /></button>
    {#if ui.replaceOpen}
      <div class="rrow">
        <input
          bind:this={replInput}
          bind:value={repl}
          onkeydown={onReplKey}
          placeholder="바꿀 말"
          aria-label="바꿀 말"
          spellcheck="false"
        />
        <button class="rbtn" disabled={!canReplace} use:tip={doc.edit ? '바꾸고 다음으로 (Enter)' : '읽기 모드에서는 바꿀 수 없습니다'} onclick={replaceOne}>바꾸기</button>
        <button class="rbtn" disabled={!canReplace} use:tip={doc.edit ? '모두 바꾸기 (Ctrl+Enter)' : '읽기 모드에서는 바꿀 수 없습니다'} onclick={replaceAll}>모두 바꾸기</button>
      </div>
    {/if}
  </div>
  </div>
{/if}

<style>
  .findbar { flex-wrap: wrap; row-gap: 4px; }
  .fold :global(svg) { transition: transform var(--dur-1, 0.12s) ease; }
  .fold.open :global(svg) { transform: rotate(90deg); }
  .rrow { flex: 0 0 100%; display: flex; align-items: center; gap: 4px; padding-left: 24px; box-sizing: border-box; }
  .rrow input {
    flex: 1; min-width: 0; border: 1px solid var(--border-strong); border-radius: 4px; outline: 0;
    background: var(--bg); color: var(--text); font: inherit; font-size: 13px; padding: 3px 6px;
  }
  .rrow input:focus { border-color: var(--accent); box-shadow: var(--ring); }
  .rbtn {
    flex: none; border: 1px solid var(--border-strong); background: transparent; color: var(--text);
    border-radius: 4px; padding: 3px 7px; font-size: 12px; white-space: nowrap;
  }
  .rbtn:hover:not(:disabled) { background: var(--hover); }
  .rbtn:disabled { opacity: 0.45; }
</style>
