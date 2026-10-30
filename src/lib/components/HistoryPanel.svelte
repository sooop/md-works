<script lang="ts">
  import { backdropFx, modalFx } from '../motion';
  import { tip } from '../tooltip.svelte';
  import Editor from './Editor.svelte';
  import { listVersions, setVersionName, type Version } from '../history';
  import { diffText, applyHunks, blocksOf, displayBlock, displaySegs, isEmptyBlock } from '../history/diff';
  import { toast, errMsg } from '../store.svelte';
  import { relTime } from '../utils';

  interface Props {
    docKey: string; // 이력을 조회할 문서 키 (스탠드얼론: 문서 id, 서버: 파일 경로)
    resolveUrl: (src: string) => string | Promise<string>;
    onRestore: (content: string) => Promise<void>;
    open?: boolean; // 문서 메뉴의 '이력' 항목이 연다
    current?: string; // 현재 본문. 있으면 '현재와의 차이' 보기를 쓸 수 있다
  }
  let { docKey, resolveUrl, onRestore, open = $bindable(false), current }: Props = $props();
  let versions = $state<Version[]>([]);
  let selectedId = $state('');
  let loading = $state(false);
  let view = $state<'preview' | 'diff'>('preview');
  let checked = $state<string[]>([]); // 되돌릴 hunk id
  let naming = $state(false);
  let nameDraft = $state('');

  const selected = $derived(versions.find((v) => v.id === selectedId));
  const hunks = $derived(selected && current !== undefined && view === 'diff' ? diffText(selected.content, current) : []);

  async function load(keep = '') {
    loading = true;
    try {
      versions = await listVersions(docKey);
      selectedId = versions.some((v) => v.id === keep) ? keep : (versions[0]?.id ?? '');
    } catch (e) {
      versions = [];
      toast(`이력을 읽지 못했습니다: ${errMsg(e)}`, 'error');
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open) { view = 'preview'; naming = false; void load(); }
  });
  // 다른 버전을 고르면 hunk 선택·이름 입력을 초기화한다
  $effect(() => { void selectedId; checked = []; naming = false; });

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

  async function restoreHunks() {
    if (!selected || current === undefined || !checked.length) return;
    const content = applyHunks(current, blocksOf(selected.content), checked);
    open = false;
    try {
      await onRestore(content);
      toast(`선택한 변경 ${checked.length}건을 되돌렸습니다. 되돌리기 전 내용은 이력에 남아 있습니다`);
    } catch (e) {
      toast(`되돌리지 못했습니다: ${errMsg(e)}`, 'error');
    }
  }

  function startNaming() { nameDraft = selected?.name ?? ''; naming = true; }
  async function saveName(name: string | undefined) {
    if (!selected) return;
    const id = selected.id;
    naming = false;
    try {
      await setVersionName(docKey, id, name);
      await load(id);
    } catch (e) {
      toast(`이름을 저장하지 못했습니다: ${errMsg(e)}`, 'error');
    }
  }

  const toggle = (id: string) => { checked = checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id]; };
  const kindLabel = { added: '현재에서 추가됨', removed: '현재에서 삭제됨', changed: '변경됨' } as const;

  const noop = () => {};
  const noUpload = async () => { throw new Error('이력 미리보기에서는 이미지를 추가할 수 없습니다'); };
</script>

