<script lang="ts">
  import { tick } from 'svelte';
  import Check from '@lucide/svelte/icons/check';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Link from '@lucide/svelte/icons/link';
  import StickyNote from '@lucide/svelte/icons/sticky-note';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import { cm, isLost, editMessage, addReply, removeMessage, removeThread, sendToSnippet, toggleResolved, select, reattach } from '../comments/store.svelte';
  import { relTime } from '../utils';

  // quote: 본문에서 인용한 원문을 함께 보여 줄지(사이드바). 사이드바에서는 첫 메시지 요약 + 답글 수로 접어 두고, 팝오버에서는 전부 펼친다.
  let { id, quote = false }: { id: string; quote?: boolean } = $props();

  const c = $derived(cm.items.find((x) => x.id === id));
  const lost = $derived(isLost(id));
  let open = $state(false);
  const expanded = $derived(!quote || open);

  let editing = $state(''); // 수정 중인 메시지 id
  let draft = $state('');
  let reply = $state('');
  let area = $state<HTMLTextAreaElement>();

  async function startEdit(msgId: string, text: string) {
    draft = text;
    editing = msgId;
    await tick();
    area?.focus();
  }
  function commit() {
    editMessage(id, editing, draft);
    editing = '';
  }
  function onEditKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = ''; }
  }
  function sendReply() {
    if (!reply.trim()) return;
    addReply(id, reply);
    reply = '';
  }
  // Enter 전송, Shift+Enter 줄바꿈
  function onReplyKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
  }
  function onItemClick(e: MouseEvent) {
    if ((e.target as Element).closest('textarea, button')) return;
    if (!editing && !lost) select(id);
  }
</script>

{#if c}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="cm-item" class:resolved={c.resolved} class:lost class:active={cm.active === id} onclick={onItemClick}>
    {#if quote}<blockquote class="cm-quote" title={c.anchor.quote}>{c.anchor.quote}</blockquote>{/if}
    {#if lost}<p class="cm-lost">위치를 찾지 못했습니다. 본문에서 붙일 곳을 선택한 뒤 연결 버튼을 누르세요.</p>{/if}
    {#if expanded}
      <div class="cm-msgs">
        {#each c.messages as m (m.id)}
          <div class="cm-msg">
            {#if editing === m.id}
              <textarea bind:this={area} bind:value={draft} onkeydown={onEditKey} rows="3" aria-label="메시지 수정"></textarea>
              <div class="cm-actions">
                <button onclick={() => (editing = '')}>취소</button>
                <button class="primary" disabled={!draft.trim()} onclick={commit}>저장</button>
              </div>
            {:else}
              <p class="cm-text">{m.text}</p>
              <div class="cm-meta">
                <span title={new Date(m.ts).toLocaleString('ko-KR')}>{relTime(m.ts)}</span>
                <span class="cm-ops">
                  <button class="icon-btn" title="수정" aria-label="메시지 수정" onclick={() => void startEdit(m.id, m.text)}><Pencil size={13} /></button>
                  <button class="icon-btn" title={m.id === c.messages[0].id ? '삭제 (스레드 전체)' : '삭제'} aria-label="메시지 삭제" onclick={() => void removeMessage(id, m.id)}><Trash2 size={13} /></button>
                </span>
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <textarea class="cm-reply" bind:value={reply} onkeydown={onReplyKey} rows="2" placeholder="답글 (Enter 전송, Shift+Enter 줄바꿈)" aria-label="답글 입력"></textarea>
    {:else}
      <p class="cm-text cm-summary">{c.messages[0]?.text}</p>
    {/if}
    <div class="cm-meta cm-foot">
      <span title={new Date(c.createdAt).toLocaleString('ko-KR')}>
        {relTime(c.updatedAt)}{c.resolved ? ' · 해결됨' : ''}{#if c.messages.length > 1 && !expanded} · 답글 {c.messages.length - 1}개{/if}
      </span>
      <span class="cm-ops">
        {#if quote}
          <button class="icon-btn" title={open ? '접기' : '답글 보기·쓰기'} aria-label={open ? '접기' : '펼치기'} onclick={() => (open = !open)}>{#if open}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}</button>
        {/if}
        {#if lost}<button class="icon-btn" title="지금 선택한 본문에 다시 붙이기" aria-label="다시 붙이기" onclick={() => reattach(id)}><Link size={14} /></button>{/if}
        <button class="icon-btn" title="글감으로 보내기 (코멘트는 글감으로 바뀝니다)" aria-label="글감으로 보내기" onclick={() => void sendToSnippet(id)}><StickyNote size={14} /></button>
        <button class="icon-btn" title={c.resolved ? '다시 열기' : '해결됨으로 표시'} aria-label={c.resolved ? '다시 열기' : '해결'} onclick={() => toggleResolved(id)}>{#if c.resolved}<Undo2 size={14} />{:else}<Check size={14} />{/if}</button>
        <button class="icon-btn" title="스레드 삭제" aria-label="스레드 삭제" onclick={() => void removeThread(id)}><Trash2 size={14} /></button>
      </span>
    </div>
  </div>
{/if}

<style>
  .cm-msgs { display: flex; flex-direction: column; gap: 6px; }
  .cm-msg { border-top: 1px solid var(--border); padding-top: 6px; }
  .cm-msg:first-child { border-top: 0; padding-top: 0; }
  .cm-summary { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .cm-reply { resize: vertical; }
  .cm-foot { border-top: 1px solid var(--border); padding-top: 4px; }
</style>
