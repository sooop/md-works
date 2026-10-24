<script lang="ts">
  // 글 목록: 파일명 찾기 + 정렬 기준 선택 + 폴더 트리. 서버 모드와 단일 모드가 같이 쓰고, 모드별 동작은 ctl 로 받는다.
  import { setContext, tick, untrack } from 'svelte';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import ArrowDownAZ from '@lucide/svelte/icons/arrow-down-a-z';
  import Clock from '@lucide/svelte/icons/clock';
  import Hand from '@lucide/svelte/icons/hand';
  import Check from '@lucide/svelte/icons/check';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import TreeNodeView from './TreeNode.svelte';
  import Pop from './Pop.svelte';
  import { tip } from '../tooltip.svelte';
  import { matchName } from '../search/nameMatch';
  import { stripExt } from '../utils';
  import { sortTree, ordersOf, splitPath, type DocNode, type SortMode } from '../docTree';
  import { treeUi, setSort, setOrders, SORT_LABEL, treeNav, onActiveChange } from '../docTree.svelte';
  import { TREE_CTL, dndUi, type DragState, type DropPos, type TreeCtl } from './treeCtl';

  interface Props {
    nodes: DocNode[];
    ctl: TreeCtl;
    filter: string;
    emptyText: string;
  }
  let { nodes, ctl, filter = $bindable(''), emptyText }: Props = $props();
  // svelte-ignore state_referenced_locally
  setContext(TREE_CTL, ctl); // ctl 은 셸이 한 번 만들어 넘기는 고정 객체다

  const drag = $state<DragState>({ node: null, hint: '' });
  let navEl = $state<HTMLElement>();
  let indEl = $state<HTMLDivElement>();
  // 놓을 위치 표시(선 또는 상자) 하나를 직접 옮긴다. 반응형 상태를 거치지 않아 마우스를 바로 따라온다
  dndUi.indicate = (row: HTMLElement | null, pos: DropPos) => {
    if (!indEl || !navEl) return;
    if (!row || !pos) { indEl.style.display = 'none'; return; }
    const n = navEl.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const top = r.top - n.top + navEl.scrollTop;
    indEl.style.display = 'block';
    indEl.style.left = `${r.left - n.left + navEl.scrollLeft}px`;
    indEl.style.width = `${r.width}px`;
    if (pos === 'into') {
      indEl.className = 'drop-ind box';
      indEl.style.top = `${top}px`;
      indEl.style.height = `${r.height}px`;
    } else {
      indEl.className = 'drop-ind line';
      indEl.style.top = `${(pos === 'before' ? top : top + r.height) - 1.5}px`;
      indEl.style.height = '3px';
    }
  };
  let sortOpen = $state(false);

  const sorted = $derived(sortTree(nodes, treeUi.sort, treeUi.orders));
  // 이름순·수정일순은 정렬 방법이면서 직접 순서의 출발점이기도 하다: 지금 보이는 순서를 직접 순서 값으로 조용히 옮겨 둔다
  dndUi.seedOrders = () => setOrders(ordersOf(sorted));
  function chooseSort(mode: SortMode) {
    if (mode !== 'manual') setOrders(ordersOf(sortTree(nodes, mode, {})));
    setSort(mode);
  }

  /** 파일명 검색: 폴더 경로까지 이어 붙인 이름이 일치하면 남긴다(폴더는 일치하는 하위 항목이 있을 때만) */
  function filterNodes(list: DocNode[], q: string, prefix = ''): DocNode[] {
    const out: DocNode[] = [];
    for (const n of list) {
      const label = prefix + (n.type === 'file' ? stripExt(n.name) : n.name);
      if (n.type === 'file') {
        if (matchName(label, q)) out.push(n);
      } else {
        const kids = filterNodes(n.children ?? [], q, label + '/');
        if (kids.length || matchName(label, q)) out.push({ ...n, children: kids.length ? kids : (n.children ?? []) });
      }
    }
    return out;
  }
  const view = $derived(filter.trim() ? filterNodes(sorted, filter) : sorted);

  // 스크롤 고정(sticky)되는 폴더 행이 쌓이는 높이를 맞추려고 실제 행 높이를 잰다
  let rowH = $state(28);
  $effect(() => {
    void view;
    void tick().then(() => {
      const h = navEl?.querySelector<HTMLElement>('.row')?.offsetHeight;
      if (h) rowH = h;
    });
  });

  // 열린 글이 바뀌면 트리가 따라간다(트리 밖에서 열었을 때만 상위 폴더를 펼친다. 규칙은 onActiveChange)
  $effect(() => {
    const path = ctl.activePath();
    const dir = ctl.activeDir();
    untrack(() => onActiveChange(path, dir));
  });

  /** 예약된 항목(폴더 또는 글)이 이미 잘 보이면 그대로 두고, 아니면 위에서 1/3 쯤에 오도록 스크롤한다 */
  function scrollToPath(path: string) {
    if (!navEl) return;
    const row = [...navEl.querySelectorAll<HTMLElement>('.row[data-path]')].find((r) => r.dataset.path === path);
    if (!row) return;
    const n = navEl.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const stuck = 4 * rowH; // 위에 고정되는 폴더 행 몫
    if (r.top >= n.top + stuck && r.bottom <= n.bottom) return;
    const top = r.top - n.top + navEl.scrollTop;
    navEl.scrollTo({ top: Math.max(0, top - n.height / 3), behavior: 'smooth' });
  }
  $effect(() => {
    const target = treeNav.pending;
    void view; // 폴더를 펼친 뒤 행이 그려진 다음에 찾는다
    if (target === null || !navEl) return;
    void tick().then(() => { scrollToPath(target); treeNav.pending = null; });
  });

  /** dir 폴더 안에서 지금 보이는 형제 이름 순서 */
  function siblings(dir: string): string[] {
    let list: DocNode[] = sorted;
    for (const seg of dir.split('/').filter(Boolean)) {
      const next = list.find((n) => n.type === 'dir' && n.name === seg);
      list = next?.children ?? [];
    }
    return list.map((n) => n.name);
  }

  const SORTS: { id: SortMode; icon: typeof Clock; desc: string }[] = [
    { id: 'name', icon: ArrowDownAZ, desc: '폴더가 먼저, 이름의 가나다·숫자 순' },
    { id: 'mtime', icon: Clock, desc: '가장 최근에 고친 글이 위로' },
    { id: 'manual', icon: Hand, desc: '끌어서 순서를 정합니다(폴더별로 기억)' },
  ];
  const current = $derived(SORTS.find((s) => s.id === treeUi.sort) ?? SORTS[0]);

  // 빈 곳(행이 아닌 목록 바탕)에 놓으면 최상위로 옮긴다
  function onRootOver(e: DragEvent) {
    const src = drag.node;
    if (!src || (src.dir ?? splitPath(src.path).folder) === '') return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dndUi.pos = '';
    dndUi.indicate(null, '');
    drag.hint = '최상위로 옮깁니다';
  }
  async function onRootDrop(e: DragEvent) {
    const src = drag.node;
    drag.node = null;
    drag.hint = '';
    dndUi.indicate(null, '');
    if (!src) return;
    e.preventDefault();
    await ctl.move(src, '');
  }
