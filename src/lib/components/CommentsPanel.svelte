<script lang="ts">
  import CommentItem from './CommentItem.svelte';
  import { cm, isLost } from '../comments/store.svelte';

  // 본문 위치 순으로 보여 주고, 위치를 잃은 코멘트는 맨 아래에 모은다
  const shown = $derived(cm.items.filter((c) => !(cm.hideResolved && c.resolved)));
  const placed = $derived(shown.filter((c) => !isLost(c.id)).sort((a, b) => cm.ranges[a.id].from - cm.ranges[b.id].from));
  const lost = $derived(shown.filter((c) => isLost(c.id)));
  const resolvedCount = $derived(cm.items.filter((c) => c.resolved).length);
</script>

<div class="cm-panel">
  {#if !cm.key}
    <p class="empty">문서를 열면 이 문서의 코멘트가 보입니다.</p>
  {:else if !cm.loaded}
    <p class="empty">불러오는 중…</p>
  {:else}
    <div class="cm-head">
      <span>{cm.items.length ? `${cm.items.length}개` : ''}</span>
      {#if resolvedCount}
        <label class="check"><input type="checkbox" bind:checked={cm.hideResolved} />해결된 것 숨기기</label>
      {/if}
    </div>
    <div class="cm-list">
      {#each placed as c (c.id)}<CommentItem id={c.id} quote />{/each}
      {#if lost.length}
        <h3 class="cm-lost-head">위치 잃음 <span>{lost.length}</span></h3>
        {#each lost as c (c.id)}<CommentItem id={c.id} quote />{/each}
      {/if}
      {#if !cm.items.length}
        <p class="empty">코멘트가 없습니다. 본문에서 글자를 선택하고 코멘트 버튼을 누르세요 (Ctrl+Alt+M). 코멘트는 원문 파일을 바꾸지 않습니다.</p>
      {:else if !placed.length && !lost.length}
        <p class="empty">표시할 코멘트가 없습니다 (해결된 코멘트 숨김 중).</p>
      {/if}
    </div>
  {/if}
</div>
