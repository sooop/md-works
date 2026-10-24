<script lang="ts">
  let wrapEl = $state<HTMLElement | null>(null);
  import { onMount } from 'svelte';
  import Editor from './Editor.svelte';
  import Lightbox from './Lightbox.svelte';
  import DocTree from './DocTree.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import { buildAppCommands, docCommands, type AppCommandCtx } from '../commands/appCommands';
  import RightToggle from './RightToggle.svelte';
  import type { TreeCtl } from './treeCtl.js';
  import DropOverlay from './DropOverlay.svelte';
  import PasteModal from './PasteModal.svelte';
  import MoreMenu from './MoreMenu.svelte';
  import BackupDialog from './BackupDialog.svelte';
  import { divertBundleDrop } from '../bundle/backupState.svelte';
  import { printDoc } from '../printCode';
  import HistoryPanel from './HistoryPanel.svelte';
  import ModeToggle from './ModeToggle.svelte';
  import DocTitle from './DocTitle.svelte';
  import PathBadges from './PathBadges.svelte';
  import { revealFolder } from '../docTree.svelte';
  import CommentLayer from './CommentLayer.svelte';
  import RightSidebar from './RightSidebar.svelte';
  import { closeRightOnMobile, leftSheet } from '../rightbar/state.svelte';
  import { untrack } from 'svelte';
  import Resizer from './Resizer.svelte';
  import Pin from '@lucide/svelte/icons/pin';
  import PinOff from '@lucide/svelte/icons/pin-off';
  import Settings from './Settings.svelte';
  import { tip } from '../tooltip.svelte';
  import { left, viewport, isDocked, toggleLeft, openLeft, closeLeft, togglePin, setLeftWidth, LEFT_W, rightPeek } from '../sidebar/state.svelte';
  import { edgeHover, peekPanel } from '../sidebar/peek';
  import { backupUi, isStale } from '../bundle/backupState.svelte';
  import SnippetShortcuts from './SnippetShortcuts.svelte';
  import FindBar from './FindBar.svelte';
  import StatusBar from './StatusBar.svelte';
  import SheetBackdrop from './SheetBackdrop.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
  import Save from '@lucide/svelte/icons/save';
  import { doc, settings } from '../store.svelte';
  import {
    tree, nav, templates, init, openDoc, save, onEditorChange, upload, resolveUrl, createDoc, createFolder,
    convertImages, createFromText, handleDrop, exportDocxCurrent, exportMdCurrent, copyMdCurrent, refreshTemplates, selectTemplate,
    restoreVersion, searchFiles, renameCurrent, renameNodeBy, removeNode, moveNode,
  } from '../server-mode.svelte';
  import { stripExt, dirname } from '../utils';
  import { ui, searchShortcut } from '../search/state.svelte';
  import { fmtDateTime } from '../utils';

  leftSheet.close = closeLeft;
  const docked = $derived(isDocked());
  let settingsOpen = $state(false);
  // 열린 문서가 없으면 목록을 보여 주고, 문서가 열리면 마우스가 목록 위에 있을 때만 남긴다(직접 글을 고른 경우). 시작할 때 마지막 글이 열리는 경우엔 닫는다
  $effect(() => {
    void doc.key;
    const has = !!doc.path;
    untrack(() => {
      if (viewport.mobile) return;
      if (!has) openLeft();
      else if (!document.querySelector('.left-sidebar:hover')) closeLeft();
    });
  });
  function closePeeks() { if (!viewport.mobile) { closeLeft(); rightPeek.open = false; } }
  let historyOpen = $state(false);
  let pasteOpen = $state(false);

  const templateOptions = $derived([
    { id: '', label: '기본 템플릿' },
    ...templates.files.map((f) => ({ id: f, label: f })),
  ]);
  const templateHint = $derived(
    templates.dir
      ? `템플릿 폴더: ${templates.dir}${templates.files.length ? '' : ' (.docx 파일을 넣으면 여기에 나타납니다)'}`
      : '',
  );

  // 명령 팔레트(Ctrl+K): 이 모드의 동작을 명령으로 잇는다
  const flatDocs = (nodes: { type: string; path: string; children?: unknown[] }[]): string[] =>
    nodes.flatMap((n) => (n.type === 'file' ? [n.path] : flatDocs((n.children ?? []) as never)));
  const paletteCtx: AppCommandCtx = {
    server: true,
    docs: () => flatDocs(tree.nodes).map((p) => ({ id: p, label: stripExt(p) })),
    openDoc: (id) => void openDoc(id),
    createDoc: () => void createDoc(nav.dir),
    createFolder: () => void createFolder(nav.dir),
    pasteDoc: () => { pasteOpen = true; },
    save: () => void save(),
    history: () => { historyOpen = true; },
    exportMd: exportMdCurrent,
    copyMd: copyMdCurrent,
    exportDocx: exportDocxCurrent,
    print: () => void printDoc(),
    images: (to) => void convertImages(to),
    settings: () => { settingsOpen = true; },
    backup: () => { backupUi.open = true; },
  };
  const paletteCommands = buildAppCommands(paletteCtx);

  const treeCtl: TreeCtl = {
    isActive: (n) => doc.path === n.path,
    isDirty: (n) => doc.path === n.path && doc.dirty,
    activePath: () => doc.path,
    activeDir: () => (doc.path ? dirname(doc.path) : ''),
    open: (n) => void openDoc(n.path),
    selectedDir: () => nav.dir,
    selectDir: (p) => { nav.dir = p; },
    createDoc: (dir) => void createDoc(dir),
    createFolder: (dir) => void createFolder(dir),
    rename: (n, input) => renameNodeBy(n, input),
    remove: (n) => removeNode(n),
    move: (n, dest) => moveNode(n, dest),
    tipLines: (n) => [n.path, ...(n.mtime ? [`수정 ${fmtDateTime(n.mtime)}`] : [])],
  };

  /** 제목 줄의 경로 배지를 눌렀을 때: 그 폴더를 고르고(새 문서가 만들어질 곳), 목록을 열어 그 위치를 보여 준다 */
  function pickCrumb(path: string) {
    nav.dir = path;
    ui.tab = 'files';
    openLeft();
    revealFolder(path);
  }

  onMount(() => { void init(); });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && left.open && !viewport.mobile && !e.defaultPrevented && (document.activeElement as HTMLElement | null)?.closest('.left-sidebar')) closeLeft();
    if (searchShortcut(e, !!doc.path) === 'global') openLeft();
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p' && doc.path) {
      e.preventDefault();
      void printDoc();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    }
  }
  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (doc.dirty) e.preventDefault();
  }