</script>

<div class="filterbox">
  <Search size={14} />
  <input bind:value={filter} placeholder="파일 이름 검색 (초성 가능)" aria-label="파일 이름 검색" spellcheck="false" />
  {#if filter}<button class="icon-btn" use:tip={'지우기'} aria-label="검색어 지우기" onclick={() => (filter = '')}><X size={14} /></button>{/if}
  <Pop bind:open={sortOpen} label="정렬 기준" width={290}>
    {#snippet trigger({ toggle, open })}
      <button class="icon-btn" class:on={open} aria-haspopup="dialog" aria-expanded={open} aria-label="정렬 기준: {SORT_LABEL[treeUi.sort]}"
        use:tip={{ title: SORT_LABEL[treeUi.sort], lines: ['눌러서 정렬 기준 바꾸기'] }} onclick={toggle}>
        <current.icon size={14} />
      </button>
    {/snippet}
    {#snippet children({ close })}
      {#each SORTS as s (s.id)}
        <button class="pop-row" class:on={treeUi.sort === s.id} onclick={() => { chooseSort(s.id); close(); }}>
          <s.icon size={18} />
          <span class="txt"><b>{SORT_LABEL[s.id]}</b><small>{s.desc}</small></span>
          {#if treeUi.sort === s.id}<Check size={15} />{/if}
        </button>
      {/each}
    {/snippet}
  </Pop>
</div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav class="tree" bind:this={navEl} style:position="relative" style:--row-h="{rowH}px" ondragover={onRootOver} ondrop={onRootDrop}
  ondragleave={(e) => { if (!navEl?.contains(e.relatedTarget as Node | null)) dndUi.indicate(null, ''); }}>
  <div class="drop-ind" bind:this={indEl} style:display="none" aria-hidden="true"></div>
  {#if view.length}
    <ul>
      {#each view as node (node.path)}
        <TreeNodeView {node} {filter} {drag} {siblings} />
      {/each}
    </ul>
  {:else if filter.trim()}
    <p class="empty">'{filter}' 와 일치하는 파일이 없습니다.</p>
  {:else}
    <p class="empty">{emptyText}</p>
  {/if}
  {#if drag.node && drag.hint}
    <div class="drag-hint" role="status">{drag.hint}</div>
  {/if}
</nav>

<style>
  /* className 을 직접 바꾸므로 범위(scoped) 클래스가 붙지 않아 :global 로 쓴다 */
  :global(.drop-ind) { position: absolute; z-index: 3; pointer-events: none; }
  :global(.drop-ind.line) { background: var(--accent); border-radius: 2px; }
  :global(.drop-ind.box) { background: var(--accent-soft); outline: 1px dashed var(--accent); outline-offset: -1px; border-radius: 6px; }
  /* 끌고 있는 동안 어디에 놓이는지 알려 주는 안내 줄(목록 아래에 붙어 있다) */
  .drag-hint {
    position: sticky; bottom: 0; margin: 6px 4px 0; padding: 6px 10px; border-radius: 8px; font-size: 12px; line-height: 1.4;
    background: var(--accent); color: var(--on-primary, #fff); box-shadow: var(--shadow); pointer-events: none;
  }
</style>
