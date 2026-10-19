<script lang="ts">
  import { tick } from 'svelte';
  import Check from '@lucide/svelte/icons/check';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Link from '@lucide/svelte/icons/link';
  import { cm, isLost, editComment, toggleResolved, removeComment, select, reattach } from '../comments/store.svelte';
  import { relTime } from '../utils';

  // quote: 본문에서 인용한 원문을 함께 보여 줄지(사이드바). 팝오버에서는 생략한다.
  let { id, quote = false }: { id: string; quote?: boolean } = $props();

  const c = $derived(cm.items.find((x) => x.id === id));
  const lost = $derived(isLost(id));

  let editing = $state(false);
  let draft = $state('');
  let area = $state<HTMLTextAreaElement>();

  async function startEdit() {
    if (!c) return;
    draft = c.text;
    editing = true;
    await tick();
    area?.focus();
  }
  function commit() {
    editComment(id, draft);
    editing = false;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = false; }
  }
</script>

{#if c}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="cm-item" class:resolved={c.resolved} class:lost class:active={cm.active === id} onclick={() => { if (!editing && !lost) select(id); }}>
    {#if quote}<blockquote class="cm-quote" title={c.quote}>{c.quote}</blockquote>{/if}
    {#if lost}<p class="cm-lost">위치를 찾지 못했습니다. 본문에서 붙일 곳을 선택한 뒤 연결 버튼을 누르세요.</p>{/if}
    {#if editing}
      <textarea bind:this={area} bind:value={draft} onkeydown={onKey} rows="3" aria-label="코멘트 수정"></textarea>
      <div class="cm-actions">
        <button onclick={() => (editing = false)}>취소</button>
        <button class="primary" disabled={!draft.trim()} onclick={commit}>저장</button>
      </div>
    {:else}
      <p class="cm-text">{c.text}</p>
      <div class="cm-meta">
        <span title={new Date(c.created).toLocaleString('ko-KR')}>{relTime(c.updated)}{c.resolved ? ' · 해결됨' : ''}</span>
        <span class="cm-ops">
          {#if lost}<button class="icon-btn" title="지금 선택한 본문에 다시 붙이기" aria-label="다시 붙이기" onclick={(e) => { e.stopPropagation(); reattach(id); }}><Link size={14} /></button>{/if}
          <button class="icon-btn" title={c.resolved ? '다시 열기' : '해결됨으로 표시'} aria-label={c.resolved ? '다시 열기' : '해결'} onclick={(e) => { e.stopPropagation(); toggleResolved(id); }}>{#if c.resolved}<Undo2 size={14} />{:else}<Check size={14} />{/if}</button>
          <button class="icon-btn" title="수정" aria-label="수정" onclick={(e) => { e.stopPropagation(); void startEdit(); }}><Pencil size={14} /></button>
          <button class="icon-btn" title="삭제" aria-label="삭제" onclick={(e) => { e.stopPropagation(); removeComment(id); }}><Trash2 size={14} /></button>
        </span>
      </div>
    {/if}
  </div>
{/if}
