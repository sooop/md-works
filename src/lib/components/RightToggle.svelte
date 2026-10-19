<script lang="ts">
  // 상단바의 오른쪽 사이드바(글감·코멘트) 토글
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import { right, toggleRight } from '../rightbar/state.svelte';
</script>

<button class="icon-btn" class:on={right.open} aria-pressed={right.open} aria-label="글감·코멘트 패널" title="글감·코멘트 패널 (Ctrl+Alt+G 글감 찾기)" onclick={toggleRight}>
  <PanelRight size={18} />
</button>
