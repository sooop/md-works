<script lang="ts">
  // 좌우 패널 단축키: Ctrl+Alt+[ 파일 목록(왼쪽), Ctrl+Alt+] 글감·목차·코멘트(오른쪽). 패널을 닫아도 동작하도록 셸에 항상 마운트한다.
  import { writing } from '../writing/state.svelte';
  import { left, viewport, isDocked, toggleLeft, rightPeek } from '../sidebar/state.svelte';
  import { toggleRight, openRight, closeRightOnMobile } from '../rightbar/state.svelte';

  function toggleLeftPanel() {
    if (viewport.mobile) { toggleLeft(); if (left.open) closeRightOnMobile(); return; }
    // 집중 모드에서는 본문 옆에 붙은(고정) 목록이 숨겨져 있어 여닫아도 보이지 않는다. 고정이 아니면 팝오버로 여닫는다
    if (writing.focus) { if (!isDocked()) left.open = !left.open; return; }
    toggleLeft();
  }
  function toggleRightPanel() {
    if (writing.focus && !viewport.mobile) { if (rightPeek.open) rightPeek.open = false; else openRight(); return; }
    toggleRight();
  }

  function onKey(e: KeyboardEvent) {
    if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey || e.isComposing) return;
    if (e.code === 'BracketLeft') { e.preventDefault(); toggleLeftPanel(); }
    else if (e.code === 'BracketRight') { e.preventDefault(); toggleRightPanel(); }
  }
</script>

<svelte:window onkeydown={onKey} />
