<script lang="ts">
  import { backdropFx, modalFx } from '../motion';
  import { tip } from '../tooltip.svelte';
  import Editor from './Editor.svelte';
  import { listVersions, setVersionName, type Version } from '../history';
  import { diffText, applyHunks, blocksOf, displayBlock, displaySegs, isEmptyBlock } from '../history/diff';
  import { toast, errMsg } from '../store.svelte';
  import PinIcon from '@lucide/svelte/icons/pin';
  import SearchIcon from '@lucide/svelte/icons/search';
  import XIcon from '@lucide/svelte/icons/x';
  import CaseIcon from '@lucide/svelte/icons/case-sensitive';
  import { createBodyCache, searchVersions, splitMarks, type Progress, type VersionHit } from '../history/search';
  import { relTime } from '../utils';
  import { modal } from '../modal';
  import ModalClose from './ModalClose.svelte';

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

  // 이력 검색: 입력(query) → 200ms 뒤 activeQuery → 버전을 나눠 훑는다. 풀어 둔 본문은 패널이 열려 있는 동안만 캐시한다
  let query = $state('');
  let activeQuery = $state('');
  let caseSensitive = $state(false);
  let progress = $state<Progress | undefined>();
  let searching = $state(false);
  let inCurrent = $state<boolean | undefined>();
  let skipped = $state(0);
  const cache = createBodyCache<Version>((v) => v.content);
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let previewEl = $state<HTMLElement | undefined>();

  const searchOn = $derived(activeQuery !== '');
  const hitMap = $derived(new Map<string, VersionHit>((progress?.hits ?? []).map((h) => [h.versionId, h])));
  const shown = $derived(searchOn ? versions.filter((v) => hitMap.has(v.id)) : versions);
  const selected = $derived(shown.find((v) => v.id === selectedId));
  const hunks = $derived(selected && current !== undefined && view === 'diff' ? diffText(selected.content, current) : []);
  const hasQ = (t: string) => searchOn && splitMarks(t, activeQuery, { caseSensitive }).some((p) => p.hit);
  const hunkHit = (h: (typeof hunks)[number]) => h.ver.some(hasQ);

  function onQueryInput() {
    clearTimeout(debounce);
    if (!query) { activeQuery = ''; return; }
    debounce = setTimeout(() => { activeQuery = query; }, 200);
  }
  function clearQuery() { clearTimeout(debounce); query = ''; activeQuery = ''; }

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
    void docKey; // 글을 바꾸면 캐시·검색어를 버린다
    cache.clear();
    clearQuery();
    if (open) { view = 'preview'; naming = false; void load(); }
  });
  // 닫으면 풀어 둔 본문을 놓는다
  $effect(() => { if (!open) { cache.clear(); clearQuery(); } });

  // 검색어·옵션·목록이 바뀌면 진행 중인 검색을 취소하고 새로 시작한다
  $effect(() => {
    const q = activeQuery, cs = caseSensitive, list = versions, cur = current;
    progress = undefined; inCurrent = undefined; skipped = 0;
    if (!open || !q || !list.length) { searching = false; return; }
    const ac = new AbortController();
    searching = true;
    progress = { done: 0, total: list.length, hits: [] };
    void searchVersions(list, cache, q, { caseSensitive: cs, current: cur, signal: ac.signal, onProgress: (p) => { progress = p; } }).then((r) => {
      if (!r || ac.signal.aborted) return;
      inCurrent = r.inCurrent; skipped = r.skipped; searching = false;
    });
    return () => ac.abort();
  });
  // 선택한 버전이 결과에서 빠지면 가장 최근 일치 버전으로 옮긴다(안 보이는 버전을 복원하지 않게)
  $effect(() => {
    if (searchOn && shown.length && !shown.some((v) => v.id === selectedId)) selectedId = shown[0].id;
  });
  // diff 화면에서는 검색어가 든 첫 hunk 로 스크롤한다
  $effect(() => {
    if (!searchOn || view !== 'diff' || !previewEl || !hunks.length) return;
    previewEl.querySelector('.hunk.hit')?.scrollIntoView({ block: 'center' });
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

  // 발췌의 일치 구간(ranges)을 조각으로 나눈다. {@html} 없이 <mark> 로 그린다
  const marks = (text: string, ranges: [number, number][]) => {
    const out: { t: string; hit: boolean }[] = [];
    let pos = 0;
    for (const [a, b] of ranges) {
      if (a > pos) out.push({ t: text.slice(pos, a), hit: false });
      out.push({ t: text.slice(a, b), hit: true });
      pos = b;
    }
    if (pos < text.length || !out.length) out.push({ t: text.slice(pos), hit: false });
    return out;
  };

  const noop = () => {};
  const noUpload = async () => { throw new Error('이력 미리보기에서는 이미지를 추가할 수 없습니다'); };
</script>

{#snippet hl(text: string)}{#if searchOn}{#each splitMarks(text, activeQuery, { caseSensitive }) as p, i (i)}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}{:else}{text}{/if}{/snippet}

{#if open}
  <div class="overlay" transition:backdropFx use:modal={{ onClose: () => (open = false) }}>
    <div class="dialog history" role="dialog" transition:modalFx aria-modal="true" aria-label="버전 이력">
      <div class="dlg-head"><h2>버전 이력 <span class="sub">24시간 이내 전부 · 이후 시간당/일당 1개로 정리 · 이름 붙인 버전은 보존 · 노트 폴더(.works)와 함께 보관됩니다</span></h2><ModalClose onclick={() => (open = false)} /></div>
      {#if loading}
        <p class="muted">불러오는 중…</p>
      {:else if !versions.length}
        <p class="muted">아직 이력이 없습니다. 문서를 열고 편집하면 5분 간격으로 쌓입니다.</p>
      {:else}
        <div class="history-body">
          <div class="history-side">
            <div class="hsearch">
              <SearchIcon size={14} />
              <input type="text" bind:value={query} oninput={onQueryInput} placeholder="이력에서 문구 찾기" aria-label="이력에서 문구 찾기" spellcheck="false" autocomplete="off"
                onkeydown={(e) => { if (e.key === 'Escape' && query && !e.isComposing) { e.preventDefault(); e.stopPropagation(); clearQuery(); } }} />
              <button class="icon" class:active={caseSensitive} aria-pressed={caseSensitive} aria-label="대소문자 구분" use:tip={'대소문자 구분'} onclick={() => (caseSensitive = !caseSensitive)}><CaseIcon size={14} /></button>
              {#if query}<button class="icon" aria-label="검색어 지우기" use:tip={'지우기'} onclick={clearQuery}><XIcon size={14} /></button>{/if}
            </div>
            <p class="hstatus muted" role="status">
              {#if searching && progress}찾는 중… ({progress.done}/{progress.total})
              {:else if searchOn}{shown.length ? `버전 ${shown.length}개에서 찾음` : '일치하는 버전이 없습니다'}{#if skipped} · 읽지 못한 버전 {skipped}개 제외{/if}{/if}
            </p>
            {#if searchOn && !searching && shown.length && inCurrent === false}
              <p class="hgone">지금 글에는 없는 문구입니다</p>
            {/if}
            <ul class="history-list">
              {#each shown as v (v.id)}
                {@const hit = searchOn ? hitMap.get(v.id) : undefined}
                <li>
                  <button class:active={v.id === selectedId} onclick={() => (selectedId = v.id)} use:tip={new Date(v.ts).toLocaleString('ko-KR')}>
                    <span class="vtitle">
                      {#if v.name}<span class="pin" use:tip={'이름을 붙인 버전'}><PinIcon size={12} /> {v.name}</span>{/if}
                      <span>{relTime(v.ts)}</span>
                      {#if hit}
                        {#each hit.excerpts as ex (ex.line)}
                          <span class="excerpt">{#each marks(ex.text, ex.ranges) as p, i (i)}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}</span>
                        {/each}
                      {/if}
                    </span>
                    <span class="muted vmeta">{#if hit}<b class="cnt">{hit.count}건</b>{/if}{v.content.length.toLocaleString('ko-KR')}자</span>
                  </button>
                </li>
              {/each}
            </ul>
          </div>
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
            <div class="history-preview" bind:this={previewEl}>
              {#if view === 'diff'}
                {#if !hunks.length}
                  <p class="muted pad">현재 본문과 차이가 없습니다.</p>
                {:else}
                  <p class="muted pad">선택한 버전 → 현재 본문의 문단 단위 차이입니다. 체크한 변경만 이 버전 쪽으로 되돌립니다.</p>
                  {#each hunks as h (h.id)}
                    <div class="hunk {h.kind}" class:hit={hunkHit(h)}>
                      <label class="hunk-head">
                        <input type="checkbox" checked={checked.includes(h.id)} onchange={() => toggle(h.id)} />
                        <span>{kindLabel[h.kind]}</span>
                      </label>
                      {#if h.kind === 'changed'}
                        {#each h.pairs as p, i (i)}
                          <pre class="block">{#each displaySegs(p) as s, j (j)}{#if s.type === 'eq'}{@render hl(s.text)}{:else if s.type === 'del'}<del class:dim={isEmptyBlock(p.ver)}>{@render hl(s.text)}</del>{:else}<ins class:dim={isEmptyBlock(p.cur)}>{s.text}</ins>{/if}{/each}</pre>
                        {/each}
                        {#each h.ver.slice(h.pairs.length) as t, i (i)}<pre class="block"><del class:dim={isEmptyBlock(t)}>{@render hl(displayBlock(t))}</del></pre>{/each}
                        {#each h.cur.slice(h.pairs.length) as t, i (i)}<pre class="block"><ins class:dim={isEmptyBlock(t)}>{displayBlock(t)}</ins></pre>{/each}
                      {:else if h.kind === 'removed'}
                        {#each h.ver as t, i (i)}<pre class="block"><del class:dim={isEmptyBlock(t)}>{@render hl(displayBlock(t))}</del></pre>{/each}
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
  .history-side { flex: none; width: 240px; display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  .history-side .history-list { width: auto; flex: 1; }
  .hsearch { display: flex; align-items: center; gap: 4px; padding: 0 4px 0 8px; border: 1px solid var(--border); border-radius: 8px; color: var(--muted); }
  .hsearch input { flex: 1; min-width: 0; border: 0; box-shadow: none; background: transparent; padding: 6px 2px; }
  .hsearch .icon { display: inline-flex; border: 0; padding: 4px; background: transparent; border-radius: 6px; color: inherit; }
  .hsearch .icon:hover { background: var(--hover); }
  .hsearch .icon.active { background: var(--selected); color: var(--accent); }
  .hstatus { margin: 0; font-size: 12px; min-height: 1em; }
  .hgone { margin: 0; font-size: 12px; font-weight: 600; color: var(--danger); }
  .excerpt { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px; }
  .vmeta { display: flex; flex-direction: column; align-items: flex-end; flex: none; }
  .cnt { color: var(--accent); font-weight: 600; }
  .hunk.hit { border-color: var(--accent); }
  .hunk :global(mark), .history-list :global(mark) { background: var(--mark-bg); color: inherit; border-radius: 2px; }
  @media (max-width: 720px) { .history-side { width: auto; } }
  .history-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .history-main .history-preview { flex: 1; min-height: 0; }
  .history-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .history-tools .grow { flex: 1; }
  .history-tools button.active { background: var(--selected); }
  .name-input { width: 160px; }
  .vtitle { display: flex; flex-direction: column; min-width: 0; }
  .pin { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pin :global(svg) { vertical-align: -1px; color: var(--accent); }
  .pad { padding: 8px 16px 0; margin: 0; }
  .hunk { margin: 10px 16px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .hunk-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-size: 12px; background: var(--hover); cursor: pointer; }
  .hunk-head input[type="checkbox"] { width: auto; margin: 0; padding: 0; flex: none; }
  .hunk-head span { white-space: nowrap; }
  .block { margin: 0; padding: 8px 12px; white-space: pre-wrap; word-break: break-word; font: inherit; font-size: 13px; border-top: 1px solid var(--border); }
  del { background: color-mix(in srgb, var(--fx-danger) 18%, transparent); text-decoration: line-through; }
  ins { background: color-mix(in srgb, var(--fx-success) 22%, transparent); text-decoration: none; }
  .dim { opacity: 0.55; font-style: italic; }
</style>
