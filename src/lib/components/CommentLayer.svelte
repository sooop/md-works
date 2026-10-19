<script lang="ts">
  import { tick } from 'svelte';
  import MessageSquarePlus from '@lucide/svelte/icons/message-square-plus';
  import CommentItem from './CommentItem.svelte';
  import { cm, startDraft, cancelDraft, commitDraft, closePick } from '../comments/store.svelte';

  // 본문 위에 뜨는 요소: 선택 영역의 '코멘트' 버튼, 새 코멘트 입력, 코멘트를 눌렀을 때의 팝오버
  const W = 320;
  const place = (p: { x: number; y: number }, h: number) => ({
    left: Math.max(8, Math.min(p.x, innerWidth - W - 8)),
    top: Math.max(8, Math.min(p.y + 8, innerHeight - h - 8)),
  });

  // 터치 폭(≤720px 또는 pointer:coarse)에서는 Ctrl+Enter 안내 대신 '저장' 버튼을 눈에 띄게 한다
  let touch = $state(false);
  $effect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(max-width: 720px), (pointer: coarse)');
    const upd = () => { touch = mq.matches; };
    upd();
    mq.addEventListener('change', upd);
    return () => mq.removeEventListener('change', upd);
  });

  let area = $state<HTMLTextAreaElement>();
  $effect(() => {
    if (cm.draft && !cm.draft.text) void tick().then(() => area?.focus());
  });

  // 본문이 스크롤되면 화면 좌표에 고정된 요소들이 어긋나므로 거둔다
  $effect(() => {
    const onScroll = (e: Event) => {
      if ((e.target as Element | null)?.closest?.('.cm-layer')) return;
      cm.sel = null;
      cm.pick = null;
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  });

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'm') { e.preventDefault(); startDraft(); }
    else if (e.key === 'Escape') {
      if (cm.draft) cancelDraft();
      else if (cm.pick) closePick();
    }
  }
  function onDraftKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitDraft(); }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if cm.loaded}
  {#if cm.sel && !cm.draft}
    {@const p = place(cm.sel, 36)}
    <!-- 눌러도 본문 선택이 풀리지 않게 mousedown 의 기본 동작을 막는다 -->
    <!-- 터치 폭에서는 선택 위치 옆이 아니라 화면 오른쪽 아래에 고정한다(서식 툴바와 겹쳐 클릭을 가로채던 문제) -->
    <button class="cm-layer cm-add" class:cm-add-fixed={touch} style:left={touch ? null : `${p.left}px`} style:top={touch ? null : `${p.top}px`} title="선택한 본문에 코멘트 (Ctrl+Alt+M)" onmousedown={(e) => e.preventDefault()} onclick={startDraft}>
      <MessageSquarePlus size={15} />코멘트
    </button>
  {/if}

  {#if cm.draft}
    {@const p = place(cm.draft, 170)}
    <div class="cm-layer cm-pop" style:left="{p.left}px" style:top="{p.top}px" role="dialog" aria-label="새 코멘트">
      <textarea bind:this={area} bind:value={cm.draft.text} onkeydown={onDraftKey} rows="4" placeholder={touch ? '코멘트를 입력하세요' : '코멘트를 입력하세요 (Ctrl+Enter 로 저장)'} aria-label="코멘트 내용"></textarea>
      <div class="cm-actions" class:touch>
        <button onclick={cancelDraft}>취소</button>
        <button class="primary" disabled={!cm.draft.text.trim()} onclick={commitDraft}>저장</button>
      </div>
    </div>
  {/if}

  {#if cm.pick}
    {@const p = place(cm.pick, 120)}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={closePick}></div>
    <div class="cm-layer cm-pop" style:left="{p.left}px" style:top="{p.top}px" role="dialog" aria-label="코멘트">
      {#each cm.pick.ids as id (id)}<CommentItem {id} />{/each}
    </div>
  {/if}
{/if}
