<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Pin from '@lucide/svelte/icons/pin';
  import PinOff from '@lucide/svelte/icons/pin-off';
  import Library from '@lucide/svelte/icons/library';
  import Palette from '@lucide/svelte/icons/palette';
  import Check from '@lucide/svelte/icons/check';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import SnippetCard from './SnippetCard.svelte';
  import Pop from './Pop.svelte';
  import { tip } from '../tooltip.svelte';
  import { doc, toast, errMsg, settings } from '../store.svelte';
  import { SNIPPET_COLORS } from '../works/types';
  import { COLOR_HEX } from '../snippets/colors';
  import { snippetText } from '../snippets/filter';
  import { preview } from '../snippets/preview';
  import { imageToDataUrl } from '../snippets/image';
  import {
    sn, reload, visible, addSnippet, canReorder, reorderHint, setSelectMode, clearSelection, pruneSelected,
    bulkColor, bulkTrash, bulkDetach, moveStep, moveTo,
  } from '../snippets/state.svelte';
  import { right } from '../rightbar/state.svelte';
  import { rightPeek } from '../sidebar/state.svelte';

  let input = $state<HTMLTextAreaElement>();
  let searchInput = $state<HTMLInputElement>();
  let viewOpen = $state(false);
  let searchOpen = $state(false);
  let colorOpen = $state(false);
  let moreOpen = $state(false);
  let text = $state('');
  let busy = $state(false);
  const list = $derived(visible());
  const phraseMode = $derived(!!sn.phrase.trim());
  const filtering = $derived(!!(sn.phrase.trim() || sn.query.trim()));
  const anyFilter = $derived(filtering || !!sn.color);
  function clearFilters() { sn.phrase = ''; sn.query = ''; sn.color = ''; }
  const RESULTS_MAX = 8;
  /** 찾기 팝오버 안의 결과 미리보기: 일치 부분 근처만 보여 준다(아래 목록은 같은 검색으로 걸러져 있다) */
  const results = $derived(
    !filtering ? [] : list.slice(0, RESULTS_MAX).map((s) => ({ s, parts: preview(snippetText(s).replace(/^#\s+/m, ''), phraseMode ? '' : sn.query) })),
  );
  /** 결과를 고르면 팝오버를 닫고 그 카드를 펼쳐 보여 준다 */
  async function reveal(id: string, close: () => void) {
    close();
    sn.openId = id;
    sn.anchor = id;
    await tick();
    await tick();
    listEl?.querySelector(`[data-sn-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  const colorsOn = $derived(settings.snippetColors);
  // 색 기능을 끄면 걸려 있던 색 필터도 푼다(보이지 않는 필터가 목록을 줄이지 않게)
  $effect(() => { if (!colorsOn && sn.color) sn.color = ''; });


  const reorderable = $derived(canReorder());
  const hint = $derived(reorderHint());
  const trashView = $derived(sn.view === 'trash' && !phraseMode);

  // 보기·필터·글이 바뀌면 선택을 비운다. 목록에서 사라진 카드는 선택에서 뺀다
  let viewSig = '';
  $effect(() => {
    const next = [sn.view, sn.color, sn.query, sn.phrase, doc.path].join('\u0000');
    if (viewSig && next !== viewSig) clearSelection();
    viewSig = next;
  });
  $effect(() => {
    void list.map((s) => s.id).join(',');
    if (sn.loaded) untrack(() => pruneSelected());
  });

  // ---- 드래그로 순서 바꾸기: 포인터 위치로 삽입 위치(카드 사이)를 정한다 ----
  let listEl = $state<HTMLDivElement>();
  function slotAt(y: number): number {
    const cards = [...(listEl?.querySelectorAll<HTMLElement>('[data-sn-id]') ?? [])];
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return cards.length;
  }
  function onDragOver(e: DragEvent) {
    if (!sn.dragIds.length || !reorderable) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    sn.dropIndex = slotAt(e.clientY);
  }
  function onDropList(e: DragEvent) {
    if (!sn.dragIds.length) return;
    e.preventDefault();
    const moving = sn.dragIds;
    const at = reorderable ? slotAt(e.clientY) : -1;
    sn.dragIds = [];
    sn.dropIndex = -1;
    if (at >= 0) void moveTo(moving, at);
  }
  function onDragLeave(e: DragEvent) {
    if (!listEl?.contains(e.relatedTarget as Node | null)) sn.dropIndex = -1;
  }
  const dropMark = (i: number): '' | 'before' | 'after' =>
    !sn.dragIds.length ? '' : sn.dropIndex === i ? 'before' : sn.dropIndex === list.length && i === list.length - 1 ? 'after' : '';

  // Esc: 선택 모드 종료, 그다음엔 선택 해제 (입력 중일 때는 건드리지 않는다)
  function onPanelKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest('textarea, input:not([type="checkbox"])')) return;
    if (sn.selectMode) { setSelectMode(false); e.preventDefault(); }
    else if (sn.selected.length) { clearSelection(); e.preventDefault(); }
  }

  onMount(() => {
    void reload(); // 단축키·선택 추적은 셸의 SnippetShortcuts 가 맡는다
  });
  // 탭을 열 때마다 다시 읽는다 (다른 기능이 글감을 만들었을 수 있다)
  $effect(() => { if ((right.open || rightPeek.open) && right.tab === 'snippets') void reload(); });
  $effect(() => { sn.focusInput; if (sn.focusInput) void tick().then(() => input?.focus()); });
  // Ctrl+Alt+G(본문 문구로 찾기): 찾기 팝오버를 연다
  $effect(() => { if (sn.focusPhrase) searchOpen = true; });
  // 찾기 팝오버가 열리면(버튼·단축키 모두) 입력에 바로 포커스
  $effect(() => {
    if (!searchOpen) return;
    void tick().then(() => tick()).then(() => { searchInput?.focus(); searchInput?.select(); });
  });

  async function add() {
    const body = text.trim();
    if (!body || busy) return;
    // 제목(# )·원전(@ 또는 URL 줄)·인용(> )은 쓴 그대로 저장하고 카드를 그릴 때 알아본다
    if (await addSnippet(body)) text = '';
  }
  function onKey(e: KeyboardEvent) {
    // 한글 조합 중 Enter 는 글자 확정이므로 추가하지 않는다
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void add(); }
  }

  function insertAtCursor(snippet: string) {
    const el = input;
    const a = el?.selectionStart ?? text.length;
    const b = el?.selectionEnd ?? text.length;
    text = text.slice(0, a) + snippet + text.slice(b);
  }
  async function addImages(files: File[]) {
    busy = true;
    try {
      for (const f of files) insertAtCursor(`![](${await imageToDataUrl(f)})\n`);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally { busy = false; }
  }
  function onPaste(e: ClipboardEvent) {
    const imgs = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (imgs.length) { e.preventDefault(); void addImages(imgs); }
  }
  function onDrop(e: DragEvent) {
    const imgs = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    e.preventDefault();
    e.stopPropagation();
    void addImages(imgs);
  }

  const views = [
    { id: 'doc', label: '이 글에 꽂힌 글감', desc: '지금 글에 핀으로 꽂아 둔 글감. 끌어서 순서를 바꿉니다', icon: Pin },
    { id: 'all', label: '모든 글감', desc: '보관함의 글감 전체. 여기서 글에 핀을 꽂습니다', icon: Library },
    { id: 'trash', label: '휴지통', desc: '삭제한 글감. 복구하면 원래 글에 다시 꽂힙니다', icon: Trash2 },
  ] as const;
  const currentView = $derived(views.find((v) => v.id === sn.view) ?? views[0]);
  const emptyMsg = $derived(
    phraseMode ? '관련된 글감이 없습니다.'
    : sn.query.trim() || sn.color ? '조건에 맞는 글감이 없습니다.'
    : sn.view === 'trash' ? '휴지통이 비어 있습니다.'
    : sn.view === 'doc' ? (doc.path ? '이 글에 꽂힌 글감이 없습니다. 위에서 적거나 모든 글감에서 핀을 꽂으세요.' : '문서를 열면 이 글에 꽂힌 글감이 보입니다.')
    : '글감이 없습니다. 위 입력창에 적고 Enter 를 누르세요.',
  );
  const hasMore = $derived(!trashView && (colorsOn || reorderable));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sn-panel" onkeydown={onPanelKey}>
  <div class="sn-quick">
    <textarea
      bind:this={input}
      bind:value={text}
      onkeydown={onKey}
      onpaste={onPaste}
      ondragover={(e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); }}
      ondrop={onDrop}
      rows="2"
      placeholder="글감을 적고 Enter  ( # 제목 · @출처 · > 인용 )"
      aria-label="새 글감"
    ></textarea>
    <div class="sn-row">
      <span class="spacer"></span>
      <!-- 키보드가 없는 터치 폭에서만 보이는 글자 버튼(아이콘 없음) — 데스크톱은 Enter 로 붙인다 -->
      <button class="sn-add-m" disabled={!text.trim() || busy} onclick={add}>글감 담기</button>
    </div>
  </div>

  <div class="sn-toolbar" role="toolbar" aria-label="글감 보기·찾기">
    <Pop bind:open={viewOpen} label="글감 보기 선택" width={300}>
      {#snippet trigger({ toggle, open })}
        <button class="icon-btn" class:on={open} aria-haspopup="dialog" aria-expanded={open} aria-label="보기 전환: {currentView.label}" disabled={phraseMode}
          use:tip={{ title: currentView.label, lines: [phraseMode ? '문구 찾기 중에는 모든 글감에서 찾습니다' : '눌러서 보기 바꾸기'] }} onclick={toggle}><currentView.icon size={17} /></button>
      {/snippet}
      {#snippet children({ close })}
        {#each views as v (v.id)}
          <button class="pop-row" class:on={sn.view === v.id} onclick={() => { sn.view = v.id; close(); }}>
            <v.icon size={18} />
            <span class="txt"><b>{v.label}</b><small>{v.desc}</small></span>
            {#if sn.view === v.id}<Check size={15} />{/if}
          </button>
        {/each}
      {/snippet}
    </Pop>

    <Pop bind:open={searchOpen} label="글감 찾기" width={360}>
      {#snippet trigger({ toggle, open })}
        <button class="icon-btn" class:on={open || filtering} aria-haspopup="dialog" aria-expanded={open} aria-label="글감 찾기"
          use:tip={{ title: filtering ? '찾는 중' : '글감 찾기', lines: [phraseMode ? '본문 문구와의 관련도순' : sn.query.trim() ? `"${sn.query.trim()}"` : '본문·원전 검색 (초성 가능)'], kbd: 'Ctrl+Alt+G' }} onclick={toggle}>
          <Search size={17} />{#if filtering}<span class="on-dot" aria-hidden="true"></span>{/if}
        </button>
      {/snippet}
      {#snippet children({ close })}
        <div class="sn-search">
          <Search size={14} />
          {#if phraseMode}<span class="chip">관련도순</span>{/if}
          <input
            bind:this={searchInput}
            value={phraseMode ? sn.phrase : sn.query}
            oninput={(e) => { if (phraseMode) sn.phrase = e.currentTarget.value; else sn.query = e.currentTarget.value; }}
            onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) close(); }}
            placeholder={phraseMode ? '본문 문구와 관련된 글감' : '글감 검색 (본문·원전, 초성 가능)'}
            aria-label="글감 찾기" spellcheck="false"
          />
          {#if phraseMode ? sn.phrase : sn.query}
            <button class="icon-btn" aria-label="지우기" use:tip={'지우기'} onclick={() => { if (phraseMode) sn.phrase = ''; else sn.query = ''; searchInput?.focus(); }}><X size={14} /></button>
          {/if}
        </div>
        {#if filtering}
          {#if results.length}
            <ul class="sn-results" aria-label="찾은 글감">
              {#each results as r (r.s.id)}
                <li><button class="sn-result" style:--c={COLOR_HEX[r.s.color]} onclick={() => void reveal(r.s.id, close)}>
                  <span class="sn-result-txt">{#each r.parts as p}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}</span>
                </button></li>
              {/each}
            </ul>
            <p class="sn-pophint">{list.length > results.length ? `${list.length}개 중 ${results.length}개 · ` : `${list.length}개 · `}닫으면(Enter) 아래 목록에 찾은 글감만 남습니다.</p>
          {:else}
            <p class="sn-pophint">일치하는 글감이 없습니다.</p>
          {/if}
        {:else}
          <p class="sn-pophint">본문에서 문장을 고르고 <kbd>Ctrl+Alt+G</kbd> 를 누르면 그 문장과 관련된 글감을 관련도순으로 찾습니다.</p>
        {/if}
      {/snippet}
    </Pop>

    {#if anyFilter}
      <button class="icon-btn sn-clear" aria-label="필터 해제" use:tip={{ title: '필터 해제', lines: ['찾기·색 조건을 모두 풀고 전체 목록으로'] }} onclick={clearFilters}><X size={13} /></button>
    {/if}

    {#if colorsOn}
      <Pop bind:open={colorOpen} label="색으로 거르기" width={220}>
        {#snippet trigger({ toggle, open })}
          <button class="icon-btn" class:on={open || !!sn.color} aria-haspopup="dialog" aria-expanded={open} aria-label="색으로 거르기" disabled={phraseMode}
            use:tip={{ title: sn.color ? `색: ${sn.color}` : '색으로 거르기' }} onclick={toggle}>
            {#if sn.color}<span class="sn-swatch" style:--c={COLOR_HEX[sn.color]}></span>{:else}<Palette size={17} />{/if}
          </button>
        {/snippet}
        {#snippet children({ close })}
          <button class="pop-row" class:on={!sn.color} onclick={() => { sn.color = ''; close(); }}><span class="txt"><b>모든 색</b></span>{#if !sn.color}<Check size={15} />{/if}</button>
          <div class="sn-swatches">
            {#each SNIPPET_COLORS as c}
              <button class="dot" class:on={sn.color === c} style:--c={COLOR_HEX[c]} use:tip={c} aria-label={`색: ${c}`} aria-pressed={sn.color === c} onclick={() => { sn.color = sn.color === c ? '' : c; close(); }}></button>
            {/each}
          </div>
        {/snippet}
      </Pop>
    {/if}

    <span class="spacer"></span>
    <span class="sn-count" aria-live="polite">{list.length}</span>
    <button
      class="icon-btn" class:on={sn.selectMode} aria-pressed={sn.selectMode}
      aria-label={sn.selectMode ? '선택 모드 끄기' : '선택 모드 켜기'}
      use:tip={{ title: '선택 모드', lines: ['카드를 눌러 여러 장을 고릅니다', 'Ctrl/Shift+클릭도 가능 · Esc 로 종료'] }}
      onclick={() => setSelectMode(!sn.selectMode)}
    ><ListChecks size={17} /></button>
  </div>
  {#if phraseMode}
    <p class="sn-note">모든 글감을 본문 문구와의 관련도 순으로 보여 줍니다.</p>
  {:else if sn.view === 'doc' && !reorderable && doc.path}
    <p class="sn-note">{hint}</p>
  {/if}

  {#if sn.selected.length}
    <div class="sn-selbar" role="toolbar" aria-label="선택한 글감 일괄 작업">
      <strong>{sn.selected.length}개 선택</strong>
      <span class="spacer"></span>
      {#if sn.view === 'doc' && !phraseMode && doc.path}
        <button aria-label="선택한 글감의 핀 떼기" use:tip={{ title: '핀 떼기', lines: ['이 글에서만 빼고 글감은 남깁니다'] }} onclick={bulkDetach}><PinOff size={14} /> 핀 떼기</button>
      {/if}
      {#if !trashView}
        <button class="danger" aria-label="선택한 글감 삭제" use:tip={{ title: '삭제', lines: ['휴지통으로 보냅니다 (복구할 수 있습니다)'] }} onclick={bulkTrash}><Trash2 size={14} /> 삭제</button>
      {/if}
      {#if hasMore}
        <Pop bind:open={moreOpen} label="선택한 글감 더 보기" width={220}>
          {#snippet trigger({ toggle, open })}
            <button class="icon-btn" class:on={open} aria-haspopup="dialog" aria-expanded={open} aria-label="더 보기" use:tip={'더 보기'} onclick={toggle}><Ellipsis size={16} /></button>
          {/snippet}
          {#snippet children({ close })}
            {#if colorsOn}
              <span class="sn-poplabel">색 바꾸기</span>
              <div class="sn-swatches">
                {#each SNIPPET_COLORS as c}
                  <button class="dot" style:--c={COLOR_HEX[c]} use:tip={c} aria-label={`선택한 글감 색 변경: ${c}`} onclick={() => { void bulkColor(c); close(); }}></button>
                {/each}
              </div>
            {/if}
            {#if reorderable}
              <button class="pop-row" onclick={() => { void moveStep(-1); }}><ArrowUp size={16} /><span class="txt"><b>한 칸 위로</b></span></button>
              <button class="pop-row" onclick={() => { void moveStep(1); }}><ArrowDown size={16} /><span class="txt"><b>한 칸 아래로</b></span></button>
            {/if}
          {/snippet}
        </Pop>
      {/if}
      <button class="icon-btn" aria-label="선택 해제" use:tip={'선택 해제'} onclick={clearSelection}><X size={15} /></button>
    </div>
  {/if}

  <div
    class="sn-list" bind:this={listEl}
    role={list.length ? 'listbox' : undefined} aria-multiselectable={list.length ? true : undefined} aria-label={list.length ? '글감 목록' : undefined}
    ondragover={onDragOver} ondrop={onDropList} ondragleave={onDragLeave}
  >
    {#if !sn.loaded}
      <p class="empty">불러오는 중…</p>
    {:else if !list.length}
      <p class="empty">{emptyMsg}</p>
    {:else}
      {#each list as s, i (s.id)}<SnippetCard {s} {reorderable} dropMark={dropMark(i)} />{/each}
    {/if}
  </div>
</div>

<style>
  .sn-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: 6px; padding: 8px 0 0; }
  .sn-quick { display: flex; flex-direction: column; gap: 4px; padding: 0 8px; }
  /* 노란 포스트잇 모양: 채팅 입력창처럼 보이지 않게 한다 */
  .sn-quick > textarea:first-child {
    background: color-mix(in srgb, #f6d860 24%, var(--bg)); border-color: color-mix(in srgb, #d9b93a 55%, var(--border-strong));
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.10); border-radius: 2px 2px 14px 2px; height: 220px; min-height: 120px; padding: 8px 10px; line-height: 1.5;
  }
  .sn-add-m { display: none; }
  .sn-quick textarea {
    width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; color: var(--text); background: var(--bg);
    border: 1px solid var(--border-strong); border-radius: 4px; padding: 5px 7px; resize: vertical;
  }
  .sn-quick textarea:focus { outline: none; border-color: var(--accent); }
  .sn-row { display: none; align-items: center; gap: 6px; } /* 터치 폭에서만 '글감 담기' 버튼 줄을 쓴다 */
  .sn-row .spacer { flex: 1; }
  .sn-row button { font-size: 12px; padding: 3px 8px; cursor: pointer; }
  .sn-row button:disabled { opacity: 0.5; cursor: not-allowed; }
  .sn-toolbar { display: flex; align-items: center; gap: 2px; padding: 0 8px; }
  .sn-toolbar .spacer { flex: 1; }
  .sn-toolbar .icon-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; }
  .sn-toolbar .icon-btn.on { color: var(--accent); background: var(--accent-soft); }
  .on-dot { position: absolute; top: 4px; right: 5px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  .sn-count { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; padding-right: 4px; }
  .sn-search { display: flex; align-items: center; gap: 6px; padding: 4px 6px; color: var(--muted); }
  .sn-search input {
    flex: 1; min-width: 0; font: inherit; font-size: 13px; color: var(--text); background: var(--bg);
    border: 1px solid var(--border-strong); border-radius: 6px; padding: 5px 8px;
  }
  .sn-search input:focus { outline: none; border-color: var(--accent); }
  .sn-clear { padding: 2px 4px !important; margin-left: -4px; color: var(--muted); }
  .sn-clear:hover { color: var(--danger); }
  .sn-results { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 50vh; overflow: auto; }
  .sn-result {
    width: 100%; text-align: left; border: 0; background: transparent; padding: 6px 8px 6px 10px; border-radius: 6px;
    border-left: 3px solid var(--c, var(--border)); font-size: 12.5px; line-height: 1.45; color: var(--text); cursor: pointer;
  }
  .sn-result:hover { background: var(--hover); }
  .sn-result-txt { display: block; word-break: break-word; }
  .sn-result mark { background: color-mix(in srgb, var(--accent) 30%, transparent); color: inherit; border-radius: 2px; padding: 0 1px; }
  .chip { font-size: 11px; padding: 1px 6px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); white-space: nowrap; }
  .sn-pophint { margin: 2px 8px 4px; font-size: 11.5px; line-height: 1.45; color: var(--muted); }
  .sn-pophint kbd { font: inherit; font-size: 11px; padding: 0 4px; border: 1px solid var(--border-strong); border-radius: 4px; }
  .sn-poplabel { font-size: 12px; color: var(--muted); padding: 2px 8px; }
  .sn-swatches { display: flex; flex-wrap: wrap; gap: 8px; padding: 6px 10px 8px; }
  .sn-swatch { width: 14px; height: 14px; border-radius: 50%; background: var(--c); }
  .dot { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; background: var(--c); cursor: pointer; padding: 0; }
  .dot.on { border-color: var(--text); }
  .sn-note { margin: 0; padding: 0 10px; font-size: 12px; color: var(--muted); }
  .sn-selbar {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 8px; padding: 6px 8px; font-size: 12px;
    background: var(--surface); border: 1px solid var(--accent); border-radius: 6px;
  }
  .sn-selbar .spacer { flex: 1; }
  .sn-selbar > button:not(.icon-btn) {
    display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 3px 8px; cursor: pointer;
    background: none; border: 1px solid var(--border); border-radius: 4px; color: var(--muted);
  }
  .sn-selbar > button:not(.icon-btn):hover:not(:disabled) { background: var(--hover); color: var(--text); }
  .sn-selbar > button.danger:hover:not(:disabled) { color: var(--danger); border-color: var(--danger); }
  @media (max-width: 720px) {
    /* 좁은 화면: 시트 높이를 글감 카드에 돌려주도록 입력창을 줄인다 */
    .sn-quick textarea:first-child { min-height: 0; height: 34px; resize: none; }
    /* textarea 자신이 아니라 영역 전체의 포커스로 키운다 — '추가' 버튼을 누르는 순간 textarea 가 blur 로 줄어들며
       버튼이 위로 밀려 click 이 빗나가던 결함 */
    .sn-quick:focus-within textarea:first-child { height: 160px; }
    .sn-row { display: flex; }
    .sn-add-m { display: inline-block; }
    .sn-selbar > button:not(.icon-btn) { padding: 6px 10px; }
  }
  .sn-list { flex: 1; overflow: auto; padding: 8px 8px 16px; display: flex; flex-direction: column; gap: 8px; }
</style>
