<script lang="ts">
  // 본문 오른쪽에 두고 쓰는 자료: 글감과 코멘트. 왼쪽 사이드바(파일·검색)와 따로 열고 닫는다.
  import X from '@lucide/svelte/icons/x';
  import SnippetPanel from './SnippetPanel.svelte';
  import CommentsPanel from './CommentsPanel.svelte';
  import SheetBackdrop from './SheetBackdrop.svelte';
  import { openCount } from '../comments/store.svelte';
  import { right, closeRight, setRightTab, setRightWidth, RIGHT_W } from '../rightbar/state.svelte';

  // 왼쪽 가장자리를 끌어 폭을 조절한다(오른쪽 패널이라 왼쪽으로 끌면 넓어진다). 방향키·더블클릭 초기화도 지원.
  let drag: { x: number; w: number } | null = null;
  function down(e: PointerEvent) {
    drag = { x: e.clientX, w: right.width };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
  }
  function move(e: PointerEvent) {
    if (drag) setRightWidth(drag.w + (drag.x - e.clientX), false);
  }
  function up() {
    if (!drag) return;
    drag = null;
    document.body.style.userSelect = '';
    setRightWidth(right.width); // 저장
  }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setRightWidth(right.width + step); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setRightWidth(right.width - step); }
    else if (e.key === 'Home') { e.preventDefault(); setRightWidth(RIGHT_W.min); }
    else if (e.key === 'End') { e.preventDefault(); setRightWidth(RIGHT_W.max); }
  }
</script>

{#if right.open}
  <aside class="sidebar right-sidebar" aria-label="글감과 코멘트" style:--right-w="{right.width}px">
    <!-- 포커스 가능한 separator(값이 있는 위젯)라 방향키로 조절한다 -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="rs-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="오른쪽 패널 폭 조절 (방향키, 더블클릭으로 초기화)"
      aria-valuenow={right.width}
      aria-valuemin={RIGHT_W.min}
      aria-valuemax={RIGHT_W.max}
      tabindex="0"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      ondblclick={() => setRightWidth(RIGHT_W.def)}
      onkeydown={key}
    ></div>
    <div class="sidetabs" role="tablist">
      <button role="tab" class:on={right.tab === 'snippets'} aria-selected={right.tab === 'snippets'} onclick={() => setRightTab('snippets')} title="글감함 (Ctrl+Alt+G 문구로 찾기, Ctrl+Alt+S 선택을 글감으로)">글감</button>
      <button role="tab" class:on={right.tab === 'comments'} aria-selected={right.tab === 'comments'} onclick={() => setRightTab('comments')} title="이 문서의 코멘트">코멘트{#if openCount()} <span class="cm-badge">{openCount()}</span>{/if}</button>
      <span class="spacer"></span>
      <button class="icon-btn rs-close" aria-label="오른쪽 패널 닫기" title="닫기" onclick={closeRight}><X size={15} /></button>
    </div>
    <div class="tabpane" hidden={right.tab !== 'snippets'}><SnippetPanel /></div>
    <div class="tabpane" hidden={right.tab !== 'comments'}><CommentsPanel /></div>
  </aside>
{/if}
<SheetBackdrop open={right.open} onClose={closeRight} />