</script>

<svelte:window onkeydown={onKey} onbeforeunload={onBeforeUnload} />

<div class="shell">
  <SnippetShortcuts />
  <CommandPalette commands={() => paletteCommands} docCommands={() => docCommands(paletteCtx)} />
  {#if !docked && !left.open && !viewport.mobile}
    <div class="left-edge" data-side="left" use:edgeHover={openLeft}></div>
  {/if}
  {#if docked || left.open}
    <aside
      class="sidebar left-sidebar" class:peek={!docked} style:--left-w="{left.width}px"
      use:peekPanel={{ active: () => !docked && !viewport.mobile, close: closeLeft }}
    >
      <header>
        <button
          class="root-btn"
          class:selected={nav.dir === ''}
          use:tip={{ title: tree.root || 'Notes', lines: ['새 문서는 선택한 폴더에 만들어집니다'] }}
          onclick={() => (nav.dir = '')}
        >{tree.root || 'Notes'}</button>
        <span class="ops-head">
          <button class="icon-btn" use:tip={'새 문서'} aria-label="새 문서" onclick={() => createDoc(nav.dir)}><FilePlus size={17} /></button>
          <button class="icon-btn" use:tip={'새 폴더'} aria-label="새 폴더" onclick={() => createFolder(nav.dir)}><FolderPlus size={17} /></button>
          <button class="icon-btn" use:tip={'붙여넣어 새 문서 만들기'} aria-label="붙여넣어 새 문서 만들기" onclick={() => (pasteOpen = true)}><ClipboardPaste size={17} /></button>
        </span>
        {#if !viewport.mobile}
          <button class="icon-btn pin-btn" class:on={left.pinned} aria-pressed={left.pinned} aria-label={left.pinned ? '사이드바 고정 해제' : '사이드바 고정'}
            use:tip={left.pinned ? { title: '고정됨', lines: ['누르면 자동 숨김으로 바꿉니다'] } : { title: '본문 옆에 고정', lines: ['지금은 글을 쓰면 자동으로 숨고, 왼쪽 가장자리에 마우스를 대면 나타납니다'] }}
            onclick={togglePin}>{#if left.pinned}<Pin size={16} />{:else}<PinOff size={16} />{/if}</button>
        {/if}
      </header>
      <div class="sidetabs" role="tablist">
        <button role="tab" class:on={ui.tab === 'files'} aria-selected={ui.tab === 'files'} onclick={() => (ui.tab = 'files')}>파일</button>
        <button role="tab" class:on={ui.tab === 'search'} aria-selected={ui.tab === 'search'} onclick={() => { ui.tab = 'search'; ui.globalFocus++; }} use:tip={{ title: '모든 문서에서 검색', kbd: 'Ctrl+Shift+F' }}>검색</button>
      </div>
      <div class="tabpane" hidden={ui.tab !== 'files'}>
        <DocTree nodes={tree.nodes} ctl={treeCtl} bind:filter={nav.filter} emptyText="문서가 없습니다. 위의 새 문서 버튼으로 만들거나 .md · .txt · .docx · .html · .odt · .epub 등의 파일을 끌어다 놓으세요." />
      </div>
      <div class="tabpane" hidden={ui.tab !== 'search'}>
        <SearchPanel run={searchFiles} onOpen={openDoc} activeId={doc.path} />
      </div>
      {#if !viewport.mobile}
        <Resizer side="left" value={left.width} min={LEFT_W.min} max={LEFT_W.max} def={LEFT_W.def} label="왼쪽 사이드바 폭 조절" onchange={(w, save) => setLeftWidth(w, save)} />
      {/if}
    </aside>
  {/if}
  <SheetBackdrop open={left.open && viewport.mobile} onClose={closeLeft} />

  <main class="main">
    <div class="top-edge"></div>
    <header class="topbar">
      <button class="icon-btn" class:on={docked} aria-label="사이드바 토글" use:tip={{ title: '파일 목록', lines: [left.pinned ? '누르면 숨깁니다' : '누르면 본문 옆에 열립니다(고정). 왼쪽 가장자리에 마우스를 대도 잠깐 열립니다'] }} onclick={() => { toggleLeft(); if (left.open) closeRightOnMobile(); }}><PanelLeft size={18} /></button>
      {#if doc.path}<PathBadges folder={dirname(doc.path)} onPick={pickCrumb} />{/if}
      <DocTitle title={doc.path ? stripExt(doc.name) : '문서를 선택하세요'} editable={!!doc.path} dirty={doc.dirty} onRename={renameCurrent} />
      <span class="spacer"></span>
      {#if doc.path}
        <ModeToggle />
        <!-- 자동 저장이 켜져 있으면(기본) 저장 단추는 필요 없다. Ctrl+S 는 항상 된다 -->
        {#if !settings.autosave}
          <button class="icon-btn" class:attn={doc.dirty} disabled={!doc.dirty || doc.saving} aria-label="저장"
          use:tip={{ title: doc.saving ? '저장 중…' : doc.dirty ? '저장' : '저장됨', kbd: 'Ctrl+S' }} onclick={save}><Save size={18} /></button>
        {/if}
        <HistoryPanel docKey={doc.path} {resolveUrl} onRestore={restoreVersion} current={doc.content} bind:open={historyOpen} />
      {/if}
      <MoreMenu
          hasDoc={!!doc.path}
          onSettings={() => (settingsOpen = true)}
          onBackup={() => (backupUi.open = true)}
          backupStale={isStale()}
          onHistory={() => (historyOpen = true)}
          onImages={(to) => void convertImages(to)}
          onMd={exportMdCurrent}
          onCopyMd={copyMdCurrent}
          onDocx={exportDocxCurrent}
          onPrint={printDoc}
          options={templateOptions}
          selected={settings.template}
          onSelect={selectTemplate}
          onOpen={refreshTemplates}
          hint={templateHint}
        />
      <RightToggle />
      <BackupDialog server trigger={false} />
      <Settings server trigger={false} bind:open={settingsOpen} />
    </header>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <section class="editor-wrap" bind:this={wrapEl} onpointerdown={closePeeks}>
      <FindBar />
      {#if doc.path}
        {#key doc.key}
          <Editor initial={doc.content} onChange={onEditorChange} {upload} {resolveUrl} readonly={!doc.edit} />
        {/key}
        <CommentLayer />
      {:else}
        <div class="placeholder">왼쪽 목록에서 문서를 열거나 새로 만드세요.</div>
      {/if}
    </section>
    <StatusBar />
    <Lightbox root={wrapEl} readMode={!doc.edit} />
  </main>
  <RightSidebar />
</div>

<DropOverlay onDrop={async (items) => { const rest = await divertBundleDrop(items.map((d) => d.file)); if (rest.length) await handleDrop(rest); }} />
<PasteModal open={pasteOpen} onClose={() => (pasteOpen = false)} onCreate={createFromText} />
