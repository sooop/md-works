<script lang="ts">
  // 글 목록: 파일명 찾기 + 정렬 기준 선택 + 폴더 트리. 서버 모드와 단일 모드가 같이 쓰고, 모드별 동작은 ctl 로 받는다.
  import { onDestroy, setContext, tick, untrack } from 'svelte';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import ArrowDownAZ from '@lucide/svelte/icons/arrow-down-a-z';
  import Clock from '@lucide/svelte/icons/clock';
  import Hand from '@lucide/svelte/icons/hand';
  import Check from '@lucide/svelte/icons/check';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import FolderInput from '@lucide/svelte/icons/folder-input';
  import Download from '@lucide/svelte/icons/download';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import FileArchive from '@lucide/svelte/icons/file-archive';
  import FileBraces from '@lucide/svelte/icons/file-braces';
  import FileText from '@lucide/svelte/icons/file-text';
  import TreeNodeView, { type TreeFx } from './TreeNode.svelte';
  import Pop from './Pop.svelte';
  import MovePicker from './MovePicker.svelte';
  import TreeSelectToggle from './TreeSelectToggle.svelte';
  import { tip } from '../tooltip.svelte';
  import { matchName } from '../search/nameMatch';
  import { stripExt } from '../utils';
  import { toast, errMsg } from '../store.svelte';
  import { sortTree, ordersOf, type DocNode, type SortMode } from '../docTree';
  import { treeUi, setSort, setOrders, SORT_LABEL, treeNav, treeKb, onActiveChange, isCollapsed, toggleFolder, expandFolder } from '../docTree.svelte';
  import { tsel, setVisible, prune, reset as resetSel, clear as clearSel, setMode, selectAll, extendTo, moveAnchor } from '../treeSelect.svelte';
  import { pickedRoots, movableTo, dirOf } from '../treeSelect';
  import { flattenVisible, navigate, moveTargetsMany, indexOfPath, NAV_KEYS } from '../treeKeys';
  import { animOn, slideFx } from '../motion';
  import { TREE_CTL, dndUi, kbUi, selUi, type BulkResult, type DragState, type DropPos, type TreeCtl } from './treeCtl';

  interface Props {
    nodes: DocNode[];
    ctl: TreeCtl;
    filter: string;
    emptyText: string;
  }
  let { nodes, ctl, filter = $bindable(''), emptyText }: Props = $props();
  // svelte-ignore state_referenced_locally
  setContext(TREE_CTL, ctl); // ctl 은 셸이 한 번 만들어 넘기는 고정 객체다

  const drag = $state<DragState>({ node: null, hint: '', nodes: [] });
  let navEl = $state<HTMLElement>();
  let indEl = $state<HTMLDivElement>();
  // 놓을 위치 표시(선 또는 상자) 하나를 직접 옮긴다. 반응형 상태를 거치지 않아 마우스를 바로 따라온다
  // 형제 사이에 놓을 때(before·after)는 선 대신 그 자리의 행이 슬라이드로 비켜 '빈 슬롯'을 연다(.slot-before/.slot-after, TreeNode 스타일).
  // 슬롯의 빈 공간은 그 행의 ::before/::after 라 마우스 이벤트가 같은 행으로 들어와, 슬롯 위에서도 같은 위치로 놓인다.
  // 빠르게 지나갈 때 깜빡이지 않도록 열기 전에 잠깐 기다리고, 애니메이션을 끈 경우에는 기존의 선으로 보여 준다
  const SLOT_DELAY = 70;
  let gapRow: HTMLElement | null = null;
  let gapPos: DropPos = '';
  let gapTimer: ReturnType<typeof setTimeout> | undefined;
  function showGap(row: HTMLElement | null, pos: DropPos) {
    const want: DropPos = row && (pos === 'before' || pos === 'after') ? pos : '';
    if (row === gapRow && want === gapPos) return;
    clearTimeout(gapTimer);
    gapRow?.classList.remove('slot-before', 'slot-after');
    gapRow = want ? row : null;
    gapPos = want;
    const r = gapRow;
    if (!r) return;
    gapTimer = setTimeout(() => r.classList.add(want === 'before' ? 'slot-before' : 'slot-after'), SLOT_DELAY);
  }
  dndUi.indicate = (row: HTMLElement | null, pos: DropPos) => {
    if (!indEl || !navEl) return;
    const slot = animOn() && !!row && (pos === 'before' || pos === 'after');
    showGap(slot ? row : null, slot ? pos : '');
    if (!row || !pos || slot) { indEl.style.display = 'none'; return; }
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

  // 삽입·삭제 효과용: 접어 둔 폴더 안까지 포함한 전체 경로 집합(nodes 기준이라 필터·접기에는 변하지 않는다)
  const collect = (list: DocNode[], out = new Set<string>()): Set<string> => { for (const n of list) { out.add(n.path); if (n.children) collect(n.children, out); } return out; };
  const allPaths = $derived(collect(nodes));
  // 직전에 본 경로. 처음 채워질 때(빈 상태 → 목록)는 기준선만 잡고 재생하지 않으며, 이름 바꾸기·이동으로 상위가 함께 사라진 하위 항목도 재생하지 않는다
  let seen = new Set<string>();
  // 이름 바꾸기는 경로가 바뀌어 '옛 항목 삭제 + 새 항목 삽입'처럼 보이므로(폴더가 순간 두 벌로 보인다), 직전 트리와 견줘
  // 같은 자리에서 이름만 바뀐 항목(폴더는 안의 구성이 같고, 글은 수정 시각이 같다)을 찾아 삭제·삽입 효과에서 뺀다
  interface Info { type: 'file' | 'dir'; parent: string; sig: string }
  const indexTree = (list: DocNode[], parent = '', out = new Map<string, Info>()): { out: Map<string, Info>; rels: string[] } => {
    const rels: string[] = [];
    for (const n of list) {
      if (n.type === 'file') { out.set(n.path, { type: 'file', parent, sig: String(n.mtime ?? '') }); rels.push(`f:${n.mtime ?? ''}:${n.name}`); continue; }
      const sub = indexTree(n.children ?? [], n.path, out);
      out.set(n.path, { type: 'dir', parent, sig: sub.rels.join('|') });
      rels.push(`d:${n.name}{${sub.rels.join(',')}}`);
    }
    return { out, rels };
  };
  let prevIndex = new Map<string, Info>();
  let quietKey: [Set<string>, Set<string>] | null = null;
  let quiet = new Set<string>();
  function renamedPaths(): Set<string> {
    if (quietKey && quietKey[0] === seen && quietKey[1] === allPaths) return quiet;
    quietKey = [seen, allPaths];
    quiet = new Set();
    const cur = indexTree(nodes).out;
    const gone = [...prevIndex.keys()].filter((p) => !cur.has(p));
    const fresh = [...cur.keys()].filter((p) => !prevIndex.has(p));
    const sameSpot = (r: string, a: string) => {
      const ri = prevIndex.get(r)!, ai = cur.get(a)!;
      return ri.type === ai.type && ri.parent === ai.parent && ri.sig === ai.sig;
    };
    for (const r of gone) {
      const ri = prevIndex.get(r)!;
      const twins = fresh.filter((a) => cur.get(a)!.type === ri.type && sameSpot(r, a));
      const rivals = gone.filter((x) => prevIndex.get(x)!.type === ri.type && prevIndex.get(x)!.parent === ri.parent && prevIndex.get(x)!.sig === ri.sig);
      if (twins.length !== 1 || rivals.length !== 1) continue; // 짝이 하나로 정해질 때만 이름 바꾸기로 본다
      const a = twins[0];
      quiet.add(r); quiet.add(a);
      for (const p of prevIndex.keys()) if (p.startsWith(r + '/')) quiet.add(p);
      for (const p of cur.keys()) if (p.startsWith(a + '/')) quiet.add(p);
    }
    return quiet;
  }
  $effect(() => { seen = new Set(allPaths); prevIndex = indexTree(nodes).out; });
  const fx: TreeFx = {
    isNew: (path, parent) => !dndUi.moving && seen.size > 0 && !seen.has(path) && (parent === '' || seen.has(parent)) && !renamedPaths().has(path),
    isGone: (path, parent) => !dndUi.moving && !allPaths.has(path) && (parent === '' || allPaths.has(parent)) && !renamedPaths().has(path),
  };

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

  // ---- 키보드 조작(WAI-ARIA tree) ----
  // 파일명 검색 중에는 일치 항목이 보이도록 모든 폴더가 펼쳐져 있다(TreeNode 의 open 과 같은 규칙) — 그때는 접고 펼치지 않는다
  const filtering = $derived(!!filter.trim());
  const isOpen = (n: DocNode) => filtering || !isCollapsed(n.path);
  const flat = $derived(flattenVisible(view, isOpen));

  // roving tabindex: 트리 전체에서 Tab 정지점은 하나. 마지막으로 포커스한 항목 → (사라졌으면 그 자리 근처) → 열린 글 → 첫 항목
  let lastIdx = 0;
  const stopPath = $derived.by(() => {
    if (!flat.length) return '';
    if (treeKb.last) {
      const i = indexOfPath(flat, treeKb.last);
      return i >= 0 ? flat[i].path : flat[Math.min(lastIdx, flat.length - 1)].path;
    }
    return (flat.find((i) => i.node.type === 'file' && ctl.isActive(i.node)) ?? flat[0]).path;
  });
  $effect.pre(() => { treeKb.stop = stopPath; });
  $effect(() => { const i = indexOfPath(flat, treeKb.last); if (i >= 0) lastIdx = i; });

  const rowOf = (path: string) => navEl ? [...navEl.querySelectorAll<HTMLElement>('.row[data-path]')].find((r) => r.dataset.path === path) : undefined;
  /** 그 항목의 이름 칸에 포커스를 주고, 위에 붙어 있는 폴더 행에 가리지 않게 스크롤한다 */
  async function focusPath(path: string) {
    treeKb.last = path;
    await tick();
    const row = rowOf(path);
    const el = row?.querySelector<HTMLElement>('[role="treeitem"]');
    if (!row || !el || !navEl) return;
    el.focus({ preventScroll: true });
    const item = flat[indexOfPath(flat, path)];
    const stuck = Math.min(item?.depth ?? 0, 4) * rowH; // 조상 폴더 행이 위에 쌓이는 높이
    const n = navEl.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < n.top + stuck) navEl.scrollTop -= n.top + stuck - r.top;
    else if (r.bottom > n.bottom) navEl.scrollTop += r.bottom - n.bottom;
  }
  kbUi.focus = (path) => { void focusPath(path); };

  // 삭제·이름 변경 뒤 포커스가 바닥(body)으로 떨어지면 정지점 항목으로 되돌린다. 목록이 갱신되는 동안(몇 초) 바뀔 때마다 다시 본다
  let refocusUntil = 0;
  const lost = () => { const a = document.activeElement; return !a || a === document.body || a === document.documentElement; };
  function restoreFocus() {
    if (Date.now() < refocusUntil && lost() && treeKb.stop) void focusPath(treeKb.stop);
  }
  kbUi.expectRefocus = () => {
    refocusUntil = Date.now() + 3000;
    for (const ms of [0, 200, 600]) setTimeout(restoreFocus, ms);
  };
  $effect(() => { void flat; restoreFocus(); });

  function onTreeKey(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229 || e.altKey) return;
    const mod = e.ctrlKey || e.metaKey;
    const arrow = e.key === 'ArrowDown' || e.key === 'ArrowUp';
    const selectAllKey = mod && !e.shiftKey && e.key.toLowerCase() === 'a';
    const extendKey = e.shiftKey && !mod && arrow;
    if (!selectAllKey && !extendKey && (e.shiftKey || mod || !NAV_KEYS.has(e.key))) return;
    const el = e.target as HTMLElement;
    if (el.getAttribute('role') !== 'treeitem') return; // 이름 입력·행 단추에서 온 키는 건드리지 않는다
    const path = el.closest<HTMLElement>('.row[data-path]')?.dataset.path;
    if (path === undefined) return;
    e.preventDefault();
    if (selectAllKey) { selectAll(); return; } // Ctrl+A: 보이는 항목 전체
    if (extendKey) { // Shift+↑/↓: 기준 항목부터 한 칸씩 범위를 늘리고 줄인다
      const i = indexOfPath(flat, path);
      const j = i + (e.key === 'ArrowDown' ? 1 : -1);
      if (i < 0 || j < 0 || j >= flat.length) return;
      extendTo(path, flat[j].path);
      void focusPath(flat[j].path);
      return;
    }
    const r = navigate(flat, path, e.key, isOpen, !filtering);
    if (!r) return;
    if ('focus' in r) { moveAnchor(r.focus); void focusPath(r.focus); }
    else if ('expand' in r) expandFolder(r.expand);
    else toggleFolder(r.collapse);
  }

  // ---- '이동…' 대상 고르기 ----
  let mover = $state<{ nodes: DocNode[]; x: number; y: number; from: HTMLElement | null } | null>(null);
  kbUi.moveTo = (node, at, from) => { mover = { nodes: [node], x: at.x, y: at.y, from: from ?? null }; };
  async function pickMove(destDir: string) {
    const m = mover;
    mover = null;
    if (!m) return;
    await moveNodes(m.nodes, destDir);
    kbUi.expectRefocus();
  }

  // ---- 다중 선택 ----
  // 선택은 보이는 항목만 남긴다(필터·접기·삭제·이동으로 사라지면 정리). 범위 선택은 이 목록 순서를 쓴다
  $effect.pre(() => {
    const paths = flat.map((i) => i.path);
    untrack(() => { setVisible(paths); prune(paths); });
  });
  onDestroy(resetSel);
  /** 일괄 동작의 대상: 선택된 항목을 트리 순서로, 폴더와 그 안의 항목을 함께 골랐으면 상위 폴더만 */
  const pickedNodes = $derived(pickedRoots(sorted, tsel.picked));
  const dlRows = [
    { id: 'zip', icon: FileArchive, title: 'MD 압축(zip)', desc: '글(.md)과 이미지를 폴더 구조 그대로 zip 으로' },
    { id: 'json', icon: FileBraces, title: '백업 JSON', desc: '글·이미지·코멘트를 JSON 하나로(복원용)' },
    { id: 'md', icon: FileText, title: '연결된 MD', desc: '글을 이어 붙인 .md 하나(이미지는 본문에 포함)' },
  ];
  let dlOpen = $state(false);

  /** 일부라도 실패했으면 성공·실패 개수와 첫 실패 이유를 알린다(전부 성공하면 화면이 바뀌므로 알리지 않는다) */
  function bulkNotice(r: BulkResult, done: string, fail: string) {
    if (!r.failed) return;
    const why = r.error ? `: ${r.error}` : '';
    toast(r.ok ? `${r.ok}개를 ${done}고 ${r.failed}개는 ${fail}습니다${why}` : `${fail}습니다${why}`, 'error');
  }
  /** 항목들을 destDir 로 옮긴다. 이미 그 폴더에 있는 것·자기 하위로 가는 것은 뺀다. moveMany 가 없으면 하나씩 옮긴다 */
  async function moveNodes(nodes: DocNode[], destDir: string) {
    const list = movableTo(nodes, destDir);
    if (!list.length) return;
    expandFolder(destDir); // 옮겨 간 곳이 보이도록
    if (list.length === 1 || !ctl.moveMany) {
      for (const n of list) await ctl.move(n, destDir); // 실패는 move 가 알린다
      return;
    }
    try {
      bulkNotice(await ctl.moveMany(list, destDir), '옮겼', '옮기지 못했');
    } catch (e) {
      toast(`옮기지 못했습니다: ${errMsg(e)}`, 'error');
    }
  }
  async function downloadPicked(format: string) {
    const nodes = pickedNodes;
    if (!ctl.downloadMany || !nodes.length) return;
    try { await ctl.downloadMany(nodes, format); } catch (e) { toast(`내려받지 못했습니다: ${errMsg(e)}`, 'error'); }
  }
  async function removePicked() {
    const nodes = pickedNodes;
    if (!ctl.removeMany || !nodes.length) return;
    try {
      const r = await ctl.removeMany(nodes);
      bulkNotice(r, '삭제했', '삭제하지 못했');
      if (!r.failed) clearSel();
    } catch (e) {
      toast(`삭제하지 못했습니다: ${errMsg(e)}`, 'error');
    }
    kbUi.expectRefocus();
  }
  selUi.group = (node) => (pickedNodes.some((n) => n.path === node.path) ? pickedNodes : [node]);
  selUi.moveNodes = moveNodes;
  selUi.moveTo = (at, from) => { if (pickedNodes.length) mover = { nodes: pickedNodes, x: at.x, y: at.y, from: from ?? null }; };
  selUi.download = downloadPicked;
  selUi.remove = removePicked;

  // Esc: 선택 모드 종료, 그다음엔 선택 해제 (이름·검색 입력 중일 때는 건드리지 않는다)
  function onSelEsc(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    if ((e.target as HTMLElement).closest('input:not([type="checkbox"]), textarea')) return;
    if (tsel.mode) { setMode(false); e.preventDefault(); }
    else if (tsel.picked.length) { clearSel(); e.preventDefault(); }
  }

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
  const draggedNodes = (): DocNode[] => (drag.nodes?.length ? drag.nodes : drag.node ? [drag.node] : []);
  function onRootOver(e: DragEvent) {
    const srcs = draggedNodes();
    if (!srcs.length || srcs.every((s) => dirOf(s) === '')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dndUi.pos = '';
    dndUi.indicate(null, '');
    drag.hint = srcs.length > 1 ? `선택한 ${srcs.length}개를 최상위로 옮깁니다` : '최상위로 옮깁니다';
  }
  async function onRootDrop(e: DragEvent) {
    const src = drag.node;
    const srcs = draggedNodes();
    drag.node = null;
    drag.nodes = [];
    drag.hint = '';
    dndUi.indicate(null, '');
    if (!src) return;
    e.preventDefault();
    if (srcs.length > 1) await moveNodes(srcs, '');
    else await ctl.move(src, '');
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
  <TreeSelectToggle size={14} />
</div>
{#if tsel.picked.length}
  <div class="selbar" role="toolbar" aria-label="선택한 항목 일괄 작업" tabindex="-1" transition:slideFx onkeydown={onSelEsc}>
    <strong>{tsel.picked.length}개 선택</strong>
    <span class="spacer"></span>
    <button aria-label="선택한 항목 이동" use:tip={{ title: '이동', lines: ['고른 폴더로 옮깁니다'] }}
      onclick={(e) => { const b = e.currentTarget; const r = b.getBoundingClientRect(); selUi.moveTo({ x: r.left, y: r.bottom + 4 }, b); }}><FolderInput size={14} /> 이동</button>
    {#if ctl.downloadMany}
      <Pop bind:open={dlOpen} label="내려받기 형식" width={300}>
        {#snippet trigger({ toggle, open })}
          <button aria-haspopup="dialog" aria-expanded={open} aria-label="선택한 항목 내려받기" use:tip={{ title: '내려받기', lines: ['폴더 구조와 이미지를 유지해 파일 하나로 받습니다'] }} onclick={toggle}><Download size={14} /> 내려받기</button>
        {/snippet}
        {#snippet children({ close })}
          {#each dlRows as r (r.id)}
            <button class="pop-row" onclick={() => { close(); void downloadPicked(r.id); }}>
              <r.icon size={18} />
              <span class="txt"><b>{r.title}</b><small>{r.desc}</small></span>
            </button>
          {/each}
        {/snippet}
      </Pop>
    {/if}
    {#if ctl.removeMany}
      <button class="danger" aria-label="선택한 항목 삭제" use:tip={{ title: '휴지통으로 이동', lines: ['삭제 직후 되돌릴 수 있고, 휴지통에서 복구합니다'] }} onclick={() => void removePicked()}><Trash2 size={14} /> 삭제</button>
    {/if}
    <button class="icon-btn" aria-label="선택 해제" use:tip={'선택 해제'} onclick={clearSel}><X size={15} /></button>
  </div>
{/if}
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav class="tree" class:dnd={!!drag.node} bind:this={navEl} style:position="relative" style:--row-h="{rowH}px" ondragover={onRootOver} ondrop={onRootDrop} onkeydown={onSelEsc}
  ondragleave={(e) => { if (!navEl?.contains(e.relatedTarget as Node | null)) dndUi.indicate(null, ''); }}>
  <div class="drop-ind" bind:this={indEl} style:display="none" aria-hidden="true"></div>
  {#if view.length}
    <ul role="tree" aria-label="글 목록" aria-multiselectable="true" onkeydown={onTreeKey}>
      {#each view as node (node.path)}
        <TreeNodeView {node} {filter} {drag} {siblings} {fx} />
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
{#if mover}
  <MovePicker name={mover.nodes[0].type === 'file' ? stripExt(mover.nodes[0].name) : mover.nodes[0].name} count={mover.nodes.length} targets={moveTargetsMany(sorted, mover.nodes)} x={mover.x} y={mover.y} from={mover.from} onPick={pickMove} onClose={() => (mover = null)} />
{/if}

<style>
  .selbar { margin-top: 6px; }
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
