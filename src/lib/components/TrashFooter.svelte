<script lang="ts">
  // 파일 탭 맨 아래의 '휴지통 (N)' 단추(서버·스탠드얼론 공용). 비어 있으면 흐리게 보인다.
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { tip } from '../tooltip.svelte';

  interface Props { count: number; onOpen: () => void }
  let { count, onOpen }: Props = $props();
</script>

<div class="trash-foot">
  <button class:empty={!count} onclick={onOpen} aria-label={`휴지통 ${count}개 항목 열기`} use:tip={{ title: '휴지통', lines: ['삭제한 글·폴더를 복구하거나 완전히 지웁니다'] }}>
    <Trash2 size={14} /> 휴지통 ({count})
  </button>
</div>

<style>
  .trash-foot { flex: none; padding: 4px 8px; border-top: 1px solid var(--border); }
  button {
    display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--muted);
    font-size: 12px; padding: 4px 8px; border-radius: 6px;
    transition: background-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out), opacity var(--dur-1) var(--ease-out);
  }
  button:hover { background: var(--hover); color: var(--text); }
  button.empty { opacity: .55; }
  button.empty:hover { opacity: 1; }
  @media (max-width: 720px) { button { padding: 8px 10px; } }
</style>
