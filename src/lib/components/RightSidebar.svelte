<script lang="ts">
  // 본문 오른쪽에 두고 쓰는 자료: 글감과 코멘트. 왼쪽 사이드바(파일·검색)와 따로 열고 닫는다.
  // 닫혀 있거나 집중 모드이면 오른쪽 가장자리에 마우스를 대면 팝오버로 나타난다.
  import X from '@lucide/svelte/icons/x';
  import SnippetPanel from './SnippetPanel.svelte';
  import CommentsPanel from './CommentsPanel.svelte';
  import SheetBackdrop from './SheetBackdrop.svelte';
  import Resizer from './Resizer.svelte';
  import { openCount } from '../comments/store.svelte';
  import { right, closeRight, setRightTab, setRightWidth, RIGHT_W } from '../rightbar/state.svelte';
  import { writing } from '../writing/state.svelte';
  import { rightPeek, viewport } from '../sidebar/state.svelte';
  import { edgeHover, peekPanel } from '../sidebar/peek';
  import { tip } from '../tooltip.svelte';

  // 닫아 둔 상태(또는 집중 모드)에서는 붙어 있지 않고 오른쪽 가장자리 호버로 팝오버처럼 나타난다
  const peek = $derived(!viewport.mobile && (writing.focus || !right.open));
  const shown = $derived(peek ? rightPeek.open : right.open);
  $effect(() => { if (!peek) rightPeek.open = false; });
</script>

{#if peek && !rightPeek.open}
  <div class="right-edge" data-side="right" use:edgeHover={() => (rightPeek.open = true)}></div>
{/if}
{#if shown}
  <aside
    class="sidebar right-sidebar" class:peek aria-label="글감과 코멘트" style:--right-w="{right.width}px"
    use:peekPanel={{ active: () => peek, close: () => (rightPeek.open = false) }}
  >
    <Resizer side="right" value={right.width} min={RIGHT_W.min} max={RIGHT_W.max} def={RIGHT_W.def} label="오른쪽 패널 폭 조절" onchange={(w, save) => setRightWidth(w, save)} />
    <div class="sidetabs" role="tablist">
      <button role="tab" class:on={right.tab === 'snippets'} aria-selected={right.tab === 'snippets'} onclick={() => setRightTab('snippets')} use:tip={{ title: '글감함', lines: ['Ctrl+Alt+G 문구로 찾기', 'Ctrl+Alt+S 선택을 글감으로'] }}>글감</button>
      <button role="tab" class:on={right.tab === 'comments'} aria-selected={right.tab === 'comments'} onclick={() => setRightTab('comments')} use:tip={'이 문서의 코멘트'}>코멘트{#if openCount()} <span class="cm-badge">{openCount()}</span>{/if}</button>
      <span class="spacer"></span>
      <button class="icon-btn rs-close" aria-label="오른쪽 패널 닫기" use:tip={'닫기'} onclick={() => { if (peek) rightPeek.open = false; else closeRight(); }}><X size={15} /></button>
    </div>
    <div class="tabpane" hidden={right.tab !== 'snippets'}><SnippetPanel /></div>
    <div class="tabpane" hidden={right.tab !== 'comments'}><CommentsPanel /></div>
  </aside>
{/if}
<SheetBackdrop open={right.open && !peek} onClose={closeRight} />
