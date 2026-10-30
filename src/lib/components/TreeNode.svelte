<script module lang="ts">
  /** 항목이 정말 새로 생기거나 사라졌는지 판정하는 함수 묶음(DocTree 가 만들어 내려 준다) */
  export interface TreeFx {
    /** 새로 생긴 경로인가(처음 그려질 때·펼침·필터로 다시 그려지는 것은 아니다) */
    isNew: (path: string, parent: string) => boolean;
    /** 트리에서 실제로 사라진 경로인가(접기·필터로 가려지는 것은 아니다) */
    isGone: (path: string, parent: string) => boolean;
  }
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import { insertFx, removeFx, slideFx, animOn, flyGhost, type FlyRect } from '../motion';
  import TreeNode from './TreeNode.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Folder from '@lucide/svelte/icons/folder';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import FileText from '@lucide/svelte/icons/file-text';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import { stripExt, fmtDateTime } from '../utils';
  import { tip } from '../tooltip.svelte';
  import { openContextMenu } from '../contextmenu.svelte';
  import { highlight } from '../search/nameMatch';
  import { isCollapsed, toggleFolder, expandFolder, treeUi, treeNav, moveInOrder, setSort } from '../docTree.svelte';
  import { splitPath, type DocNode } from '../docTree';
  import { TREE_CTL, dndUi, type DragState, type TreeCtl } from './treeCtl';
  import RenameInput from './RenameInput.svelte';

  interface Props {
    node: DocNode;
    depth?: number;
    filter?: string;
    drag: DragState;
    /** dir 폴더 안에서 지금 화면에 보이는 형제 이름 순서(직접 정렬에서 끼워 넣을 위치를 구한다) */
    siblings: (dir: string) => string[];
    /** 같은 폴더의 마지막 항목인지(연결선이 'ㄴ' 자로 끝난다) */
    last?: boolean;
    fx: TreeFx;
  }
  let { node, depth = 0, filter = '', drag, siblings, last = false, fx }: Props = $props();
  const ctl = getContext<TreeCtl>(TREE_CTL);

  let renaming = $state(false);
  const parent = $derived(node.dir ?? splitPath(node.path).folder);
  const shownName = $derived(node.type === 'file' ? stripExt(node.name) : node.name);
  const open = $derived(!!filter.trim() || !isCollapsed(node.path)); // 파일명 검색 중에는 일치 항목이 보이도록 모두 펼친다
  const parts = $derived(highlight(shownName, filter));
  const menuItems = $derived([
    ...(node.type === 'dir' ? [{ label: '새 문서', run: () => ctl.createDoc(node.path) }, { label: '새 폴더', run: () => ctl.createFolder(node.path) }] : []),
    { label: '이름 변경', run: () => { renaming = true; }, sep: node.type === 'dir' },
    { label: '삭제…', run: () => ctl.remove(node), danger: true, sep: true },
  ]);

  // 트리에서 직접 연 글은 열린 글이 바뀌어도 접어 둔 폴더를 다시 펼치지 않는다(DocTree 의 onActiveChange)
  const openFile = () => { treeNav.fromTree = node.path; ctl.open(node); };
  // 삽입·삭제 효과는 항목이 트리에 실제로 생기거나 사라질 때만 재생한다. <li> 는 컴포넌트의 최상위라 |global 이 필요하고,
  // 그러면 상위 블록(폴더 펼침·접힘, 필터, 사이드바 열고 닫기)이 바뀔 때도 불리므로 여기서 걸러 낸다
  const none = { duration: 0 };
  const insFx = (n: Element, p: { collapse?: boolean }, o: { direction: 'in' | 'out' | 'both' }) => (fx.isNew(node.path, parent) ? insertFx(n, p, o) : none);
  const rmFx = (n: Element, p: { collapse?: boolean }, o: { direction: 'in' | 'out' | 'both' }) => (fx.isGone(node.path, parent) ? removeFx(n, p, o) : none);
  /** 이 폴더가 선택돼 있으면 그 아래 항목 전체를 '현재 범위'로 묶어 보인다 */
  /** 펼친 폴더 행은 스크롤해도 위에 남긴다(깊이 3단계까지 쌓는다) */
  const stick = $derived(node.type === 'dir' && open && !!node.children?.length && depth < 4);

  // Enter·Space 로 누른 것과 같게(div 라서 직접 처리한다). 이름 바꾸는 입력에서 온 키는 건드리지 않는다
  function key(e: KeyboardEvent, run: () => void) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
  }

  // ---- 끌어서 옮기기·순서 바꾸기 ----
  const manual = $derived(treeUi.sort === 'manual');
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  const isSelfOrChild = (src: DocNode, destDir: string) => src.type === 'dir' && (destDir === src.path || destDir.startsWith(src.path + '/'));

  function posOf(e: DragEvent): 'before' | 'after' | 'into' {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (node.type === 'dir') return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
    return y < 0.5 ? 'before' : 'after';
  }
  // 끌기 시작 뒤 잠깐(고스트 이미지가 만들어진 다음) 끌던 항목이 있던 자리를 슬라이드로 접어 목록이 좁아지게 한다. 끝나면 되돌린다
  const LIFT_DELAY = 140;
  const LIFT_MS = 200;
  let liftTimer: ReturnType<typeof setTimeout> | undefined;
  let liftLi: HTMLElement | null = null;
  function liftSource(li: HTMLElement | null) {
    if (!li || !animOn()) return;
    liftTimer = setTimeout(() => {
      if (drag.node?.path !== node.path) return;
      liftLi = li;
      dndUi.restoreSource = () => dropSource(true);
      li.style.maxHeight = `${li.offsetHeight}px`;
      li.style.overflow = 'hidden';
      requestAnimationFrame(() => {
        li.style.transition = `max-height ${LIFT_MS}ms var(--ease-out, ease-out), opacity ${LIFT_MS}ms ease-out`;
        li.style.maxHeight = '0px';
        li.style.opacity = '0';
      });
    }, LIFT_DELAY);
  }
  function dropSource(instant = false) {
    clearTimeout(liftTimer);
    const li = liftLi;
    liftLi = null;
    if (dndUi.restoreSource) dndUi.restoreSource = null;
    if (!li) return;
    if (instant) { li.style.maxHeight = ''; li.style.overflow = ''; li.style.transition = ''; li.style.opacity = ''; return; }
    // 같은 자리에 남아 있으면 슬라이드로 다시 펼친다(옮겨졌다면 이 요소는 곧 사라진다)
    li.style.maxHeight = `${li.scrollHeight}px`;
    li.style.opacity = '';
    setTimeout(() => { li.style.maxHeight = ''; li.style.overflow = ''; li.style.transition = ''; }, LIFT_MS);
  }
  function onDragStart(e: DragEvent) {
    if (renaming) { e.preventDefault(); return; }
    drag.node = node;
    e.dataTransfer?.setData('text/plain', node.name);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    const row = e.currentTarget as HTMLElement;
    // 놓을 때 날려 보낼 고스트: 끌기 시작 시점의 행 모양을 복제해 두고(곧 목록에서 접힌다), 잡은 위치를 기억한다
    if (animOn()) {
      const r = row.getBoundingClientRect();
      const el = row.cloneNode(true) as HTMLElement;
      el.classList.remove('stick', 'dragging', 'active', 'selected');
      el.removeAttribute('data-path');
      el.removeAttribute('draggable');
      el.style.background = 'var(--surface-2)';
      el.style.boxShadow = 'var(--shadow)';
      el.style.borderRadius = '6px';
      dndUi.ghost = { el, dx: e.clientX - r.left, dy: e.clientY - r.top, width: r.width, height: r.height };
    }
    liftSource(row.closest('li'));
  }
  function onDragEnd(keepGap = false) { dndUi.ghost = null; drag.node = null; drag.hint = ''; dndUi.pos = ''; if (!keepGap) dndUi.indicate(null, ''); clearTimeout(hoverTimer); dropSource(); }
  function onDragOver(e: DragEvent) {
    const src = drag.node;
    if (!src || src.path === node.path) return;
    const pos = posOf(e);
    const dest = pos === 'into' ? node.path : parent;
    if (isSelfOrChild(src, dest)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dndUi.pos = pos;
    dndUi.indicate(e.currentTarget as HTMLElement, pos);
    const where = dest ? `'${dest}' 폴더` : '최상위';
    const srcDir0 = src.dir ?? splitPath(src.path).folder;
    // 안내 줄은 위치가 선만으로 알 수 없는 경우에만 쓴다(같은 문장이면 다시 대입해도 화면은 바뀌지 않는다)
    if (pos === 'into') drag.hint = `'${node.name}' 폴더 안으로 옮깁니다`;
    else if (dest !== srcDir0) drag.hint = `${where}로 옮깁니다`;
    else if (src.type !== node.type && !manual) drag.hint = '글과 폴더를 섞으려면 정렬을 직접 정렬로 바꾸세요';
    else drag.hint = '';
    // 접힌 폴더 위에 잠깐 머물면 펼친다
    clearTimeout(hoverTimer);
    if (node.type === 'dir' && pos === 'into' && isCollapsed(node.path)) hoverTimer = setTimeout(() => expandFolder(node.path), 700);
  }
  function onDragLeave() { clearTimeout(hoverTimer); } // 표시는 목록을 벗어날 때(DocTree)·놓을 때 거둔다 — 행 사이를 지날 때 깜빡이지 않게
  // 놓은 자리: 형제 사이면 슬롯이 열려 있던 곳(아직 덜 열렸으면 열릴 자리), 폴더 안이면 그 폴더 행
  function landingRect(row: HTMLElement, pos: 'before' | 'after' | 'into'): FlyRect {
    const r = row.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(row).marginTop) || 0;
    const top = pos === 'before' ? r.top - gap : pos === 'after' ? r.bottom : r.top;
    return { left: r.left, top, width: r.width, height: r.height };
  }
  /** 고스트를 놓은 위치에서 들어갈 자리로 날려 보낸다. 자리에 새로 그려진 실제 행은 고스트가 앉을 때까지 숨긴다(원래 자리에서 옮겨 오는 효과는 쓰지 않는다) */
  async function flyToLanding(ghost: NonNullable<typeof dndUi.ghost>, at: { x: number; y: number }, to: FlyRect, into: boolean, newPath: string, keepGap: boolean) {
    const from: FlyRect = { left: at.x - ghost.dx, top: at.y - ghost.dy, width: ghost.width, height: ghost.height };
    let flying = true;
    let real: HTMLElement | null = null;
    // 옮긴 항목이 트리에 새로 그려지는 시점은 서버 응답에 따라 다르므로, 나는 동안 계속 찾아서 나타나는 즉시 숨긴다
    const hideReal = () => {
      if (!flying) return;
      if (!real) real = document.querySelector<HTMLElement>(`.row[data-path="${CSS.escape(newPath)}"]`);
      if (real) { real.style.visibility = 'hidden'; if (keepGap) { keepGap = false; dndUi.indicate(null, ''); } } // 새 행이 그려졌으니 열어 둔 슬롯을 거둔다
      requestAnimationFrame(hideReal);
    };
    requestAnimationFrame(hideReal);
    await flyGhost(ghost.el, from, to, into);
    flying = false;
    if (keepGap) dndUi.indicate(null, '');
    if (real) (real as HTMLElement).style.visibility = '';
  }
  async function onDrop(e: DragEvent) {
    const src = drag.node;
    const pos = dndUi.pos || posOf(e);
    const row = e.currentTarget as HTMLElement;
    const ghost = dndUi.ghost;
    const landing = landingRect(row, pos);
    const at = { x: e.clientX, y: e.clientY };
    const into = pos === 'into';
    const dest = into ? node.path : parent;
    const srcDir = src ? (src.dir ?? splitPath(src.path).folder) : '';
    // 다른 폴더로 옮길 때는 새 행이 그려질 때까지 슬롯을 열어 둔다. 같은 폴더 안이면 이미 펼쳐진 자리에 바로 앉도록
    // 끌던 항목의 접힘과 슬롯을 한꺼번에 거둬, 주변 행이 다시 움직이지 않게 한다
    const ok = !!src && src.path !== node.path && !isSelfOrChild(src, dest);
    const keepGap = ok && !into && dest !== srcDir;
    if (ok && !keepGap) dndUi.restoreSource?.();
    onDragEnd(keepGap);
    if (!src || !ok) return;
    e.preventDefault();
    e.stopPropagation();
    dndUi.moving = true; // 옮기기는 삭제·삽입 효과 대신 고스트가 날아가는 효과로 보인다
    setTimeout(() => { dndUi.moving = false; }, 1200);
    if (ghost) void flyToLanding(ghost, at, landing, into, `${dest ? dest + '/' : ''}${src.name}`, keepGap);
    if (dest !== srcDir) await ctl.move(src, dest);
    // 형제 사이에 끼워 넣는다. 직접 정렬은 글과 폴더를 섞을 수 있고, 이름순·수정일순은 폴더가 먼저라 종류가 다르면 순서를 건드리지 않는다.
    // 이름순·수정일순에서 놓았으면 그 자리의 순서를 기준으로 삼아 '직접 정렬'로 바꾼다
    if (!into && (manual || src.type === node.type)) {
      if (!manual) dndUi.seedOrders(); // 모든 폴더의 보이던 순서를 직접 순서의 출발점으로(확인 없이 조용히)
      const current = siblings(dest); // 놓기 직전 화면에 보이던 순서
      const sib = current.filter((n) => n !== src.name);
      const at = sib.indexOf(node.name);
      const before = pos === 'before' ? node.name : sib[at + 1];
      moveInOrder(dest, current, src.name, before);
      if (!manual) setSort('manual');
    }
  }
