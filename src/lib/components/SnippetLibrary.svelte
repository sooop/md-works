<script lang="ts">
  // 글감 보관함 모달: 왼쪽은 검색·색·보기·목록, 오른쪽은 선택한 글감의 읽기(마크다운 렌더)·수정.
  // 글감을 바꾸는 동작은 모두 snippets/state.svelte.ts 의 함수를 쓴다. 순서 변경은 사이드바에서만 한다.
  import { onMount, tick, untrack } from 'svelte';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import Pin from '@lucide/svelte/icons/pin';
  import PinOff from '@lucide/svelte/icons/pin-off';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Link2 from '@lucide/svelte/icons/link-2';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import ModalClose from './ModalClose.svelte';
  import SnippetMd from './SnippetMd.svelte';
  import { backdropFx, modalFx } from '../motion';
  import { modal, isTopModal } from '../modal';
  import { tip } from '../tooltip.svelte';
  import { tabIndent } from '../textIndent';
  import { doc, settings, askConfirm } from '../store.svelte';
  import { SNIPPET_COLORS, type Snippet } from '../works/types';
  import { COLOR_HEX } from '../snippets/colors';
  import { parseSnippet, editableText } from '../snippets/parse';
  import { libraryList, neighborId } from '../snippets/library';
  import { safeHref } from '../snippets/markdown';
  import type { SnippetView } from '../snippets/filter';
  import {
    sn, lib, closeLibrary, editSnippet, attachHere, detachHere, discardSnippet, recoverSnippet, deleteForever, reload,
  } from '../snippets/state.svelte';

  const VIEWS: { id: SnippetView; label: string }[] = [
    { id: 'all', label: '모든 글감' },
    { id: 'doc', label: '이 글' },
    { id: 'trash', label: '휴지통' },
  ];

  let overlayEl = $state<HTMLElement>();
  let searchEl = $state<HTMLInputElement>();
  let listEl = $state<HTMLUListElement>();
  let editEl = $state<HTMLTextAreaElement>();
  let mobile = $state(false);
  let detailOpen = $state(false); // 좁은 화면에서 목록 대신 상세를 보이는가
  let editing = $state(false);
  let body = $state('');
  let saving = $state(false);
  let asking = false;

  onMount(() => {
    const mq = matchMedia('(max-width: 720px)');
    const on = () => (mobile = mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });

  const list = $derived(libraryList(sn.active, sn.trashed, lib, doc.path));
  const colorsOn = $derived(settings.snippetColors);
  // 선택한 글감은 필터에서 빠져도(수정·휴지통 직후 등) 보이는 동안은 찾아 둔다
  const selected = $derived<Snippet | undefined>(sn.active.find((s) => s.id === lib.selectedId) ?? sn.trashed.find((s) => s.id === lib.selectedId));
  const trashed = $derived(!!selected?.deletedAt);
  const attached = $derived(!!selected && !!doc.path && selected.attachedDocs.includes(doc.path));
  const parsed = $derived(selected ? parseSnippet(selected.body) : null);
  const original = $derived(selected ? editableText(selected) : '');
  const dirty = $derived(editing && body !== original);
  const anyFilter = $derived(!!(lib.query.trim() || lib.color));
  // 색 기능을 끄면 걸려 있던 색 필터도 푼다
  $effect(() => { if (!colorsOn && lib.color) lib.color = ''; });

  // 열릴 때마다 최신으로 읽는다(다른 기능이 글감을 만들었을 수 있다)
  let wasOpen = false;
  $effect(() => {
    const o = lib.open;
    if (o && !wasOpen) {
      editing = false;
      detailOpen = !!untrack(() => lib.selectedId) && untrack(() => mobile);
      void reload();
    }
    wasOpen = o;
  });

  // 목록이 바뀌어 선택한 글감이 사라지면 같은 자리의 이웃으로 옮긴다(좁은 화면에서는 목록으로 돌아간다)
  let prevList: Snippet[] = [];
  $effect(() => {
    const cur = list;
    const before = untrack(() => prevList);
    prevList = cur;
    if (!lib.open || !sn.loaded || untrack(() => editing)) return;
    const id = untrack(() => lib.selectedId);
    if (id && cur.some((s) => s.id === id)) return;
    if (untrack(() => mobile)) { if (id) { lib.selectedId = ''; detailOpen = false; } return; }
    lib.selectedId = neighborId(before, cur, id);
  });

  // ---- 수정 중 이탈 확인 ----
  /** 수정 중이면 버려도 되는지 확인한 뒤 수정 상태를 끝낸다. 계속 있어야 하면 false */
  async function leaveEdit(): Promise<boolean> {
    if (!editing) return true;
    if (dirty) {
      if (asking) return false;
      asking = true;
      const ok = await askConfirm('수정한 내용을 저장하지 않고 넘어갈까요?', '버리기', true).finally(() => { asking = false; });
      if (!ok) return false;
    }
    editing = false;
    return true;
  }
  async function requestClose() {
    if (!(await leaveEdit())) return;
    closeLibrary();
  }
  async function select(id: string) {
    if (id !== lib.selectedId && !(await leaveEdit())) return;
    lib.selectedId = id;
    detailOpen = true;
  }
  async function backToList() {
    if (!(await leaveEdit())) return;
    detailOpen = false;
    await tick();
    (listEl?.querySelector('[aria-current="true"]') as HTMLElement | null)?.focus();
  }

  async function startEdit() {
    if (!selected || trashed) return;
    body = editableText(selected); // 옛 원전 필드는 마커 줄로 풀어서 보여 준다
    editing = true;
    await tick();
    editEl?.focus();
    editEl?.setSelectionRange(body.length, body.length);
  }
  async function saveEdit() {
    if (!selected || saving || !body.trim()) return;
    saving = true;
    try {
      const r = await editSnippet(selected.id, { body: body.trim(), source: undefined }); // 원전은 본문의 마커 줄이다
      if (r !== undefined) editing = false; // 실패하면(토스트가 알린다) 입력을 그대로 둔다
    } finally { saving = false; }
  }
  async function cancelEdit() {
    if (await leaveEdit()) await tick();
  }
  function onEditKey(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveEdit(); }
  }

  // Esc: 가장 안쪽부터 한 단계씩 — 수정 취소 → 검색어 지우기 → 닫기
  function onEscape() {
    if (editing) { void cancelEdit(); return; }
    if (lib.query && document.activeElement === searchEl) { lib.query = ''; return; }
    void requestClose();
  }

  // ---- 목록 키보드 ----
  function onListKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const items = [...(listEl?.querySelectorAll<HTMLElement>('button.it') ?? [])];
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    e.preventDefault();
    items[to].focus();
  }
  // 롤링 tabindex: 선택한 항목(없으면 첫 항목)만 Tab 정지점
  const tabStop = $derived(list.some((s) => s.id === lib.selectedId) ? lib.selectedId : list[0]?.id);

  // Ctrl+Enter 는 textarea 가 처리한다. 모달 밖(위에 뜬 확인창)이 맨 위일 때는 키를 받지 않는다
  function onWindowKey(e: KeyboardEvent) {
    if (!lib.open || !isTopModal(overlayEl)) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && editing && !e.isComposing && !(e.target as HTMLElement).closest('textarea')) { e.preventDefault(); void saveEdit(); }
  }

  // ---- 표시용 ----
  const firstLine = (t: string) => t.split('\n').map((l) => l.replace(/^[#>\-*+\s]+/, '').trim()).find(Boolean) ?? '';
  function itemTitle(s: Snippet): { title: string; sub: string } {
    const p = parseSnippet(s.body);
    const imgOnly = /^!\[[^\]]*\]\([^)]*\)$/;
    const lines = p.rest.split('\n').map((l) => l.replace(/^[#>\-*+\s]+/, '').trim()).filter((l) => l && !imgOnly.test(l));
    if (p.title) return { title: p.title, sub: lines[0] ?? '' };
    return { title: lines[0] ?? (firstLine(p.rest) ? '(이미지)' : '(빈 글감)'), sub: lines[1] ?? '' };
  }
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const dateLabel = (s: Snippet) => new Date(s.createdAt).toLocaleDateString('ko-KR');
  const emptyMsg = $derived(
    anyFilter ? '조건에 맞는 글감이 없습니다.'
    : lib.view === 'trash' ? '휴지통이 비어 있습니다.'
    : lib.view === 'doc' ? (doc.path ? '이 글에 꽂힌 글감이 없습니다. 모든 글감에서 핀을 꽂으세요.' : '문서를 열면 이 글에 꽂힌 글감이 보입니다.')
    : '글감이 없습니다. 사이드바 입력창에 적고 Ctrl+Enter 를 누르세요.',
  );

  async function remove(s: Snippet) { await discardSnippet(s.id); }
</script>

<svelte:window onkeydown={onWindowKey} />

{#snippet badge(label: string, url: string)}
  {@const text = label || (url ? host(url) : '')}
  {#if text}
    {#if safeHref(url).startsWith('http')}
      <a class="badge link" href={url} target="_blank" rel="noopener noreferrer"><Link2 size={12} /><span>{text}</span></a>
    {:else}
      <span class="badge"><BookOpen size={12} /><span>{text}</span></span>
    {/if}
  {/if}
{/snippet}

{#if lib.open}
  <div class="overlay" transition:backdropFx bind:this={overlayEl} use:modal={{ onClose: requestClose, onEscape, focus: '.lib-search' }}>
    <div class="lib" class:show-detail={detailOpen} role="dialog" aria-modal="true" aria-labelledby="lib-title" transition:modalFx>
      <header class="lib-head">
        <h2 id="lib-title">글감 보관함</h2>
        <span class="lib-count" aria-live="polite">{list.length}개</span>
        <span class="spacer"></span>
        <ModalClose onclick={requestClose} />
      </header>

      <div class="lib-body">
        <!-- 왼쪽: 찾기·거르기·목록 -->
        <section class="pane pane-list" aria-label="글감 목록">
          <div class="lib-find">
            <Search size={14} />
            <input
              class="lib-search" bind:this={searchEl} bind:value={lib.query} placeholder="글감 검색 (본문·원전, 초성 가능)"
              aria-label="글감 검색" spellcheck="false"
            />
            {#if lib.query}
              <button class="icon-btn" aria-label="검색어 지우기" use:tip={'지우기'} onclick={() => { lib.query = ''; searchEl?.focus(); }}><X size={14} /></button>
            {/if}
          </div>
          <div class="lib-filters">
            <div class="seg" role="group" aria-label="보기">
              {#each VIEWS as v (v.id)}
                <button class="seg-btn" class:on={lib.view === v.id} aria-pressed={lib.view === v.id} onclick={() => (lib.view = v.id)}>{v.label}</button>
              {/each}
            </div>
            {#if colorsOn}
              <div class="swatches" role="group" aria-label="색으로 거르기">
                {#each SNIPPET_COLORS as c}
                  <button class="dot" class:on={lib.color === c} style:--c={COLOR_HEX[c]} aria-label={`색: ${c}`} aria-pressed={lib.color === c} use:tip={c}
                    onclick={() => (lib.color = lib.color === c ? '' : c)}></button>
                {/each}
              </div>
            {/if}
            {#if anyFilter}
              <button class="clear" onclick={() => { lib.query = ''; lib.color = ''; }}>필터 해제</button>
            {/if}
          </div>

          {#if !sn.loaded}
            <p class="empty" role="status">불러오는 중…</p>
          {:else if !list.length}
            <p class="empty" role="status">{emptyMsg}</p>
          {:else}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <ul class="lib-list" bind:this={listEl} aria-label="글감" onkeydown={onListKey}>
              {#each list as s (s.id)}
                {@const t = itemTitle(s)}
                <li>
                  <button
                    class="it" class:on={s.id === lib.selectedId} class:gone={!!s.deletedAt}
                    aria-current={s.id === lib.selectedId ? 'true' : undefined} tabindex={s.id === tabStop ? 0 : -1} data-sn-id={s.id}
                    onclick={() => void select(s.id)}
                  >
                    <span class="it-dot" style:--c={COLOR_HEX[s.color]} aria-hidden="true"></span>
                    <span class="it-txt"><b>{t.title}</b>{#if t.sub}<small>{t.sub}</small>{/if}</span>
                    {#if doc.path && s.attachedDocs.includes(doc.path) && !s.deletedAt}<span class="it-pin" use:tip={'이 글에 꽂혀 있음'}><Pin size={13} /><span class="sr-only">이 글에 꽂혀 있음</span></span>{/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <!-- 오른쪽: 읽기·수정 -->
        <section class="pane pane-detail" aria-label="글감 내용">
          {#if selected && parsed}
            <div class="d-bar">
              <button class="icon-btn back" aria-label="목록으로" use:tip={'목록으로'} onclick={() => void backToList()}><ArrowLeft size={18} /></button>
              {#if colorsOn && !trashed}
                <div class="swatches" role="group" aria-label="이 글감의 색">
                  {#each SNIPPET_COLORS as c}
                    <button class="dot" class:on={selected.color === c} style:--c={COLOR_HEX[c]} aria-label={`색 바꾸기: ${c}`} aria-pressed={selected.color === c} use:tip={c}
                      onclick={() => void editSnippet(selected.id, { color: c })}></button>
                  {/each}
                </div>
              {/if}
              <span class="spacer"></span>
              {#if trashed}
                <button onclick={() => void recoverSnippet(selected.id)}><Undo2 size={15} /> 복구</button>
                <button class="danger" onclick={() => void deleteForever(selected.id)}><Trash2 size={15} /> 완전 삭제</button>
              {:else}
                {#if attached}
                  <button onclick={() => void detachHere(selected.id)} use:tip={{ title: '핀 뽑기', lines: ['이 글에서만 빼고 글감은 남깁니다'] }}><PinOff size={15} /> 핀 뽑기</button>
                {:else}
                  <button disabled={!doc.path} onclick={() => void attachHere(selected.id)}
                    use:tip={{ title: '이 글에 핀 꽂기', lines: [doc.path ? '사이드바의 이 글 목록에 나타납니다' : '문서를 열면 꽂을 수 있습니다'] }}><Pin size={15} /> 핀 꽂기</button>
                {/if}
                {#if !editing}<button onclick={() => void startEdit()}><Pencil size={15} /> 편집</button>{/if}
                <button class="danger" aria-label="휴지통으로 보내기" use:tip={{ title: '휴지통으로', lines: ['복구할 수 있습니다'] }} onclick={() => void remove(selected)}><Trash2 size={15} /></button>
              {/if}
            </div>

            {#if editing}
              <textarea
                class="d-edit" bind:this={editEl} bind:value={body} use:tabIndent onkeydown={onEditKey}
                aria-label="글감 내용 수정" spellcheck="false" placeholder="마크다운으로 적습니다  ( # 제목 · @출처 · > 인용 )"
              ></textarea>
              <div class="d-foot">
                <span class="keys" aria-hidden="true"><kbd>Ctrl+Enter</kbd> 저장 · <kbd>Tab</kbd> 들여쓰기 · <kbd>Esc</kbd> 취소</span>
                <button onclick={() => void cancelEdit()}>취소</button>
                <button class="primary" onclick={() => void saveEdit()} disabled={!body.trim() || saving}>{saving ? '저장하는 중…' : '저장'}</button>
              </div>
            {:else}
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
              <article
                class="d-read" tabindex="0" aria-label="글감 읽기"
                ondblclick={(e) => { if (!trashed && !(e.target as HTMLElement).closest('a, input, button')) { window.getSelection()?.removeAllRanges(); void startEdit(); } }}
              >
                {#if parsed.title}<h1 class="d-title">{parsed.title}</h1>{/if}
                {#if parsed.rest.trim()}
                  <SnippetMd source={parsed.rest} />
                {:else if !parsed.title}
                  <p class="muted">내용이 없습니다.</p>
                {/if}
                {#if parsed.source || selected.source}
                  <div class="sources">
                    {#if parsed.source}{@render badge(parsed.source.label, parsed.source.url)}{/if}
                    {#if selected.source}{@render badge(selected.source.title ?? '', selected.source.url)}{/if}
                  </div>
                  {#if selected.source?.excerpt}<blockquote class="excerpt">{selected.source.excerpt}</blockquote>{/if}
                {/if}
              </article>
              <div class="d-foot meta">
                <span>{dateLabel(selected)}{#if selected.attachedDocs.length}{' · 꽂힌 글 '}{selected.attachedDocs.length}{/if}{#if trashed}{' · 휴지통'}{/if}</span>
                {#if !trashed}<span class="keys" aria-hidden="true">더블 클릭으로 편집</span>{/if}
              </div>
            {/if}
          {:else}
            <p class="empty center">{list.length ? '왼쪽에서 글감을 고르세요.' : ''}</p>
          {/if}
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  .lib {
    width: min(1120px, calc(100vw - 32px));
    height: min(780px, calc(100vh - 48px));
    height: min(780px, calc(100dvh - 48px));
    display: flex; flex-direction: column; overflow: hidden;
    background: var(--bg); border: 1px solid var(--border-strong); border-radius: 12px; box-shadow: var(--shadow);
  }
  .lib-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px 10px; border-bottom: 1px solid var(--border); flex: none; }
  .lib-head h2 { margin: 0; font-size: 16px; }
  .lib-count { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .spacer { flex: 1; }
  .lib-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); }
  .pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .pane-list { border-right: 1px solid var(--border); background: var(--surface); }
  .pane-detail { background: var(--bg); }

  /* 왼쪽: 찾기 */
  .lib-find { display: flex; align-items: center; gap: 6px; margin: 10px 10px 6px; padding: 0 6px 0 9px; color: var(--muted); border: 1px solid var(--border-strong); border-radius: 8px; background: var(--bg); transition: border-color var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out); }
  .lib-find:focus-within { border-color: var(--accent); box-shadow: var(--ring); }
  .lib-find input { flex: 1; min-width: 0; font: inherit; font-size: 13px; color: var(--text); background: transparent; border: 0; padding: 7px 0; outline: none; box-shadow: none; }
  .lib-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 0 10px 8px; }
  .seg { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 8px; overflow: hidden; background: var(--bg); }
  .seg-btn { border: 0; border-radius: 0; background: transparent; padding: 4px 10px; font-size: 12px; color: var(--muted); cursor: pointer; }
  .seg-btn + .seg-btn { border-left: 1px solid var(--border-strong); }
  .seg-btn:hover:not(:disabled) { background: var(--hover); color: var(--text); }
  .seg-btn.on { background: var(--accent-soft); color: var(--primary); font-weight: 600; }
  .swatches { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid transparent; background: var(--c); cursor: pointer; padding: 0; transition: transform var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out); }
  .dot:hover:not(:disabled) { background: var(--c); transform: scale(1.15); }
  .dot.on { border-color: var(--text); }
  .clear { border: 0; background: transparent; padding: 2px 6px; font-size: 12px; color: var(--muted); cursor: pointer; text-decoration: underline; }
  .clear:hover:not(:disabled) { color: var(--danger); background: transparent; }

  .lib-list { list-style: none; margin: 0; padding: 4px 8px 12px; overflow: auto; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 4px; }
  .it { width: 100%; display: flex; align-items: flex-start; gap: 9px; text-align: left; padding: 8px 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text); cursor: pointer; font-size: 13px; transition: background-color var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out); }
  .it:hover:not(:disabled) { background: var(--hover); }
  .it.on { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
  .it:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .it.gone .it-txt b { color: var(--muted); }
  .it-dot { flex: none; width: 10px; height: 10px; margin-top: 4px; border-radius: 50%; background: var(--c); }
  .it-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .it-txt b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .it-txt small { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .it-pin { flex: none; color: var(--danger); display: inline-flex; margin-top: 2px; }
  .it-pin :global(svg) { fill: currentColor; }
  .empty { margin: 0; padding: 14px 14px; font-size: 13px; line-height: 1.55; color: var(--muted); }
  .empty.center { margin: auto; text-align: center; }
  .muted { color: var(--muted); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  /* 오른쪽: 상단 줄 */
  .d-bar { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--border); flex: none; flex-wrap: wrap; }
  .d-bar button:not(.icon-btn):not(.dot) { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; font-size: 12.5px; border-radius: 6px; }
  .d-bar .danger { color: var(--danger); }
  .back { display: none; }

  .d-read { flex: 1; min-height: 0; overflow: auto; padding: 18px 26px 24px; outline: none; }
  .d-read:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
  .d-title { margin: 0 0 12px; font-size: 1.6em; line-height: 1.3; overflow-wrap: anywhere; }
  .sources { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; }
  .badge { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; box-sizing: border-box; padding: 1px 9px 1px 7px; border-radius: 10px; font-size: 12px; line-height: 1.6; text-decoration: none; color: var(--muted); background: color-mix(in srgb, var(--text) 8%, transparent); border: 1px solid var(--border); }
  .badge span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  a.badge { color: var(--primary); }
  a.badge:hover { background: var(--accent-soft); border-color: var(--accent); }
  .excerpt { margin: 8px 0 0; padding: 0 0 0 12px; border-left: 3px solid var(--border-strong); font-size: 13px; font-style: italic; color: var(--muted); overflow-wrap: anywhere; }

  /* 수정: 영역 전체 높이 */
  .d-edit {
    flex: 1; min-height: 0; width: 100%; box-sizing: border-box; resize: none; margin: 0; padding: 16px 26px;
    font: inherit; font-family: var(--font-code); font-size: 13.5px; line-height: 1.65; tab-size: 2; color: var(--text);
    background: var(--bg); border: 0; border-radius: 0; outline: none; box-shadow: none;
  }
  .d-edit:focus { outline: none; box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent); }
  .d-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 8px 14px; border-top: 1px solid var(--border); flex: none; }
  .d-foot button { padding: 4px 12px; font-size: 12.5px; border-radius: 6px; }
  .d-foot .keys, .keys { margin-right: auto; font-size: 11.5px; color: var(--muted); }
  .d-foot.meta { font-size: 11.5px; color: var(--muted); justify-content: space-between; font-variant-numeric: tabular-nums; }
  .d-foot.meta .keys { margin-right: 0; }
  kbd { font: inherit; font-size: 10.5px; padding: 0 4px; border: 1px solid var(--border-strong); border-radius: 4px; background: var(--bg); }

  /* 좁은 화면: 목록 ↔ 상세 화면 전환, 전체 화면 */
  @media (max-width: 720px) {
    .lib { width: 100vw; height: 100vh; height: 100dvh; border-radius: 0; border: 0; padding-bottom: env(safe-area-inset-bottom); }
    .lib-head { padding-top: calc(12px + env(safe-area-inset-top)); }
    .lib-body { grid-template-columns: minmax(0, 1fr); }
    .pane-list { border-right: 0; }
    .pane-detail { display: none; }
    .show-detail .pane-list { display: none; }
    .show-detail .pane-detail { display: flex; }
    .back { display: inline-flex; }
    .lib-find input, .d-edit { font-size: 16px; }
    .seg-btn { padding: 7px 12px; }
    .it { padding: 10px 12px; }
    .dot { width: 24px; height: 24px; }
    .d-bar button:not(.icon-btn):not(.dot) { padding: 7px 12px; }
    .d-read { padding: 14px 16px 20px; }
    .d-edit { padding: 12px 16px; }
    .d-foot .keys, .keys { display: none; }
  }
  @media (pointer: coarse) { .lib-find input, .d-edit { font-size: 16px; } }
</style>
