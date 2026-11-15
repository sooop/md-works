<script lang="ts">
  // 링크 패널: `[[글 이름]]` 으로 이어진 글. 위는 이 글을 가리키는 글(역링크, 링크가 있는 줄의 문맥), 아래는 이 글에서 가리키는 글.
  // 패널이 열려 있을 때만 계산한다. 스탠드얼론은 메모리의 모든 글을 훑고(글별 추출 결과는 내용 기준 캐시),
  // 서버 모드는 전체 검색 API 로 `[[` 가 든 줄을 찾아 클라이언트에서 해석한다.
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import { doc, errMsg } from '../store.svelte';
  import { closeRight } from '../rightbar/state.svelte';
  import { viewport } from '../sidebar/state.svelte';
  import { tip } from '../tooltip.svelte';
  import { wiki } from '../wikilink/env.svelte';
  import { LinkCache, backlinksFromSources, backlinksFromLines, outgoingLinks, type BacklinkGroup } from '../wikilink/links';
  import { openWikiLink, createWikiDoc } from '../wikilink/actions';
  import { docName } from '../wikilink/parse';

  let { active = true }: { active?: boolean } = $props();

  const host = $derived(wiki.host);
  const curPath = $derived(host?.current()?.path ?? '');
  const docs = $derived(host?.docs() ?? []);
  const outgoing = $derived(active && curPath && host ? outgoingLinks(doc.content, docs) : []);

  let groups = $state<BacklinkGroup[]>([]);
  let partial = $state(false);
  let loading = $state(false);
  let error = $state('');
  let tick = $state(0); // '다시 읽기' 단추
  const cache = new LinkCache();
  const SHOWN = 3; // 글마다 보여 주는 문맥 줄 수

  $effect(() => {
    const h = host, path = curPath, dl = docs;
    void tick;
    partial = false;
    error = '';
    if (!active || !h || !path) { groups = []; loading = false; return; }
    if (h.sources) { groups = backlinksFromSources(path, h.sources(), dl, cache); loading = false; return; }
    if (!h.searchLines) { groups = []; return; }
    // 서버: 글 전환·목록 갱신이 이어질 때 요청을 몰지 않게 잠깐 미루고, 지난 요청은 취소한다
    const ctl = new AbortController();
    loading = true;
    const t = setTimeout(async () => {
      try {
        const r = await h.searchLines!(docName(path), ctl.signal);
        if (ctl.signal.aborted) return;
        groups = backlinksFromLines(path, dl, r.hits);
        partial = r.truncated;
      } catch (e) {
        if (!ctl.signal.aborted) { groups = []; error = `역링크를 찾지 못했습니다: ${errMsg(e)}`; }
      } finally {
        if (!ctl.signal.aborted) loading = false;
      }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  });

  const total = $derived(groups.reduce((n, g) => n + g.items.length, 0));
  const leave = () => { if (viewport.mobile) closeRight(); }; // 모바일 시트는 이동하면 닫아 본문을 보여 준다
  const openKey = (key: string) => { void host?.open(key); leave(); };
</script>

<div class="lk-panel">
  {#if !curPath}
    <p class="empty">문서를 열면 이 글과 이어진 글이 보입니다.</p>
  {:else}
    <div class="lk-head">
      <span>본문에 <code>[[글 이름]]</code> 을 쓰면 글끼리 이어집니다</span>
      <button class="icon-btn lk-refresh" aria-label="다시 읽기" use:tip={'역링크 다시 찾기'} onclick={() => tick++}><RefreshCw size={14} /></button>
    </div>
    <div class="lk-scroll">
      <h3 class="lk-sec">이 글을 가리키는 글 {#if total}<span>{total}</span>{/if}</h3>
      {#if loading && !groups.length}
        <p class="empty">찾는 중…</p>
      {:else if error}
        <p class="empty err">{error}</p>
      {:else if !groups.length}
        <p class="empty">이 글을 가리키는 글이 없습니다.</p>
      {:else}
        <ul class="lk-list">
          {#each groups as g (g.key)}
            <li class="lk-group">
              <button class="lk-title" onclick={() => openKey(g.key)}>{g.path}</button>
              {#each g.items.slice(0, SHOWN) as it, i (i)}
                <button class="lk-ctx" onclick={() => openKey(g.key)} use:tip={`${it.line}번째 줄`}>
                  <span>{it.snip.before}</span><mark>{it.snip.hit}</mark><span>{it.snip.after}</span>
                </button>
              {/each}
              {#if g.items.length > SHOWN}<span class="lk-more">외 {g.items.length - SHOWN}곳</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if partial}<p class="empty">결과가 많아 일부만 표시합니다</p>{/if}

      <h3 class="lk-sec">이 글에서 가리키는 글 {#if outgoing.length}<span>{outgoing.length}</span>{/if}</h3>
      {#if !outgoing.length}
        <p class="empty">이 글에는 링크가 없습니다.</p>
      {:else}
        <ul class="lk-list">
          {#each outgoing as o (o.target)}
            <li class="lk-out">
              <button class="lk-title" class:missing={o.res.kind === 'missing'} onclick={() => { void openWikiLink(host!, o.target, o.res); leave(); }}>{o.target}</button>
              {#if o.count > 1}<span class="lk-tag">{o.count}회</span>{/if}
              {#if o.res.kind === 'missing'}
                <span class="lk-tag warn">없음</span>
                <button class="lk-make" onclick={() => { void createWikiDoc(host!, o.target); leave(); }}>만들기</button>
              {:else if o.res.kind === 'ambiguous'}
                <span class="lk-tag warn" use:tip={o.res.paths.join('\n')}>모호</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .lk-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .lk-panel .empty { color: var(--muted); padding: 8px 12px; font-size: 13px; margin: 0; }
  .lk-panel .empty.err { color: var(--danger); }
  .lk-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 12px; font-size: 12px; color: var(--muted); }
  .lk-head code { font-size: 11px; }
  .lk-refresh { flex: none; }
  .lk-scroll { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 12px; }
  .lk-sec { margin: 10px 12px 2px; font-size: 12px; font-weight: 600; color: var(--muted); }
  .lk-sec span { font-weight: 400; margin-left: 4px; }
  .lk-list { list-style: none; margin: 0; padding: 0 6px; display: flex; flex-direction: column; gap: 2px; }
  .lk-group { display: flex; flex-direction: column; padding: 4px 0; border-bottom: 1px solid var(--border); }
  .lk-group:last-child { border-bottom: 0; }
  .lk-title { justify-content: flex-start; text-align: left; border: 0; background: transparent; border-radius: 6px; padding: 4px 6px; font-size: 13px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
  .lk-title:hover:not(:disabled) { background: var(--hover); }
  .lk-title.missing { color: var(--muted); font-weight: 400; text-decoration: underline dotted; text-underline-offset: 3px; }
  .lk-ctx { display: block; text-align: left; border: 0; background: transparent; border-radius: 6px; padding: 3px 6px 3px 14px; font-size: 12px; line-height: 1.45; color: var(--muted); overflow-wrap: anywhere; }
  .lk-ctx:hover:not(:disabled) { background: var(--hover); color: var(--text); }
  .lk-ctx mark { background: var(--accent-soft); color: var(--text); border-radius: 3px; padding: 0 1px; }
  .lk-more { padding: 0 6px 0 14px; font-size: 11px; color: var(--muted); }
  .lk-out { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 2px 0; }
  .lk-tag { font-size: 11px; color: var(--muted); border: 1px solid var(--border-strong); border-radius: 999px; padding: 0 6px; }
  .lk-tag.warn { color: var(--fx-warn); border-color: currentColor; }
  .lk-make { font-size: 12px; padding: 2px 8px; border-radius: 6px; }
</style>
