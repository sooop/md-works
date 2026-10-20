<script lang="ts">
  // 상단바의 글감·코멘트 패널 토글(⋯ 메뉴 오른쪽). 눌러서 열면 본문 옆에 고정되고, 다시 누르면 숨긴다.
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import { right, toggleRight } from '../rightbar/state.svelte';
  import { tip } from '../tooltip.svelte';
</script>

<button class="icon-btn" class:on={right.open} aria-pressed={right.open} aria-label="글감·코멘트 패널"
  use:tip={{ title: '글감·코멘트 패널', lines: [right.open ? '누르면 숨깁니다' : '누르면 본문 옆에 열립니다(고정). 오른쪽 가장자리에 마우스를 대도 잠깐 열립니다'] }}
  onclick={toggleRight}>
  <PanelRight size={18} />
</button>
