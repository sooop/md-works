<script lang="ts">
  import { getContext } from 'svelte';
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
  import { isCollapsed, toggleFolder, expandFolder, treeUi, moveInOrder, setSort } from '../docTree.svelte';
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
  }
  let { node, depth = 0, filter = '', drag, siblings }: Props = $props();
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
  function onDragStart(e: DragEvent) {
    if (renaming) { e.preventDefault(); return; }
    drag.node = node;
    e.dataTransfer?.setData('text/plain', node.name);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  function onDragEnd() { drag.node = null; drag.hint = ''; dndUi.pos = ''; dndUi.indicate(null, ''); clearTimeout(hoverTimer); }
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
    else if (src.type === node.type) drag.hint = dest !== srcDir0 ? `${where}로 옮깁니다` : '';
    else if (dest !== srcDir0) drag.hint = `${where}로 옮깁니다`;
    else drag.hint = '글과 폴더는 서로 순서를 바꿀 수 없습니다(폴더가 먼저)';
    // 접힌 폴더 위에 잠깐 머물면 펼친다
    clearTimeout(hoverTimer);
    if (node.type === 'dir' && pos === 'into' && isCollapsed(node.path)) hoverTimer = setTimeout(() => expandFolder(node.path), 700);
  }
  function onDragLeave() { clearTimeout(hoverTimer); } // 표시는 목록을 벗어날 때(DocTree)·놓을 때 거둔다 — 행 사이를 지날 때 깜빡이지 않게
  async function onDrop(e: DragEvent) {
    const src = drag.node;
    const pos = dndUi.pos || posOf(e);
    onDragEnd();
    if (!src || src.path === node.path) return;
    e.preventDefault();
    e.stopPropagation();
    const into = pos === 'into';
    const dest = into ? node.path : parent;
    if (isSelfOrChild(src, dest)) return;
    const srcDir = src.dir ?? splitPath(src.path).folder;
    if (dest !== srcDir) await ctl.move(src, dest);
    // 같은 종류끼리 형제 사이에 끼워 넣는다(글·폴더 구분은 목록이 폴더를 먼저 두므로 종류가 다르면 순서를 건드리지 않는다).
    // 이름순·수정일순에서 놓았으면 그 자리의 순서를 기준으로 삼아 '직접 정렬'로 바꾼다
    if (!into && src.type === node.type) {
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

<li>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="row"
    class:active={node.type === 'file' && ctl.isActive(node)}
    class:selected={node.type === 'dir' && ctl.selectedDir() === node.path}
    class:dragging={drag.node?.path === node.path}
    style:padding-left="{8 + depth * 14}px"
    oncontextmenu={(e) => openContextMenu(e, menuItems)}
    draggable={!renaming}
    ondragstart={onDragStart}
    ondragend={onDragEnd}
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
      <div class="name" role="button" tabindex="0" ondblclick={() => (renaming = true)} onclick={() => ctl.open(node)} onkeydown={(e) => key(e, () => ctl.open(node))}
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
    <ul>
      {#each node.children as child (child.path)}
        <TreeNode node={child} depth={depth + 1} {filter} {drag} {siblings} />
      {/each}
    </ul>
  {/if}
</li>

<style>
  .row { position: relative; }
  .name { cursor: pointer; user-select: none; }
  .name:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 4px; }
  .row.dragging { opacity: 0.45; }
  .label :global(mark) { background: color-mix(in srgb, var(--accent) 30%, transparent); color: inherit; border-radius: 2px; padding: 0; }
</style>
