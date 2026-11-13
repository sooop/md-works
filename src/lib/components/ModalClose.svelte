<script lang="ts">

  // 모달 우상단의 닫기 단추(X 아이콘). 닫기는 이 단추와 Esc 로 통일하고, 실행 단추만 .primary 로 둔다.

  import X from '@lucide/svelte/icons/x';

  import { tip } from '../tooltip.svelte';



  let { onclick, disabled = false }: { onclick: () => void; disabled?: boolean } = $props();

</script>



<button type="button" class="icon-btn modal-x" aria-label="닫기" data-modal-x {disabled} use:tip={{ title: '닫기', kbd: 'Esc' }} {onclick}><X size={18} /></button>



<style>

  .modal-x { flex: none; margin: -4px -6px 0 0; }

</style>

