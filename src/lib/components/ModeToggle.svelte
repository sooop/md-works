<script lang="ts">
  import Eye from '@lucide/svelte/icons/eye';
  import Pencil from '@lucide/svelte/icons/pencil';
  import { doc } from '../store.svelte';

</script>

<button class="modetoggle" aria-label={doc.edit ? '편집 모드 (누르면 읽기 모드로)' : '읽기 모드 (누르면 편집 모드로)'} class:active={doc.edit} role="switch" aria-checked={doc.edit} onclick={() => (doc.edit = !doc.edit)}
  title={doc.edit ? '편집 모드: 누르면 읽기 모드로' : '읽기 모드: 본문이 바뀌지 않습니다. 누르면 편집 모드로'}>
  {#if doc.edit}<Pencil size={15} /><span class="mt-label">편집 중</span>{:else}<Eye size={15} /><span class="mt-label">읽기</span>{/if}
</button>
