<script lang="ts">
  // 목차: 본문(ProseMirror)의 제목(h1~h6)을 읽어 보여 주고, 누르면 그 제목으로 스크롤한다.
  // 에디터는 문서마다 새로 만들어지므로 항상 있는 .editor-wrap 을 관찰해 본문이 바뀔 때 다시 읽는다.
  import { doc } from '../store.svelte';
  import { closeRight } from '../rightbar/state.svelte';
  import { viewport } from '../sidebar/state.svelte';

  let { active = true }: { active?: boolean } = $props();

  interface Item { text: string; level: number }
  let items = $state<Item[]>([]);
  let current = $state(-1);

  const HEADINGS = '.editor-wrap .ProseMirror :is(h1, h2, h3, h4, h5, h6)';
  const headingEls = () => [...document.querySelectorAll<HTMLElement>(HEADINGS)];

  function scan() {
    const next = headingEls().map((el) => ({ text: (el.textContent ?? '').trim(), level: Number(el.tagName[1]) }));
    if (next.length !== items.length || next.some((n, i) => n.text !== items[i].text || n.level !== items[i].level)) items = next;
    markCurrent();
  }

  // 읽고 있는 위치: 화면 위쪽에 걸린 마지막 제목
  function markCurrent() {
    const wrap = document.querySelector<HTMLElement>('.editor-wrap');
    if (!wrap) { current = -1; return; }
    const top = wrap.getBoundingClientRect().top + 48;
    let idx = -1;
    headingEls().forEach((el, i) => { if (el.getBoundingClientRect().top <= top) idx = i; });
    if (idx !== current) current = idx;
  }

  $effect(() => {
    if (!active || !doc.path) { items = []; return; }
    const wrap = document.querySelector<HTMLElement>('.editor-wrap');
    if (!wrap) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const later = () => { clearTimeout(t); t = setTimeout(scan, 200); };
    scan();
    const mo = new MutationObserver(later);
    mo.observe(wrap, { childList: true, subtree: true, characterData: true });
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(markCurrent); };
    wrap.addEventListener('scroll', onScroll, { passive: true });
    return () => { mo.disconnect(); clearTimeout(t); cancelAnimationFrame(raf); wrap.removeEventListener('scroll', onScroll); };
  });

  function go(i: number) {
    const el = headingEls()[i];
    if (!el) return;
    if (viewport.mobile) closeRight(); // 모바일 시트는 이동하면 닫아 본문을 보여 준다
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }

  const minLevel = $derived(items.length ? Math.min(...items.map((i) => i.level)) : 1);
</script>

<div class="ol-panel">
  {#if !doc.path}
    <p class="empty">문서를 열면 목차가 보입니다.</p>
  {:else if !items.length}
    <p class="empty">제목(# ~ ######)이 없습니다.</p>
  {:else}
    <nav class="ol-list" aria-label="목차">
      {#each items as it, i (i)}
        <button class="ol-item" class:cur={i === current} style:padding-left="{10 + (it.level - minLevel) * 14}px" aria-current={i === current ? 'location' : undefined} onclick={() => go(i)}>
          {it.text || '(제목 없음)'}
        </button>
      {/each}
    </nav>
  {/if}
</div>
