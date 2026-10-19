<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import SnippetCard from './SnippetCard.svelte';
  import { doc, toast, errMsg } from '../store.svelte';
  import { SNIPPET_COLORS } from '../works/types';
  import { COLOR_HEX } from '../snippets/colors';
  import { asUrl } from '../snippets/filter';
  import { imageToDataUrl, MAX_DATA_URL } from '../snippets/image';
  import { sn, reload, visible, addSnippet } from '../snippets/state.svelte';
  import { right } from '../rightbar/state.svelte';

  let input = $state<HTMLTextAreaElement>();
  let phraseInput = $state<HTMLInputElement>();
  let text = $state('');
  let url = $state('');
  let title = $state('');
  let excerpt = $state('');
  let srcOpen = $state(false);
  let busy = $state(false);
  let foldOpen = $state(false); // 모바일: 문구 찾기·검색·색 필터 접힘 토글(데스크톱에선 항상 펼침)
  const filtering = $derived(!!(sn.phrase.trim() || sn.query.trim() || sn.color));

  const list = $derived(visible());
  const phraseMode = $derived(!!sn.phrase.trim());

  onMount(() => {
    void reload(); // 단축키·선택 추적은 셸의 SnippetShortcuts 가 맡는다
  });
  // 탭을 열 때마다 다시 읽는다 (다른 기능이 글감을 만들었을 수 있다)
  $effect(() => { if (right.open && right.tab === 'snippets') void reload(); });
  $effect(() => { sn.focusInput; if (sn.focusInput) void tick().then(() => input?.focus()); });
  $effect(() => { sn.focusPhrase; if (sn.focusPhrase) void tick().then(() => { phraseInput?.focus(); phraseInput?.select(); }); });

  async function add() {
    const body = text.trim();
    if (!body || busy) return;
    const u = url.trim();
    const ok = await addSnippet(body, u ? { url: u, ...(title.trim() ? { title: title.trim() } : {}), ...(excerpt.trim() ? { excerpt: excerpt.trim() } : {}) } : undefined);
    if (ok) { text = ''; url = title = excerpt = ''; srcOpen = false; }
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
    if (imgs.length) { e.preventDefault(); void addImages(imgs); return; }
    const u = asUrl(e.clipboardData?.getData('text/plain') ?? '');
    if (u && !url) { e.preventDefault(); url = u; srcOpen = true; } // URL 만 붙여넣으면 원전 칸에 (제목은 직접 입력, 네트워크 요청 없음)
  }
  function onDrop(e: DragEvent) {
    const imgs = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    e.preventDefault();
    e.stopPropagation();
    void addImages(imgs);
  }

  const views = [['doc', '이 글에 붙은 것'], ['all', '전체'], ['trash', '휴지통']] as const;
  const emptyMsg = $derived(
    phraseMode ? '관련된 글감이 없습니다.'
    : sn.query.trim() || sn.color ? '조건에 맞는 글감이 없습니다.'
    : sn.view === 'trash' ? '휴지통이 비어 있습니다.'
    : sn.view === 'doc' ? (doc.path ? '이 글에 붙은 글감이 없습니다. 위에서 추가하거나 \'전체\' 에서 붙이세요.' : '문서를 열면 이 글에 붙은 글감이 보입니다.')
    : '글감이 없습니다. 위 입력창에 적고 Enter 를 누르세요.',
  );
</script>

