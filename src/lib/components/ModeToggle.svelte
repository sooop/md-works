<script lang="ts">
  import Eye from '@lucide/svelte/icons/eye';
  import Pencil from '@lucide/svelte/icons/pencil';
  import { doc } from '../store.svelte';
  import { tip } from '../tooltip.svelte';
</script>

<button
  class="icon-btn" class:on={doc.edit} role="switch" aria-checked={doc.edit}
  aria-label={doc.edit ? '편집 모드 (누르면 읽기 모드로)' : '읽기 모드 (누르면 편집 모드로)'}
  use:tip={doc.edit ? { title: '편집 중', lines: ['누르면 읽기 모드로'], kbd: 'Ctrl+Alt+E' } : { title: '읽기 모드', lines: ['본문이 바뀌지 않습니다. 누르면 편집 모드로'], kbd: 'Ctrl+Alt+E' }}
  onclick={() => (doc.edit = !doc.edit)}
>
  {#if doc.edit}<Pencil size={18} />{:else}<Eye size={18} />{/if}
</button>