<svelte:window onkeydown={(e) => { if (open && e.key === 'Escape') open = false; }} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay" transition:backdropFx onclick={(e) => { if (e.target === e.currentTarget) open = false; }}>
    <div class="dialog history" role="dialog" transition:modalFx aria-modal="true" aria-label="버전 이력">
      <h2>버전 이력 <span class="sub">24시간 이내 전부 · 이후 시간당/일당 1개로 정리 · 이름 붙인 버전은 보존 · 노트 폴더(.works)와 함께 보관됩니다</span></h2>
      {#if loading}
        <p class="muted">불러오는 중…</p>
      {:else if !versions.length}
        <p class="muted">아직 이력이 없습니다. 문서를 열고 편집하면 5분 간격으로 쌓입니다.</p>
      {:else}
        <div class="history-body">
          <ul class="history-list">
            {#each versions as v (v.id)}
              <li>
                <button class:active={v.id === selectedId} onclick={() => (selectedId = v.id)} use:tip={new Date(v.ts).toLocaleString('ko-KR')}>
                  <span class="vtitle">
                    {#if v.name}<span class="pin" use:tip={'이름을 붙인 버전'}>📌 {v.name}</span>{/if}
                    <span>{relTime(v.ts)}</span>
                  </span>
                  <span class="muted">{v.content.length.toLocaleString('ko-KR')}자</span>
                </button>
              </li>
            {/each}
          </ul>
          <div class="history-main">
            <div class="history-tools">
              <button class:active={view === 'preview'} onclick={() => (view = 'preview')}>미리보기</button>
              <button class:active={view === 'diff'} disabled={current === undefined} onclick={() => (view = 'diff')}>현재와의 차이</button>
              <span class="grow"></span>
              {#if naming}
                <!-- svelte-ignore a11y_autofocus -->
                <input class="name-input" bind:value={nameDraft} maxlength="60" placeholder="버전 이름" autofocus
                  onkeydown={(e) => { if (e.key === 'Enter') void saveName(nameDraft); else if (e.key === 'Escape') { e.stopPropagation(); naming = false; } }} />
                <button onclick={() => saveName(nameDraft)}>저장</button>
                <button onclick={() => (naming = false)}>취소</button>
              {:else}
                <button onclick={startNaming}>{selected?.name ? '이름 변경' : '이름 붙이기'}</button>
                {#if selected?.name}<button onclick={() => saveName(undefined)}>이름 해제</button>{/if}
              {/if}
            </div>
            <div class="history-preview">
              {#if view === 'diff'}
                {#if !hunks.length}
                  <p class="muted pad">현재 본문과 차이가 없습니다.</p>
                {:else}
                  <p class="muted pad">선택한 버전 → 현재 본문의 문단 단위 차이입니다. 체크한 변경만 이 버전 쪽으로 되돌립니다.</p>
                  {#each hunks as h (h.id)}
                    <div class="hunk {h.kind}">
                      <label class="hunk-head">
                        <input type="checkbox" checked={checked.includes(h.id)} onchange={() => toggle(h.id)} />
                        <span>{kindLabel[h.kind]}</span>
                      </label>
                      {#if h.kind === 'changed'}
                        {#each h.pairs as p, i (i)}
                          <pre class="block">{#each displaySegs(p) as s, j (j)}{#if s.type === 'eq'}{s.text}{:else if s.type === 'del'}<del class:dim={isEmptyBlock(p.ver)}>{s.text}</del>{:else}<ins class:dim={isEmptyBlock(p.cur)}>{s.text}</ins>{/if}{/each}</pre>
                        {/each}
                        {#each h.ver.slice(h.pairs.length) as t, i (i)}<pre class="block"><del class:dim={isEmptyBlock(t)}>{displayBlock(t)}</del></pre>{/each}
                        {#each h.cur.slice(h.pairs.length) as t, i (i)}<pre class="block"><ins class:dim={isEmptyBlock(t)}>{displayBlock(t)}</ins></pre>{/each}
                      {:else if h.kind === 'removed'}
                        {#each h.ver as t, i (i)}<pre class="block"><del class:dim={isEmptyBlock(t)}>{displayBlock(t)}</del></pre>{/each}
                      {:else}
                        {#each h.cur as t, i (i)}<pre class="block"><ins class:dim={isEmptyBlock(t)}>{displayBlock(t)}</ins></pre>{/each}
                      {/if}
                    </div>
                  {/each}
                {/if}
              {:else}
                {#key selectedId}
                  {#if selected}
                    <Editor initial={selected.content} onChange={noop} upload={noUpload} {resolveUrl} readonly preview />
                  {/if}
                {/key}
              {/if}
            </div>
          </div>
        </div>
      {/if}
      <div class="actions">
        <button onclick={() => (open = false)}>닫기</button>
        {#if view === 'diff'}
          <button disabled={!checked.length} onclick={restoreHunks}>선택한 변경만 되돌리기{checked.length ? ` (${checked.length})` : ''}</button>
        {/if}
        <button class="primary" disabled={!selected} onclick={restore}>이 버전으로 전체 복원</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .history-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .history-main .history-preview { flex: 1; min-height: 0; }
  .history-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .history-tools .grow { flex: 1; }
  .history-tools button.active { background: var(--selected); }
  .name-input { width: 160px; }
  .vtitle { display: flex; flex-direction: column; min-width: 0; }
  .pin { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pad { padding: 8px 16px 0; margin: 0; }
  .hunk { margin: 10px 16px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .hunk-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-size: 12px; background: var(--hover); cursor: pointer; }
  .hunk-head input[type="checkbox"] { width: auto; margin: 0; padding: 0; flex: none; }
  .hunk-head span { white-space: nowrap; }
  .block { margin: 0; padding: 8px 12px; white-space: pre-wrap; word-break: break-word; font: inherit; font-size: 13px; border-top: 1px solid var(--border); }
  del { background: rgba(220, 60, 60, 0.18); text-decoration: line-through; }
  ins { background: rgba(60, 170, 90, 0.22); text-decoration: none; }
  .dim { opacity: 0.55; font-style: italic; }
</style>
