<script lang="ts">
  // 가져오기 미리보기: 다른 기기에서 지운 글 목록과 '이 기기에서도 삭제' 선택(기본 해제), 이미 지운 글이라 가져오지 않는 글.
  // 삭제는 사용자가 체크했을 때만 적용되고, 지우기 전 내용은 '삭제 전(<날짜>)' 글감으로 보존된다.
  import type { MergePreview } from '../bundle/api';

  let { preview, applyDeletions = $bindable(false) }: { preview: MergePreview; applyDeletions?: boolean } = $props();

  const deletable = $derived(preview.deletions.filter((d) => d.action === 'delete'));
  const kept = $derived(preview.deletions.filter((d) => d.action === 'keep-local'));
</script>

{#if deletable.length || kept.length}
  <section class="dels" aria-label="다른 기기에서 지운 글">
    {#if deletable.length}
      <p class="line"><b>다른 기기에서 지운 글 {deletable.length}개</b></p>
      <ul class="names" aria-label="다른 기기에서 지운 글 목록">
        {#each deletable as d (d.name)}<li>{d.name}</li>{/each}
      </ul>
      <label class="check">
        <input type="checkbox" bind:checked={applyDeletions} aria-label="다른 기기에서 지운 글을 이 기기에서도 삭제" />
        <span>체크하면 이 기기에서도 삭제하며 내용은 글감함에 보관됩니다</span>
      </label>
    {/if}
    {#if kept.length}
      <p class="hint">이 기기에서 더 나중에 고친 글 {kept.length}개는 지우지 않고 그대로 둡니다: {kept.map((d) => d.name).join(', ')}</p>
    {/if}
  </section>
{/if}
{#if preview.skippedDeleted.length}
  <p class="hint" role="status" aria-label="이미 지운 글이라 가져오지 않음">
    이미 지운 글이라 가져오지 않음 {preview.skippedDeleted.length}개: {preview.skippedDeleted.join(', ')}
  </p>
{/if}

<style>
  .dels { display: flex; flex-direction: column; gap: 6px; width: 100%; }
  .line { font-size: 13px; margin: 0; }
  .hint { font-size: 12px; color: var(--muted); margin: 0; }
  .names { margin: 0; padding-left: 1.2em; max-height: 120px; overflow-y: auto; font-size: 12.5px; }
  .check { display: flex; gap: 6px; align-items: center; font-size: 13px; }
  .check input { width: auto; margin: 0; }
</style>