<div class="sn-panel">
  <div class="sn-quick">
    <textarea
      bind:this={input}
      bind:value={text}
      onkeydown={onKey}
      onpaste={onPaste}
      ondragover={(e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); }}
      ondrop={onDrop}
      rows="2"
      placeholder="글감을 적고 Enter — 포스트잇처럼 붙여 둡니다 (Shift+Enter 줄바꿈 · 이미지 붙여넣기·드롭)"
      aria-label="새 글감"
    ></textarea>
    <details class="sn-src" bind:open={srcOpen}>
      <summary>원전 (선택)</summary>
      <input bind:value={url} placeholder="URL" aria-label="원전 URL" spellcheck="false" />
      <input bind:value={title} placeholder="제목" aria-label="원전 제목" />
      <textarea bind:value={excerpt} placeholder="발췌" aria-label="원전 발췌" rows="2"></textarea>
    </details>
    <div class="sn-row">
      <span class="hint" title={`이미지는 최대 1600px 로 줄여 본문에 포함합니다. 줄인 뒤 약 ${(MAX_DATA_URL / 1_000_000).toFixed(1)}MB 를 넘으면 넣을 수 없습니다.`}>이미지 ≤ 1600px · {(MAX_DATA_URL / 1_000_000).toFixed(1)}MB</span>
      <span class="spacer"></span>
      <!-- 키보드가 없는 터치 폭에서만 보이는 글자 버튼(아이콘 없음) — 데스크톱은 Enter 로 붙인다 -->
      <button class="sn-add-m" disabled={!text.trim() || busy} onclick={add}>글감 담기</button>
    </div>
  </div>

  <button class="sn-ftoggle" aria-expanded={foldOpen} onclick={() => (foldOpen = !foldOpen)}>
    <Search size={13} /> 찾기·필터{#if filtering}<span class="on-dot" aria-label="적용 중"></span>{/if}<span class="chev">{foldOpen ? '▴' : '▾'}</span>
  </button>

  <div class="filterbox sn-phrase" class:fold-m={!foldOpen && !sn.phrase.trim()}>
    <Search size={14} />
    <input
      bind:this={phraseInput}
      bind:value={sn.phrase}
      placeholder="문구로 글감 찾기 (Ctrl+Alt+G: 선택한 본문)"
      aria-label="문구로 글감 찾기"
      spellcheck="false"
    />
    {#if sn.phrase}<button class="icon-btn" title="지우기" aria-label="문구 지우기" onclick={() => (sn.phrase = '')}><X size={14} /></button>{/if}
  </div>

  {#if !phraseMode}
    <div class="sn-views" role="tablist">
      {#each views as [v, label]}
        <button role="tab" class:on={sn.view === v} aria-selected={sn.view === v} onclick={() => (sn.view = v)}>{label}</button>
      {/each}
    </div>
    <div class="filterbox" class:fold-m={!foldOpen && !sn.query.trim()}>
      <Search size={14} />
      <input bind:value={sn.query} placeholder="글감 검색 (본문·원전, 초성 가능)" aria-label="글감 검색" spellcheck="false" />
      {#if sn.query}<button class="icon-btn" title="지우기" aria-label="검색어 지우기" onclick={() => (sn.query = '')}><X size={14} /></button>{/if}
    </div>
    <div class="sn-colorfilter" class:fold-m={!foldOpen && !sn.color} role="group" aria-label="색 필터">
      <button class="all" class:on={!sn.color} onclick={() => (sn.color = '')}>모든 색</button>
      {#each SNIPPET_COLORS as c}
        <button class="dot" class:on={sn.color === c} style:--c={COLOR_HEX[c]} title={c} aria-label={`색 필터: ${c}`} aria-pressed={sn.color === c} onclick={() => (sn.color = sn.color === c ? '' : c)}></button>
      {/each}
    </div>
  {:else}
    <p class="sn-note">전체 글감을 관련도 순으로 보여 줍니다 ({list.length}개).</p>
  {/if}

  <div class="sn-list">
    {#if !sn.loaded}
      <p class="empty">불러오는 중…</p>
    {:else if !list.length}
      <p class="empty">{emptyMsg}</p>
    {:else}
      {#each list as s (s.id)}<SnippetCard {s} />{/each}
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
  .sn-quick textarea, .sn-src input, .sn-src textarea {
    width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; color: var(--text); background: var(--bg);
    border: 1px solid var(--border-strong); border-radius: 4px; padding: 5px 7px; resize: vertical;
  }
  .sn-quick textarea:focus, .sn-src input:focus { outline: none; border-color: var(--accent); }
  .sn-src { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  .sn-src summary { cursor: pointer; color: var(--muted); }
  .sn-row { display: flex; align-items: center; gap: 6px; }
  .sn-row .spacer { flex: 1; }
  .sn-row button { font-size: 12px; padding: 3px 8px; cursor: pointer; }
  .sn-row button:disabled { opacity: 0.5; cursor: not-allowed; }
  .hint { font-size: 11px; color: var(--muted); }
  .sn-views { display: flex; gap: 2px; padding: 0 8px; }
  .sn-views button {
    flex: 1; font-size: 12px; padding: 4px 2px; background: none; border: 1px solid var(--border); border-radius: 4px;
    color: var(--muted); cursor: pointer;
  }
  .sn-views button.on { color: var(--text); background: var(--selected); font-weight: 600; }
  .sn-colorfilter { display: flex; align-items: center; gap: 6px; padding: 0 10px; }
  .sn-colorfilter .all { font-size: 11px; background: none; border: none; color: var(--muted); cursor: pointer; padding: 2px 4px; }
  .sn-colorfilter .all.on { color: var(--text); font-weight: 600; }
  .dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid transparent; background: var(--c); cursor: pointer; padding: 0; }
  .dot.on { border-color: var(--text); }
  .sn-note { margin: 0; padding: 0 10px; font-size: 12px; color: var(--muted); }
  .sn-ftoggle { display: none; }
  @media (max-width: 720px) {
    /* 좁은 화면: 시트 높이를 글감 카드에 돌려주도록 입력창을 줄이고 찾기·필터를 한 줄로 접는다 */
    .sn-quick textarea:first-child { min-height: 0; height: 34px; resize: none; }
    /* textarea 자신이 아니라 영역 전체의 포커스로 키운다 — '추가' 버튼을 누르는 순간 textarea 가 blur 로 줄어들며
       버튼이 위로 밀려 click 이 빗나가던 결함 */
    .sn-quick:focus-within textarea:first-child { height: 160px; }
    .hint { display: none; }
    .fold-m { display: none !important; }
    .sn-ftoggle {
      display: flex; align-items: center; gap: 6px; margin: 0 8px; padding: 4px 8px; font-size: 12px; cursor: pointer;
      background: none; border: 1px solid var(--border); border-radius: 4px; color: var(--muted);
    }
    .sn-ftoggle .chev { margin-left: auto; }
    .sn-add-m { display: inline-block; }
    .on-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  }
  .sn-list { flex: 1; overflow: auto; padding: 0 8px 16px; display: flex; flex-direction: column; gap: 8px; }
</style>
