<script lang="ts">
  import { tick } from 'svelte';
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import Unlink from '@lucide/svelte/icons/unlink';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import { doc } from '../store.svelte';
  import { SNIPPET_COLORS, type Snippet } from '../works/types';
  import { COLOR_HEX } from '../snippets/colors';
  import { suggestProvider } from '../works/suggest';
  import { splitBody, bodyLines, suggestCandidates, snippetText } from '../snippets/filter';
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
  const parts = $derived(splitBody(s.body));
  const dateLabel = $derived(new Date(s.createdAt).toLocaleDateString('ko-KR'));

  // ---- 인라인 수정 ----
  let editing = $state(false);
  let body = $state('');
  let url = $state('');
  let title = $state('');
  let excerpt = $state('');
  function startEdit() {
    body = s.body; url = s.source?.url ?? ''; title = s.source?.title ?? ''; excerpt = s.source?.excerpt ?? '';
    editing = true;
  }
  async function saveEdit() {
    if (!body.trim()) return;
    const u = url.trim();
    await editSnippet(s.id, {
      body: body.trim(),
      source: u ? { url: u, ...(title.trim() ? { title: title.trim() } : {}), ...(excerpt.trim() ? { excerpt: excerpt.trim() } : {}) } : undefined,
    });
    editing = false;
  }
  function onEditKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveEdit(); }
    else if (e.key === 'Escape') editing = false;
  }

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
  title={draggable ?'Alt+↑/↓ 로 한 칸 이동, 끌어서 순서 바꾸기' : undefined}
  onclick={toggle} onmousedown={onMouseDown} onkeydown={onKeyDown} ondragstart={onDragStart} ondragend={onDragEnd}
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
  {#if editing}
    <textarea class="sn-edit" bind:value={body} onkeydown={onEditKey} rows="4" aria-label="글감 내용"></textarea>
    <details class="sn-src" open={!!s.source}>
      <summary>원전</summary>
      <input bind:value={url} placeholder="URL" aria-label="원전 URL" spellcheck="false" />
      <input bind:value={title} placeholder="제목" aria-label="원전 제목" />
      <textarea bind:value={excerpt} placeholder="발췌" aria-label="원전 발췌" rows="2"></textarea>
    </details>
    <div class="sn-ops">
      <button class="primary" onclick={saveEdit} disabled={!body.trim()}>저장</button>
      <button onclick={() => (editing = false)}>취소</button>
    </div>
  {:else}
    <div class="sn-body">
      {#each parts as p}
        {#if p.type === 'img'}<img src={p.v} alt={p.alt} loading="lazy" />{:else}{#each bodyLines(p.v) as l}<div class={`ln ${l.kind}`}>{l.text}</div>{/each}{/if}
      {/each}
    </div>
    {#if s.source}
      <div class="sn-source">
        {#if s.source.title}<strong>{s.source.title}</strong>{/if}
        {#if /^https?:\/\//i.test(s.source.url)}<a href={s.source.url} target="_blank" rel="noopener noreferrer">{s.source.url}</a>{:else}<span>{s.source.url}</span>{/if}
        {#if s.source.excerpt}<q>{s.source.excerpt}</q>{/if}
      </div>
    {/if}
    <div class="sn-meta">
      <span class="sn-date">{dateLabel}{#if s.attachedDocs.length}{' · 붙은 글 '}{s.attachedDocs.length}{/if}</span>
      <span class="sn-ops">
        {#if trashed}
          <button title="복구 (원래 붙어 있던 글에 되붙음)" aria-label="복구" onclick={() => recoverSnippet(s.id)}><Undo2 size={14} /></button>
          <button title="완전 삭제" aria-label="완전 삭제" onclick={() => deleteForever(s.id)}><Trash2 size={14} /></button>
        {:else}
          {#if attached}
            <button title="이 글에서 떼기" aria-label="이 글에서 떼기" onclick={() => detachHere(s.id)}><Unlink size={14} /></button>
          {:else}
            <button title={doc.path ? '현재 글에 붙이기' : '문서를 열면 붙일 수 있습니다'} aria-label="현재 글에 붙이기" disabled={!doc.path} onclick={() => attachHere(s.id)}><Paperclip size={14} /></button>
          {/if}
          <button title="수정" aria-label="수정" onclick={startEdit}><Pencil size={14} /></button>
          <button title="휴지통으로" aria-label="휴지통으로" onclick={() => discardSnippet(s.id)}><Trash2 size={14} /></button>
        {/if}
      </span>
    </div>
    {#if open && !trashed}
      <div class="sn-colors" role="group" aria-label="색 라벨">
        {#each SNIPPET_COLORS as c}
          <button class="dot" class:on={s.color === c} style:--c={COLOR_HEX[c]} title={c} aria-label={`색: ${c}`} aria-pressed={s.color === c} onclick={() => editSnippet(s.id, { color: c })}></button>
        {/each}
      </div>
      <div class="sn-similar">
        <h4>비슷한 글감</h4>
        {#if similar.length}
          <ul>
            {#each similar as x (x.id)}
              <li><button onclick={() => (sn.openId = x.id)} title={x.body}>{snippetText(x).replace(/\s+/g, ' ').slice(0, 60)}</button></li>
            {/each}
          </ul>
        {:else}
          <p>비슷한 글감이 없습니다.</p>
        {/if}
      </div>
    {/if}
  {/if}
</div>

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
  .sn-body { white-space: pre-wrap; word-break: break-word; max-height: 9em; overflow: hidden; }
  .open .sn-body { max-height: none; }
  .sn-body .ln { min-height: 1.2em; }
  .sn-body .ln.quote { border-left: 3px solid var(--border-strong); padding-left: 8px; color: var(--muted); }
  .sn-body .ln.li { padding-left: 1.1em; text-indent: -0.8em; }
  .sn-body .ln.li::before { content: '•'; display: inline-block; width: 0.8em; text-indent: 0; }
  .sn-body img { display: block; max-width: 100%; max-height: 160px; border-radius: 4px; margin: 4px 0; }
  .open .sn-body img { max-height: none; }
  .sn-source { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--muted); word-break: break-all; }
  .sn-source a { color: var(--primary); }
  .sn-source q { font-style: italic; }
  .sn-meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .sn-date { font-size: 11px; color: var(--muted); }
  .sn-ops { display: flex; gap: 2px; }
  .sn-ops button { background: none; border: none; padding: 3px; border-radius: 4px; color: var(--muted); cursor: pointer; display: inline-flex; }
  .sn-ops button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
  .sn-ops button:disabled { opacity: 0.4; cursor: not-allowed; }
  .sn-ops button.primary { padding: 4px 10px; color: var(--on-primary); background: var(--primary); }
  .sn-edit, .sn-src textarea, .sn-src input {
    width: 100%; box-sizing: border-box; font: inherit; color: var(--text); background: var(--bg);
    border: 1px solid var(--border-strong); border-radius: 4px; padding: 4px 6px; resize: vertical;
  }
  .sn-src { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  .sn-src summary { cursor: pointer; color: var(--muted); }
  .sn-colors { display: flex; gap: 6px; }
  .dot { width: 16px; height: 16px; border-radius: 50%; border: 2px solid transparent; background: var(--c); cursor: pointer; padding: 0; }
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