</script>

<li class:child={depth > 0} class:file={node.type === 'file'} class:last style:--p={depth - 1} in:insFx|global={{ collapse: true }} out:rmFx|global={{ collapse: true }}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="row"
    class:active={node.type === 'file' && ctl.isActive(node)}
    class:selected={node.type === 'dir' && ctl.selectedDir() === node.path}
    class:dragging={drag.node?.path === node.path}
    class:stick
    data-path={node.path}
    style:--d={depth}
    style:padding-left="{8 + depth * 14}px"
    oncontextmenu={(e) => openContextMenu(e, menuItems)}
    draggable={!renaming}
    ondragstart={onDragStart}
    ondragend={() => onDragEnd()}
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    role="presentation"
  >
    {#if renaming}
      <span class="name">
        <span class="twisty"></span>
        {#if node.type === 'dir'}<Folder size={15} class="ico" />{:else}<FileText size={15} class="ico" />{/if}
        <RenameInput value={shownName} onCommit={(v) => { renaming = false; void ctl.rename(node, v); }} onCancel={() => (renaming = false)} />
      </span>
    {:else if node.type === 'dir'}
      <div class="name" role="button" tabindex="0" ondblclick={() => (renaming = true)} onclick={() => { ctl.selectDir(node.path); toggleFolder(node.path); }} onkeydown={(e) => key(e, () => { ctl.selectDir(node.path); toggleFolder(node.path); })} aria-expanded={open}
        use:tip={{ title: node.name, lines: ['선택한 폴더에 새 문서가 만들어집니다', '더블 클릭: 이름 변경 · 우클릭: 메뉴 · 끌어서 옮기기'] }}>
        <span class="twisty">{#if open}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}</span>
        {#if open}<FolderOpen size={15} class="ico" />{:else}<Folder size={15} class="ico" />{/if}
        <span class="label">{#each parts as p}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}</span>
      </div>
    {:else}
      <div class="name" role="button" tabindex="0" ondblclick={() => (renaming = true)} onclick={openFile} onkeydown={(e) => key(e, openFile)}
        use:tip={{ title: shownName, lines: [...ctl.tipLines(node), '더블 클릭: 이름 변경 · 우클릭: 메뉴 · 끌어서 옮기기'] }}>
        <span class="twisty"></span>
        <FileText size={15} class="ico" />
        <span class="label">{#each parts as p}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}</span>
        {#if ctl.isDirty(node)}<span class="dot" use:tip={'저장 안 됨'}>●</span>{/if}
      </div>
    {/if}
    {#if node.type === 'dir' && !renaming}
      <span class="ops">
        <button use:tip={'새 문서'} aria-label="새 문서" onclick={() => ctl.createDoc(node.path)}><FilePlus size={14} /></button>
        <button use:tip={'새 폴더'} aria-label="새 폴더" onclick={() => ctl.createFolder(node.path)}><FolderPlus size={14} /></button>
      </span>
    {/if}
  </div>
  {#if node.type === 'dir' && open && node.children?.length}
    <ul class="kids" style:--d={depth} transition:slideFx>
      {#each node.children as child, i (child.path)}
        <TreeNode node={child} depth={depth + 1} {filter} {drag} {siblings} {fx} last={i === node.children.length - 1} />
      {/each}
    </ul>
  {/if}
</li>

<style>
  .row { position: relative; }
  /* 끌어서 순서를 바꿀 때 놓을 자리에 빈 슬롯을 여는 슬라이드: 대상 행이 한 행만큼 비켜 서고, 비워진 자리에 점선 상자를 보인다.
   * 상자는 행의 ::before/::after 라 슬롯 위에 놓아도 같은 행이 이벤트를 받는다 */
  :global(.tree.dnd) .row { transition: margin 170ms var(--ease-out, cubic-bezier(0.2, 0.8, 0.2, 1)); }
  .row:global(.slot-before) { margin-top: var(--row-h, 28px); }
  .row:global(.slot-after) { margin-bottom: var(--row-h, 28px); }
  .row:global(.slot-before)::before, .row:global(.slot-after)::after {
    content: ''; position: absolute; left: 0; right: 0; height: var(--row-h, 28px); box-sizing: border-box;
    border: 3px solid transparent; background: var(--accent-soft); background-clip: padding-box; outline: 1px dashed var(--accent); outline-offset: -4px;
    border-radius: 8px; animation: slot-in 170ms ease-out; pointer-events: auto;
  }
  .row:global(.slot-before)::before { top: calc(-1 * var(--row-h, 28px)); }
  .row:global(.slot-after)::after { bottom: calc(-1 * var(--row-h, 28px)); }
  @keyframes slot-in { from { opacity: 0; } to { opacity: 1; } }
  .name { cursor: pointer; user-select: none; }
  .name:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 4px; }
  .row.dragging { opacity: 0.45; }
  /* 열린 글: 은은한 강조색 배경 + 굵은 글씨(막대·테두리 없이). 선택한 폴더: 배경 없이 굵게 + 강조 글자색 */
  .row.active { background: var(--accent-soft); }
  .row.active .label { font-weight: 600; color: var(--text); }
  .row.selected, .row.stick.selected { background: transparent; }
  .row.selected .label { font-weight: 600; color: var(--primary); }
  .row.selected:hover, .row.selected:focus-within, .row.stick.selected:hover { background: var(--hover); }

  /* 들여쓰기 연결선: 부모 폴더의 펼침 화살표 아래로 세로선을 내리고, 항목마다 가로로 꺾어 붙인다(├). 같은 폴더의 마지막 항목에서는
   * 세로선이 행 가운데에서 끝나 범위의 끝을 알린다(└). 행은 position:relative 라 배경이 선을 덮으므로 선을 행 위(z-index 1)에 그린다.
   * 선은 자식 글자 왼쪽 여백에 있어 글자를 가리지 않는다 */
  li { position: relative; }
  li.child::before, li.child::after { content: ''; position: absolute; z-index: 1; pointer-events: none; background: var(--guide, var(--border)); }
  li.child::before { left: calc(19px + var(--p, 0) * 14px); top: 0; bottom: 0; width: 1px; }
  li.child.last::before { bottom: auto; height: calc(var(--row-h, 28px) / 2); }
  li.child::after { left: calc(19px + var(--p, 0) * 14px); top: calc(var(--row-h, 28px) / 2); width: 7px; height: 1px; }
  /* 파일은 펼침 화살표 자리가 비어 있어 아이콘이 멀리 있으므로 가로선을 아이콘 바로 앞까지 잇는다 */
  li.child.file::after { width: 19px; }
  .kids { position: relative; }

  /* 스크롤하면 펼친 폴더 이름이 위에 남는다. 위 단계 폴더 아래에 쌓이도록 단계 × 행 높이만큼 내려 붙인다 */
  .row.stick { position: sticky; top: calc(var(--d) * var(--row-h, 28px)); z-index: calc(20 - var(--d)); background: var(--stick-bg, var(--surface)); }
  .row.stick:hover, .row.stick:focus-within { background: var(--hover); }
  .label :global(mark) { background: color-mix(in srgb, var(--accent) 30%, transparent); color: inherit; border-radius: 2px; padding: 0; }
</style>
