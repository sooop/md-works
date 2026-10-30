<script lang="ts">
  import { backdropFx, modalFx } from '../motion';
  import { guessTitle } from '../utils';

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

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void create(); }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay" transition:backdropFx onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="dialog wide" role="dialog" transition:modalFx aria-modal="true" aria-label="붙여넣어 새 문서 만들기">
      <h2>붙여넣어 새 문서 만들기</h2>
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
        <button onclick={onClose}>취소</button>
        <button class="primary" disabled={!text.trim()} onclick={create}>만들기</button>
      </div>
    </div>
  </div>
{/if}
