<script lang="ts">
  // 서체 선택기: 현재 서체를 그 글꼴로 보여 주는 단추 → 검색 가능한 목록(글꼴 이름이 그 글꼴로 그려지고, 설치 여부 표시).
  // '내 컴퓨터 글꼴 불러오기'는 브라우저가 지원하고 사용자가 허용할 때만 쓴다. 쉼표로 여러 글꼴(대체 순서)을 직접 적을 수도 있다.
  import { tick } from 'svelte';
  import Pop from './Pop.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Search from '@lucide/svelte/icons/search';
  import Check from '@lucide/svelte/icons/check';
  import { candidatesFor, isFontInstalled, firstFont, type FontKind } from '../design/fonts';
  import { buildFontFamily, FALLBACK_CODE } from '../design/fontStack';

  interface Props { value: string; kind: FontKind; placeholder: string; label: string; onchange: (v: string) => void }
  let { value, kind, placeholder, label, onchange }: Props = $props();

  let open = $state(false);
  let q = $state('');
  let local = $state<string[]>([]);
  let canLocal = $state(typeof window !== 'undefined' && typeof (window as any).queryLocalFonts === 'function');
  let loading = $state(false);
  let qEl = $state<HTMLInputElement>();
  let raw = $state('');

  $effect(() => {
    if (!open) return;
    q = '';
    raw = value;
    void tick().then(() => qEl?.focus());
  });

  const family = (name: string) => buildFontFamily(name, kind === 'code' ? FALLBACK_CODE : undefined) || undefined;
  const recommended = $derived(candidatesFor(kind).map((n) => ({ name: n, installed: isFontInstalled(n) })));
  const needle = $derived(q.trim().toLowerCase());
  const shownRec = $derived(recommended.filter((f) => !needle || f.name.toLowerCase().includes(needle)));
  const shownLocal = $derived(local.filter((n) => !needle || n.toLowerCase().includes(needle)).slice(0, 200));
  const exact = $derived(needle && ![...recommended.map((r) => r.name), ...local].some((n) => n.toLowerCase() === needle));
  const current = $derived(firstFont(value));

  async function loadLocal() {
    loading = true;
    try {
      const list: { family: string }[] = await (window as any).queryLocalFonts();
      local = [...new Set(list.map((f) => f.family))].sort((a, b) => a.localeCompare(b)).slice(0, 1500);
      if (!local.length) canLocal = false;
    } catch {
      canLocal = false; // 권한 거부·미지원: 조용히 숨긴다
    } finally {
      loading = false;
    }
  }
  function pick(name: string, close: () => void) {
    onchange(name);
    close();
  }
</script>

<Pop bind:open label={`${label} 선택`} width={340}>
  {#snippet trigger({ toggle, open: o })}
    <button class="fp-btn" class:on={o} aria-haspopup="dialog" aria-expanded={o} aria-label={`${label}: ${current || placeholder}`} onclick={toggle}>
      <span class="fp-cur" style:font-family={current ? family(value) : undefined} class:ph={!current}>{current || placeholder.replace(/^비우면 /, '')}</span>
      <ChevronDown size={14} />
    </button>
  {/snippet}
  {#snippet children({ close })}
    <div class="fp">
      <div class="fp-search"><Search size={14} /><input bind:this={qEl} bind:value={q} placeholder="글꼴 이름 검색 또는 입력" aria-label="글꼴 검색" spellcheck="false"
        onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing && q.trim()) pick(q.trim(), close); }} /></div>
      <div class="fp-list" role="listbox" aria-label="글꼴 목록">
        {#if !needle}
          <button role="option" aria-selected={!value} class="fp-it" onclick={() => pick('', close)}><span class="fp-name">기본 ({placeholder.replace(/^비우면 기본\(|\)$/g, '')})</span>{#if !value}<Check size={14} />{/if}</button>
        {/if}
        {#if exact}
          <button role="option" aria-selected="false" class="fp-it use" onclick={() => pick(q.trim(), close)}><span class="fp-name">'{q.trim()}' 사용</span><small>Enter</small></button>
        {/if}
        {#each shownRec as f (f.name)}
          <button role="option" aria-selected={current === f.name} class="fp-it" class:off={!f.installed} onclick={() => pick(f.name, close)}>
            <span class="fp-name" style:font-family={family(f.name)}>{f.name}</span>
            <small>{f.installed ? '설치됨' : '없음'}</small>
            {#if current === f.name}<Check size={14} />{/if}
          </button>
        {/each}
        {#if canLocal && !local.length}
          <button class="fp-load" onclick={loadLocal} disabled={loading}>{loading ? '불러오는 중…' : '내 컴퓨터 글꼴 모두 불러오기'}</button>
        {/if}
        {#if shownLocal.length}
          <div class="fp-h">내 컴퓨터 글꼴 {shownLocal.length}{local.length > shownLocal.length ? '+' : ''}</div>
          {#each shownLocal as n (n)}
            <button role="option" aria-selected={current === n} class="fp-it" onclick={() => pick(n, close)}>
              <span class="fp-name" style:font-family={family(n)}>{n}</span>{#if current === n}<Check size={14} />{/if}
            </button>
          {/each}
        {/if}
        {#if needle && !shownRec.length && !shownLocal.length && !exact}<p class="fp-none">맞는 글꼴이 없습니다.</p>{/if}
      </div>
      <label class="fp-raw">
        <span>직접 입력(쉼표로 여러 개, 앞 글꼴이 없으면 다음 것)</span>
        <input type="text" bind:value={raw} maxlength="200" spellcheck="false" aria-label="서체 직접 입력" onchange={() => onchange(raw)} />
      </label>
      <div class="fp-sample" style:font-family={family(value)}>가나다라 마바사 Aa 123 — The quick brown fox</div>
    </div>
  {/snippet}
</Pop>

<style>
  .fp-btn { display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-width: 180px; padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--surface); text-align: left; }
  .fp-btn.on { border-color: var(--accent); }
  .fp-cur { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fp-cur.ph { color: var(--muted); }
  .fp { display: flex; flex-direction: column; gap: 8px; padding: 4px; }
  .fp-search { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); color: var(--muted); }
  .fp-search input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; color: var(--text); font: inherit; font-size: 13px; }
  .fp-list { max-height: 260px; overflow: auto; display: flex; flex-direction: column; gap: 1px; }
  .fp-it { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: 0; background: transparent; padding: 6px 8px; border-radius: 6px; }
  .fp-it:hover { background: var(--hover); }
  .fp-it .fp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
  .fp-it small { color: var(--muted); font-size: 11px; }
  .fp-it.off .fp-name { opacity: 0.5; }
  .fp-it.use { color: var(--primary); }
  .fp-h { font-size: 11.5px; color: var(--muted); padding: 8px 8px 2px; }
  .fp-none { margin: 8px; color: var(--muted); font-size: 13px; }
  .fp-load { margin: 4px 0; padding: 6px; border-radius: 6px; border: 1px dashed var(--border-strong); background: transparent; color: var(--muted); }
  .fp-raw { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--muted); }
  .fp-raw input { padding: 4px 8px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--surface); color: var(--text); font: inherit; font-size: 13px; }
  .fp-sample { padding: 8px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
