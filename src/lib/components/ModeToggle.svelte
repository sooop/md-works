<script lang="ts">
  import Eye from '@lucide/svelte/icons/eye';
  import Pencil from '@lucide/svelte/icons/pencil';
  import MessageSquareText from '@lucide/svelte/icons/message-square-text';
  import { doc, settings, persistSettings } from '../store.svelte';
  import { cm } from '../comments/store.svelte';
  import { tip } from '../tooltip.svelte';
</script>

{#if !doc.edit && cm.loaded && (cm.items.length || settings.commentView)}
  <button
    class="icon-btn" class:on={settings.commentView} aria-pressed={settings.commentView} aria-label="코멘트 보기"
    use:tip={{ title: '코멘트 보기', lines: [settings.commentView ? '본문의 코멘트 번호와 문서 끝 코멘트 목록을 숨깁니다' : '본문에 코멘트 번호를 달고 문서 끝에 코멘트 목록을 보입니다(인쇄·PDF에도 포함)'] }}
    onclick={() => { settings.commentView = !settings.commentView; persistSettings(); }}
  >
    <MessageSquareText size={18} />
  </button>
{/if}
<button
  class="icon-btn" class:on={doc.edit} role="switch" aria-checked={doc.edit}
  aria-label={doc.edit ? '편집 모드 (누르면 읽기 모드로)' : '읽기 모드 (누르면 편집 모드로)'}
  use:tip={doc.edit ? { title: '편집 중', lines: ['누르면 읽기 모드로'], kbd: 'Ctrl+Alt+E' } : { title: '읽기 모드', lines: ['본문이 바뀌지 않습니다. 누르면 편집 모드로'], kbd: 'Ctrl+Alt+E' }}
  onclick={() => (doc.edit = !doc.edit)}
>
  {#if doc.edit}<Pencil size={18} />{:else}<Eye size={18} />{/if}
</button>
