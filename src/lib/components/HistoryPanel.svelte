<script lang="ts">
  import Editor from './Editor.svelte';
  import { listVersions, MAX_VERSIONS, type Version } from '../history';
  import { toast, errMsg } from '../store.svelte';
  import { relTime } from '../utils';

  interface Props {
    docKey: string; // 이력을 조회할 문서 키 (스탠드얼론: 문서 id, 서버: 파일 경로)
    resolveUrl: (src: string) => string | Promise<string>;
    onRestore: (content: string) => Promise<void>;
    open?: boolean; // 문서 메뉴의 '이력' 항목이 연다
  }
  let { docKey, resolveUrl, onRestore, open = $bindable(false) }: Props = $props();
  let versions = $state<Version[]>([]);
  let selectedId = $state('');
  let loading = $state(false);

  const selected = $derived(versions.find((v) => v.id === selectedId));

  async function load() {
    loading = true;
    try {
      versions = await listVersions(docKey);
      selectedId = versions[0]?.id ?? '';
    } catch (e) {
      versions = [];
      toast(`이력을 읽지 못했습니다: ${errMsg(e)}`, 'error');
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open) void load();
  });

  async function restore() {
    if (!selected) return;
    const content = selected.content;
    open = false;
    try {
      await onRestore(content);
      toast('선택한 버전으로 복원했습니다. 복원 전 내용은 이력에 남아 있습니다');
    } catch (e) {
      toast(`복원하지 못했습니다: ${errMsg(e)}`, 'error');
    }
  }

  const noop = () => {};
  const noUpload = async () => { throw new Error('이력 미리보기에서는 이미지를 추가할 수 없습니다'); };
</script>

<svelte:window onkeydown={(e) => { if (open && e.key === 'Escape') open = false; }} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) open = false; }}>
    <div class="dialog history" role="dialog" aria-modal="true" aria-label="버전 이력">
      <h2>버전 이력 <span class="sub">최근 {MAX_VERSIONS}개 · 이 브라우저에만 보관됩니다</span></h2>
      {#if loading}
        <p class="muted">불러오는 중…</p>
      {:else if !versions.length}
        <p class="muted">아직 이력이 없습니다. 문서를 열고 편집하면 5분 간격으로 쌓입니다.</p>
      {:else}
        <div class="history-body">
          <ul class="history-list">
            {#each versions as v (v.id)}
              <li>
                <button class:active={v.id === selectedId} onclick={() => (selectedId = v.id)} title={new Date(v.ts).toLocaleString('ko-KR')}>
                  <span>{relTime(v.ts)}</span>
                  <span class="muted">{v.content.length.toLocaleString('ko-KR')}자</span>
                </button>
              </li>
            {/each}
          </ul>
          <div class="history-preview">
            {#key selectedId}
              {#if selected}
                <Editor initial={selected.content} onChange={noop} upload={noUpload} {resolveUrl} readonly preview />
              {/if}
            {/key}
          </div>
        </div>
      {/if}
      <div class="actions">
        <button onclick={() => (open = false)}>닫기</button>
        <button class="primary" disabled={!selected} onclick={restore}>이 버전으로 복원</button>
      </div>
    </div>
  </div>
{/if}
