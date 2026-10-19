<script lang="ts">
  import { tick } from 'svelte';
  import FileText from '@lucide/svelte/icons/file-text';
  import { searchOpts, persistSearchOpts, ui, prepareJump } from '../search/state.svelte';
  import type { SearchResponse } from '../search/types';
  import { errMsg } from '../store.svelte';

  interface Props {
    run: (query: string, opts: { caseSensitive: boolean; regex: boolean }, signal: AbortSignal) => Promise<SearchResponse>;
    onOpen: (id: string) => void | Promise<void>;
    activeId: string;
  }
  let { run, onOpen, activeId }: Props = $props();

  let input: HTMLInputElement;
  let query = $state('');
  let res = $state<SearchResponse | null>(null);
  let error = $state('');
  let busy = $state(false);

  // 입력이 멈추면(250ms) 검색한다. 이전 요청은 취소한다.
  $effect(() => {
    const q = query;
    const opts = { caseSensitive: searchOpts.caseSensitive, regex: searchOpts.regex };
    if (!q.trim()) { res = null; error = ''; busy = false; return; }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      busy = true;
      try {
        const r = await run(q, opts, ac.signal);
        if (ac.signal.aborted) return;
        res = r;
        error = '';
      } catch (e) {
        if (ac.signal.aborted) return;
        res = null;
        error = errMsg(e);
      } finally {
        if (!ac.signal.aborted) busy = false;
      }
    }, 250);
    return () => { clearTimeout(t); ac.abort(); };
  });

  $effect(() => {
    ui.globalFocus;
    void tick().then(() => { input?.focus(); input?.select(); });
  });

  async function open(id: string, nth: number) {
    prepareJump(query, id, nth);
    await onOpen(id);
  }

  // 일치 구간을 <mark> 로 나눠 그린다
  function parts(text: string, ranges: [number, number][]) {
    const out: { t: string; hit: boolean }[] = [];
    let pos = 0;
    for (const [s, e] of ranges) {
      if (s > pos) out.push({ t: text.slice(pos, s), hit: false });
      out.push({ t: text.slice(s, e), hit: true });
      pos = e;
    }
    if (pos < text.length) out.push({ t: text.slice(pos), hit: false });
    return out;
  }
</script>

<div class="searchpanel">
  <div class="searchbox">
    <input
      bind:this={input}
      bind:value={query}
      placeholder="모든 문서에서 검색"
      aria-label="모든 문서에서 검색"
      spellcheck="false"
      class:invalid={!!error}
    />
    <button
      class="toggle" class:on={searchOpts.caseSensitive} title="대소문자 구분" aria-label="대소문자 구분" aria-pressed={searchOpts.caseSensitive}
      onclick={() => { searchOpts.caseSensitive = !searchOpts.caseSensitive; persistSearchOpts(); }}
    >Aa</button>
    <button
      class="toggle" class:on={searchOpts.regex} title="정규식" aria-label="정규식" aria-pressed={searchOpts.regex}
      onclick={() => { searchOpts.regex = !searchOpts.regex; persistSearchOpts(); }}
    >.*</button>
  </div>

  <div class="results">
    {#if error}
      <p class="empty err">{error}</p>
    {:else if !res}
      <p class="empty">{busy ? '검색 중…' : '검색어를 입력하세요. 이미지 데이터는 검색하지 않습니다.'}</p>
    {:else if !res.results.length}
      <p class="empty">{busy ? '검색 중…' : '결과가 없습니다.'}</p>
    {:else}
      <p class="summary">
        {res.results.length}개 문서에서 {res.count}건{res.truncated ? ' 이상 (일부만 표시)' : ''}
      </p>
      <ul>
        {#each res.results as f (f.id)}
          <li>
            <div class="file" class:active={f.id === activeId}>
              <FileText size={14} class="ico" /><span class="label" title={f.label}>{f.label}</span>
              <span class="n">{f.matches.length}{f.more ? '+' : ''}</span>
            </div>
            <ul class="hits">
              {#each f.matches as m (m.line)}
                <li>
                  <button onclick={() => open(f.id, m.nth)} title={`${m.line}번째 줄`}>
                    <span class="ln">{m.line}</span>
                    <span class="snip">{#each parts(m.text, m.ranges) as p}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}</span>
                  </button>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
