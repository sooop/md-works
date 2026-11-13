<script lang="ts">
  import { backdropFx, modalFx } from '../motion';
  import { guessTitle } from '../utils';
  import { modal, isTopModal, confirmDiscard } from '../modal';
  import ModalClose from './ModalClose.svelte';

  interface Props {
    open: boolean;
    onClose: () => void;
    onCreate: (name: string, text: string) => void | Promise<void>;
  }
  let { open, onClose, onCreate }: Props = $props();

  let text = $state('');
  let name = $state('');
  let nameTouched = false;
  let textEl = $state<HTMLTextAreaElement>();
  let overlayEl = $state<HTMLElement>();
  let asking = false;

  // 열 때마다 초기화하고 입력란에 포커스
  $effect(() => {
    if (open) {
      text = '';
      name = '';
      nameTouched = false;
      queueMicrotask(() => textEl?.focus());
    }
  });

  // 이름을 직접 고치기 전에는 본문 첫 줄에서 제안한다
  $effect(() => {
    if (!nameTouched) name = guessTitle(text);
  });

  async function create() {
    if (!text.trim()) return;
    const t = text;
    const n = name.trim() || '새 문서';
    onClose();
    await onCreate(n, t);
  }

  // Esc·백드롭·X·취소: 붙여넣은 내용이 있으면 버릴지 먼저 묻는다
  async function requestClose() {
    if (asking) return;
    if (text.trim()) {
      asking = true;
      const ok = await confirmDiscard().finally(() => { asking = false; });
      if (!ok) return;
    }
    onClose();
  }

  function onKey(e: KeyboardEvent) {
    if (!open || !isTopModal(overlayEl)) return; // 위에 뜬 확인창이 키를 받는다
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void create(); }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <div class="overlay" transition:backdropFx bind:this={overlayEl} use:modal={{ onClose: requestClose, focus: 'textarea' }}>
    <div class="dialog wide" role="dialog" transition:modalFx aria-modal="true" aria-label="붙여넣어 새 문서 만들기">
      <div class="dlg-head"><h2>붙여넣어 새 문서 만들기</h2><ModalClose onclick={requestClose} /></div>
      <textarea
        bind:this={textEl}
        bind:value={text}
        rows="14"
        spellcheck="false"
        placeholder=".md / .txt 내용을 여기에 붙여넣으세요"
      ></textarea>
      <label class="name-field">
        <span>문서 이름</span>
        <input bind:value={name} oninput={() => (nameTouched = true)} onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void create(); } }} placeholder="새 문서" spellcheck="false" />
      </label>
      <div class="actions">
        <span class="hint">Ctrl+Enter 로 만들기 (문서 이름에서는 Enter)</span>
        <button onclick={requestClose}>취소</button>
        <button class="primary" disabled={!text.trim()} onclick={create}>만들기</button>
      </div>
    </div>
  </div>
{/if}
