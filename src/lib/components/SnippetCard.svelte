<script lang="ts">
  import { tick } from 'svelte';
  import Pin from '@lucide/svelte/icons/pin';
  import PinOff from '@lucide/svelte/icons/pin-off';
  import Palette from '@lucide/svelte/icons/palette';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Link2 from '@lucide/svelte/icons/link-2';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import { doc, settings } from '../store.svelte';
  import { tip } from '../tooltip.svelte';
  import Pop from './Pop.svelte';
  import { SNIPPET_COLORS, type Snippet } from '../works/types';
  import { COLOR_HEX } from '../snippets/colors';
  import { suggestProvider } from '../works/suggest';
  import { splitBody, bodyLines, suggestCandidates, snippetText } from '../snippets/filter';
  import { parseSnippet, editableText } from '../snippets/parse';
  import {
    sn, editSnippet, attachHere, detachHere, discardSnippet, recoverSnippet, deleteForever,
    toggleSelect, selectRangeTo, dragGroup, moveStep,
  } from '../snippets/state.svelte';

  interface Props {
    s: Snippet;
    /** 끌어서·Alt+화살표로 순서를 바꿀 수 있는 보기인지 */
    reorderable?: boolean;
    /** 삽입 위치 표시선: 이 카드 위('before') 또는 아래('after') */
    dropMark?: '' | 'before' | 'after';
  }
  let { s, reorderable = false, dropMark = '' }: Props = $props();

  const trashed = $derived(!!s.deletedAt);
  const open = $derived(sn.openId === s.id);
  const attached = $derived(!!doc.path && s.attachedDocs.includes(doc.path));
  const parsed = $derived(parseSnippet(s.body));
  const parts = $derived(splitBody(parsed.rest));
  const dateLabel = $derived(new Date(s.createdAt).toLocaleDateString('ko-KR'));

  // ---- 인라인 수정 ----
  let editing = $state(false);
  let body = $state('');
  /** 원전 배지에 보일 글자: 제목(@ 뒤 글자)이 있으면 그것, 없으면 주소의 도메인 */
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const badgeText = (label: string, url: string) => label || (url ? host(url) : '');
  function startEdit() {
    body = editableText(s); // 옛 원전 필드는 마커 줄로 풀어서 보여 준다
    editing = true;
  }
  async function saveEdit() {
    if (!body.trim()) return;
    await editSnippet(s.id, { body: body.trim(), source: undefined }); // 원전은 이제 본문의 마커 줄이다
    editing = false;
  }
  // Enter 저장, Shift+Enter 줄바꿈(한글 조합 중 Enter 는 글자 확정이라 건드리지 않는다)
  function onEditKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveEdit(); }
    else if (e.key === 'Escape') { e.stopPropagation(); editing = false; }
  }
  let colorOpen = $state(false);

  // ---- 비슷한 글감 (펼쳤을 때) ----
  let similar = $state<Snippet[]>([]);
  $effect(() => {
    if (!open || trashed) { similar = []; return; }
    const cands = suggestCandidates(s, sn.active);
    const query = snippetText(s);
    let stale = false;
    suggestProvider().rank(query, cands, 5).then((r) => {
      if (stale) return;
      const by = new Map(sn.active.map((x) => [x.id, x]));
      similar = r.map((x) => by.get(x.id)).filter((x): x is Snippet => !!x);
    }).catch(() => { if (!stale) similar = []; });
    return () => { stale = true; };
  });

  const selected = $derived(sn.selected.includes(s.id));
  const INTERACTIVE = 'button, a, textarea, input, summary, details';

  /** 클릭 수식키에 따라 선택을 바꾼다. 처리했으면 true */
  function pick(e: MouseEvent): boolean {
    if (e.shiftKey) { selectRangeTo(s.id); return true; }
    if (e.ctrlKey || e.metaKey || sn.selectMode) { toggleSelect(s.id); return true; }
    return false;
  }
  function toggle(e: MouseEvent) {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    if (!editing && pick(e)) return;
    sn.anchor = s.id; // 그냥 클릭은 선택을 건드리지 않고 Shift 범위의 기준만 옮긴다
    sn.openId = open ? '' : s.id;
  }
  // 더블 클릭으로 편집 모드를 연다(휴지통의 글감은 제외). 버튼·링크 위에서는 하지 않는다
  function onDblClick(e: MouseEvent) {
    if (editing || trashed || (e.target as HTMLElement).closest(INTERACTIVE)) return;
    window.getSelection()?.removeAllRanges(); // 더블 클릭으로 잡힌 단어 선택을 지운다
    startEdit();
  }
  // Shift+클릭이 글자 선택으로 번지지 않게
  function onMouseDown(e: MouseEvent) {
    if (e.shiftKey && !(e.target as HTMLElement).closest(INTERACTIVE)) e.preventDefault();
  }

  // ---- 드래그·키보드 이동 ----
  let el = $state<HTMLDivElement>();
  const draggable = $derived(reorderable && !editing && !trashed);
  function onDragStart(e: DragEvent) {
    if (!draggable) { e.preventDefault(); return; }
    sn.dragIds = dragGroup(s.id);
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-snippet-id', s.id); }
  }
  function onDragEnd() { sn.dragIds = []; sn.dropIndex = -1; }
  async function onKeyDown(e: KeyboardEvent) {
    if (e.target !== e.currentTarget || editing) return; // 카드 자신에 포커스가 있을 때만
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      if (!reorderable) return;
      await moveStep(e.key === 'ArrowUp' ? -1 : 1, s.id);
      await tick();
      el?.focus(); // 목록이 다시 그려져도 포커스를 유지
    } else if (e.key === 'Enter' && !trashed) {
      e.preventDefault();
      startEdit();
    } else if (e.key === ' ' && sn.selectMode) {
      e.preventDefault();
      toggleSelect(s.id);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  bind:this={el}
  class="sn-card" class:open class:selected class:drop-before={dropMark === 'before'} class:drop-after={dropMark === 'after'}
  class:dragging={sn.dragIds.includes(s.id)}
  style:--sn={COLOR_HEX[s.color]}
  role="option" aria-selected={selected} tabindex="0" data-sn-id={s.id}
  draggable={draggable}
  use:tip={draggable ? { title: '끌어서 순서 바꾸기', lines: ['Alt+↑/↓ 로 한 칸 이동', '더블 클릭으로 수정'] } : null}
  onclick={toggle} ondblclick={onDblClick} onmousedown={onMouseDown} onkeydown={onKeyDown} ondragstart={onDragStart} ondragend={onDragEnd}
>
  {#if sn.selectMode}
    <label class="sn-check">
      <input
        type="checkbox" checked={selected} aria-label="이 글감 선택"
        onclick={(e) => {
          e.stopPropagation();
          const box = e.currentTarget;
          pick(e);
          void tick().then(() => { box.checked = sn.selected.includes(s.id); }); // Shift 범위 등으로 기본 토글과 어긋난 표시를 바로잡는다
        }}
      />
    </label>
  {/if}
  {#if attached && !trashed && !editing}<span class="sn-pin" aria-hidden="true"><Pin size={15} /></span>{/if}
  {#if editing}
    <textarea class="sn-edit" bind:value={body} onkeydown={onEditKey} rows="4" aria-label="글감 내용" placeholder="Enter 저장 · Shift+Enter 줄바꿈 · Esc 취소  ( # 제목 · @출처 · > 인용 )"></textarea>
    <div class="sn-ops">
      <button class="primary" onclick={saveEdit} disabled={!body.trim()}>저장</button>
      <button onclick={() => (editing = false)}>취소</button>
    </div>
  {:else}
    {#if parsed.title}<div class="sn-title">{parsed.title}</div>{/if}
    <div class="sn-body">
      {#each parts as p}
        {#if p.type === 'img'}<img src={p.v} alt={p.alt} loading="lazy" />{:else}{#each bodyLines(p.v) as l}<div class={`ln ${l.kind}`}>{l.text}</div>{/each}{/if}
      {/each}
    </div>
    {#if parsed.source}
      {@render badge(parsed.source.label, parsed.source.url)}
    {/if}
    {#if s.source}
      {@render badge(s.source.title ?? '', s.source.url)}
      {#if s.source.excerpt}<q class="sn-excerpt">{s.source.excerpt}</q>{/if}
    {/if}
    <div class="sn-meta">
      <span class="sn-date">{dateLabel}{#if s.attachedDocs.length}{' · 꽂힌 글 '}{s.attachedDocs.length}{/if}</span>
      <span class="sn-ops">
        {#if trashed}
          <button use:tip={{ title: '복구', lines: ['원래 꽂혀 있던 글에 다시 꽂힙니다'] }} aria-label="복구" onclick={() => recoverSnippet(s.id)}><Undo2 size={14} /></button>
          <button use:tip={'완전 삭제'} aria-label="완전 삭제" onclick={() => deleteForever(s.id)}><Trash2 size={14} /></button>
        {:else}
          {#if attached}
            <button use:tip={{ title: '핀 떼기', lines: ['이 글에서만 빼고 글감은 남깁니다'] }} aria-label="이 글에서 핀 떼기" onclick={() => detachHere(s.id)}><PinOff size={14} /></button>
          {:else}
            <button use:tip={doc.path ? '이 글에 핀 꽂기' : '문서를 열면 핀을 꽂을 수 있습니다'} aria-label="이 글에 핀 꽂기" disabled={!doc.path} onclick={() => attachHere(s.id)}><Pin size={14} /></button>
          {/if}
          <button use:tip={{ title: '삭제', lines: ['휴지통으로 보냅니다'] }} aria-label="휴지통으로" onclick={() => discardSnippet(s.id)}><Trash2 size={14} /></button>
        {/if}
      </span>
    </div>
    {#if open && !trashed}
      {#if settings.snippetColors}
        <Pop bind:open={colorOpen} label="글감 색" width={200}>
          {#snippet trigger({ toggle })}
            <button class="sn-colorbtn" aria-haspopup="dialog" aria-label="색 바꾸기" use:tip={`색: ${s.color}`} onclick={toggle}><Palette size={13} /> 색</button>
          {/snippet}
          {#snippet children({ close })}
            <div class="sn-swatches">
              {#each SNIPPET_COLORS as c}
                <button class="dot" class:on={s.color === c} style:--c={COLOR_HEX[c]} use:tip={c} aria-label={`색: ${c}`} aria-pressed={s.color === c} onclick={() => { void editSnippet(s.id, { color: c }); close(); }}></button>
              {/each}
            </div>
          {/snippet}
        </Pop>
      {/if}
      <div class="sn-similar">
        <h4>비슷한 글감</h4>
        {#if similar.length}
          <ul>
            {#each similar as x (x.id)}
              <li><button onclick={() => (sn.openId = x.id)} use:tip={{ title: snippetText(x).replace(/\s+/g, ' ').slice(0, 120) }}>{snippetText(x).replace(/\s+/g, ' ').slice(0, 60)}</button></li>
            {/each}
          </ul>
        {:else}
          <p>비슷한 글감이 없습니다.</p>
        {/if}
      </div>
    {/if}
  {/if}
</div>

{#snippet badge(label: string, url: string)}
  {@const text = badgeText(label, url)}
  {#if text}
    {#if /^https?:\/\//i.test(url)}
      <a class="sn-badge" href={url} target="_blank" rel="noopener noreferrer" use:tip={{ title: label || host(url), lines: [url] }}><Link2 size={11} /><span>{text}</span></a>
    {:else}
      <span class="sn-badge"><BookOpen size={11} /><span>{text}</span></span>
    {/if}
  {/if}
{/snippet}

<style>
  .sn-card {
    --sn: #f2c94c;
    background: color-mix(in srgb, var(--sn) 14%, var(--surface));
    border: 1px solid var(--border);
    border-left: 4px solid var(--sn);
    border-radius: 6px;
    padding: 8px 10px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
  }
  .sn-card.open { border-color: var(--sn); }
  .sn-card { position: relative; }
  /* 메모지를 글에 꽂아 둔 핀 */
  .sn-pin { position: absolute; top: -6px; right: 8px; color: var(--danger); transform: rotate(18deg); pointer-events: none; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.25)); }
  .sn-pin :global(svg) { fill: currentColor; }
  .sn-card.selected { outline: 2px solid var(--accent); outline-offset: -1px; background: color-mix(in srgb, var(--accent) 10%, color-mix(in srgb, var(--sn) 14%, var(--surface))); }
  .sn-card.dragging { opacity: 0.45; }
  /* 삽입 위치 표시선 (카드 사이 간격 8px 의 가운데에 걸친다) */
  .sn-card.drop-before::before, .sn-card.drop-after::after {
    content: ''; position: absolute; left: 0; right: 0; height: 3px; border-radius: 2px; background: var(--accent); pointer-events: none;
  }
  .sn-card.drop-before::before { top: -6px; }
  .sn-card.drop-after::after { bottom: -6px; }
  .sn-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .sn-check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
  .sn-check input { width: 16px; height: 16px; margin: 0; cursor: pointer; accent-color: var(--primary); }
  .sn-title { font-weight: 700; font-size: 14px; word-break: break-word; }
  .sn-body { white-space: pre-wrap; word-break: break-word; max-height: 9em; overflow: hidden; }
  .open .sn-body { max-height: none; }
  .sn-body .ln { min-height: 1.2em; }
  .sn-body .ln.quote { border-left: 3px solid var(--border-strong); padding-left: 8px; color: var(--muted); }
  .sn-body .ln.li { padding-left: 1.1em; text-indent: -0.8em; }
  .sn-body .ln.li::before { content: '•'; display: inline-block; width: 0.8em; text-indent: 0; }
  .sn-body img { display: block; max-width: 100%; max-height: 160px; border-radius: 4px; margin: 4px 0; }
  .open .sn-body img { max-height: none; }
  /* 원전 배지 */
  .sn-badge {
    align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; max-width: 100%; box-sizing: border-box;
    padding: 1px 8px 1px 6px; border-radius: 10px; font-size: 11.5px; line-height: 1.5; text-decoration: none;
    color: var(--muted); background: color-mix(in srgb, var(--text) 8%, transparent); border: 1px solid var(--border);
  }
  .sn-badge span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  a.sn-badge { color: var(--primary); }
  a.sn-badge:hover { background: var(--accent-soft); border-color: var(--accent); }
  .sn-excerpt { font-size: 12px; font-style: italic; color: var(--muted); word-break: break-word; }
  .sn-meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .sn-date { font-size: 11px; color: var(--muted); }
  .sn-ops { display: flex; gap: 2px; }
  .sn-ops button { background: none; border: none; padding: 3px; border-radius: 4px; color: var(--muted); cursor: pointer; display: inline-flex; }
  .sn-ops button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
  .sn-ops button:disabled { opacity: 0.4; cursor: not-allowed; }
  .sn-ops button.primary { padding: 4px 10px; color: var(--on-primary); background: var(--primary); }
  .sn-edit {
    width: 100%; box-sizing: border-box; font: inherit; color: var(--text); background: var(--bg);
    border: 1px solid var(--border-strong); border-radius: 4px; padding: 4px 6px; resize: vertical;
  }
  .sn-colorbtn { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 2px 8px; background: none; border: 1px solid var(--border); border-radius: 4px; color: var(--muted); cursor: pointer; }
  .sn-colorbtn:hover { background: var(--hover); color: var(--text); }
  .sn-swatches { display: flex; flex-wrap: wrap; gap: 8px; padding: 6px 10px 8px; }
  .dot { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; background: var(--c); cursor: pointer; padding: 0; }
  .dot.on { border-color: var(--text); }
  .sn-similar h4 { margin: 0 0 4px; font-size: 12px; color: var(--muted); }
  .sn-similar p { margin: 0; font-size: 12px; color: var(--muted); }
  .sn-similar ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .sn-similar li button {
    width: 100%; text-align: left; background: none; border: none; padding: 3px 4px; border-radius: 4px;
    color: var(--text); font-size: 12px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .sn-similar li button:hover { background: var(--hover); }
</style>
