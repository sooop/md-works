<script lang="ts">
  // 글 목록 '선택 모드' 토글 단추(트리의 필터 줄, 정렬 단추 옆에 둔다). 켜면 행마다 체크박스가 보이고 행 클릭이 선택 토글이 된다(터치용).
  // 서버·스탠드얼론 셸이 같은 단추를 쓴다. 상태는 treeSelect.svelte.ts 의 tsel.
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import { tip } from '../tooltip.svelte';
  import { tsel, setMode } from '../treeSelect.svelte';

  let { size = 17 }: { size?: number } = $props();
</script>

<button
  class="icon-btn" class:on={tsel.mode} aria-pressed={tsel.mode}
  aria-label={tsel.mode ? '선택 모드 끄기' : '선택 모드 켜기'}
  use:tip={{ title: '선택 모드', lines: ['항목을 눌러 여러 개를 고릅니다', 'Ctrl/Shift+클릭도 가능 · Esc 로 종료'] }}
  onclick={() => setMode(!tsel.mode)}
><ListChecks {size} /></button>
