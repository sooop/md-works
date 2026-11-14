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

  // 제목 위치(스크롤 내용 기준 y). 스캔·리사이즈 때 한 번만 재고, 스크롤 중에는 이 캐시를 이진 탐색한다(제목마다 getBoundingClientRect 를 부르지 않는다)
  let tops: number[] = [];
  function measure(wrap: HTMLElement, els: HTMLElement[]) {
    const base = wrap.getBoundingClientRect().top - wrap.scrollTop;
    tops = els.map((el) => el.getBoundingClientRect().top - base);
  }

  function scan(wrap: HTMLElement) {
    const els = headingEls();
    const next = els.map((el) => ({ text: (el.textContent ?? '').trim(), level: Number(el.tagName[1]) }));
    if (next.length !== items.length || next.some((n, i) => n.text !== items[i].text || n.level !== items[i].level)) items = next;
    measure(wrap, els);
    markCurrent(wrap);
  }

  // 읽고 있는 위치: 화면 위쪽(48px)에 걸린 마지막 제목. tops 는 위에서 아래로 정렬돼 있어 이진 탐색
  function markCurrent(wrap: HTMLElement) {
    const line = wrap.scrollTop + 48;
    let lo = 0, hi = tops.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tops[mid] <= line) lo = mid + 1; else hi = mid; }
    const idx = lo - 1;
    if (idx !== current) current = idx;
  }

  $effect(() => {
    if (!active || !doc.path) { items = []; tops = []; return; }
    let t: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cleanup: (() => void) | undefined;
    const attach = (wrap: HTMLElement) => {
      const later = () => { clearTimeout(t); t = setTimeout(() => scan(wrap), 200); };
      scan(wrap);
      const mo = new MutationObserver(later);
      mo.observe(wrap, { childList: true, subtree: true, characterData: true });
      const ro = new ResizeObserver(later); // 폭이 바뀌면 줄바꿈이 달라져 제목 위치도 달라진다
      ro.observe(wrap);
      let raf = 0;
      const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => markCurrent(wrap)); };
      wrap.addEventListener('scroll', onScroll, { passive: true });
      cleanup = () => { mo.disconnect(); ro.disconnect(); cancelAnimationFrame(raf); wrap.removeEventListener('scroll', onScroll); };
    };
    // .editor-wrap 이 아직 없으면(에디터가 늦게 붙는 경우) 짧게 다시 찾는다
    let tries = 0;
    const find = () => {
      const wrap = document.querySelector<HTMLElement>('.editor-wrap');
      if (wrap) { attach(wrap); return; }
      if (++tries < 30) retry = setTimeout(find, 100);
    };
    find();
    return () => { clearTimeout(t); clearTimeout(retry); cleanup?.(); };
  });

  // 목차 이동: 긴 거리를 smooth 로 스크롤하는 동안 레이아웃이 바뀌면(모바일 주소창 접힘, 시트 닫힘, 지연 렌더링) 목표가 어긋난다.
  // 즉시 이동한 뒤, 3초 동안 매 프레임 실제 위치를 다시 재서 교정한다(글꼴 로딩·코드 블록 전환 등 늦게 생기는 높이 변화 대응).
  // 사용자가 터치·휠·스크롤바·키보드로 직접 조작하면 중단한다
  let cancelFix: (() => void) | undefined;
  function go(i: number) {
    const el = headingEls()[i];
    if (!el) return;
    const wrap = document.querySelector<HTMLElement>('.editor-wrap');
    if (!wrap) return;
    cancelFix?.();
    if (viewport.mobile) closeRight(); // 모바일 시트는 이동하면 닫아 본문을 보여 준다
    const offset = () => el.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
    wrap.scrollTop += offset();
    let raf = 0;
    const until = performance.now() + 3000;
    const evs = ['touchstart', 'wheel', 'pointerdown', 'keydown'] as const;
    const stop = () => { cancelAnimationFrame(raf); evs.forEach((e) => window.removeEventListener(e, stop)); if (cancelFix === stop) cancelFix = undefined; };
    cancelFix = stop;
    evs.forEach((e) => window.addEventListener(e, stop, { passive: true }));
    const tick = () => {
      if (!el.isConnected) return stop();
      const d = offset();
      if (Math.abs(d) > 1) wrap.scrollTop += d;
      if (performance.now() > until) return stop();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
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
