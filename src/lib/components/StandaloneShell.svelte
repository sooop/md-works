<script lang="ts">
  let wrapEl = $state<HTMLElement | null>(null);
  import { onMount } from 'svelte';
  import Editor from './Editor.svelte';
  import Lightbox from './Lightbox.svelte';
  import DropOverlay from './DropOverlay.svelte';
  import PasteModal from './PasteModal.svelte';
  import MoreMenu from './MoreMenu.svelte';
  import { divertBundleDrop, startBackupScheduler } from '../bundle/backupState.svelte';
  import { lazyComponent } from '../lazy.svelte';
  import { printDoc } from '../printCode';
  import ModeToggle from './ModeToggle.svelte';
  import DocTitle from './DocTitle.svelte';
  import PathBadges from './PathBadges.svelte';
  import { revealFolder } from '../docTree.svelte';
  import CommentLayer from './CommentLayer.svelte';
  import RightSidebar from './RightSidebar.svelte';
  import { closeRightOnMobile, leftSheet, openRight } from '../rightbar/state.svelte';
  import { untrack } from 'svelte';
  import Resizer from './Resizer.svelte';
  import Pin from '@lucide/svelte/icons/pin';
  import PinOff from '@lucide/svelte/icons/pin-off';
  import { tip } from '../tooltip.svelte';
  import { openContextMenu } from '../contextmenu.svelte';
  import DocTree from './DocTree.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import { buildAppCommands, docCommands, type AppCommandCtx } from '../commands/appCommands';
  import RightToggle from './RightToggle.svelte';
  import { buildTree, splitPath } from '../docTree';
  import type { TreeCtl } from './treeCtl';
  import { left, viewport, isDocked, toggleLeft, openLeft, closeLeft, togglePin, setLeftWidth, LEFT_W, rightPeek } from '../sidebar/state.svelte';
  import { edgeHover, peekPanel } from '../sidebar/peek';
  import { backupUi, isStale } from '../bundle/backupState.svelte';
  import SnippetShortcuts from './SnippetShortcuts.svelte';
  import PanelShortcuts from './PanelShortcuts.svelte';
  import FindBar from './FindBar.svelte';
  import StatusBar from './StatusBar.svelte';
  import SheetBackdrop from './SheetBackdrop.svelte';
  import SaveFailBadge from './SaveFailBadge.svelte';
  import { panelFx } from '../motion';
  import SearchPanel from './SearchPanel.svelte';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Archive from '@lucide/svelte/icons/archive';
  import FileText from '@lucide/svelte/icons/file-text';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
  import { doc } from '../store.svelte';
  import {
    lib, docUpdatedAt, docFullPath, renameDocBy, renameFolder, removeFolder, moveFolder, moveDoc, createFolder, init, save, flush, exportMd, copyMd, exportAll, openPicker, openDoc, createDoc, removeDoc, onEditorChange,
    upload, resolveUrl, importFiles, createFromText, exportDocxCurrent, exportHtmlCurrent, exportEpubCurrent, tpl, pickTemplate, clearTemplate, restoreVersion, searchLibrary, replaceHost, renameCurrent, retrySave, hasUnsavedWork,
    trash, trashCtl, removeNodes, moveNodes, downloadNodes,
  } from '../standalone-mode.svelte';
  import TrashFooter from './TrashFooter.svelte';
  import { stripExt, fmtDateTime } from '../utils';
  import { ui, searchShortcut } from '../search/state.svelte';
  import { matchName } from '../search/nameMatch';

  leftSheet.close = closeLeft;
  const docked = $derived(isDocked());
  let settingsOpen = $state(false);
  // 문서가 열리면 마우스가 목록 위에 있을 때만 목록(팝오버)을 남긴다(직접 글을 고른 경우). 문서가 없을 때는 목록을 자동으로 띄우지 않는다:
  // 시작하는 동안 문서가 비어 있는 순간에 목록이 떴다가 마지막 글이 열리며 사라지는 깜빡임이 생기고, 빈 화면에 새 글·붙여넣기 단추가 있다
  $effect(() => {
    void doc.key;
    const has = !!doc.path;
    untrack(() => {
      if (viewport.mobile) return;
      if (has && !document.querySelector('.left-sidebar:hover')) closeLeft();
    });
  });
  function closePeeks() { if (!viewport.mobile) { closeLeft(); rightPeek.open = false; } }
  let historyOpen = $state(false);
  let pasteOpen = $state(false);
  let trashOpen = $state(false); // 파일 탭 자리에 휴지통 보기를 연다

  // 가끔 쓰는 화면은 처음 열 때 받는다. 열림 상태가 true 가 되는 즉시 받기 시작하고, 받은 뒤에는 계속 마운트해 닫힘 애니메이션을 유지한다.
  // 실패하면 토스트로 알리고 열림 상태를 되돌린다(lazyComponent)
  const backupDlg = lazyComponent(() => import('./BackupDialog.svelte'));
  const settingsDlg = lazyComponent(() => import('./Settings.svelte'));
  const historyDlg = lazyComponent(() => import('./HistoryPanel.svelte'));
  const trashView = lazyComponent(() => import('./TrashPanel.svelte'));
  $effect(() => { if (backupUi.open) backupDlg.load(() => (backupUi.open = false)); });
  $effect(() => { if (settingsOpen) settingsDlg.load(() => (settingsOpen = false)); });
  $effect(() => { if (historyOpen) historyDlg.load(() => (historyOpen = false)); });
  $effect(() => { if (trashOpen) trashView.load(() => (trashOpen = false)); });

  const templateOptions = $derived([
    { id: '', label: '기본 템플릿' },
    ...(tpl.name ? [{ id: 'custom', label: tpl.name }] : []),
  ]);

  const treeNodes = $derived(buildTree(lib.docs, lib.folders));
  const metaOf = (id: string) => lib.docs.find((d) => d.id === id);
  // 명령 팔레트(Ctrl+K): 이 모드의 동작을 명령으로 잇는다
  const paletteCtx: AppCommandCtx = {
    server: false,
    docs: () => lib.docs.map((d) => ({ id: d.id, label: stripExt(docFullPath(d.id) || d.name) })),
    openDoc: (id) => void openDoc(id),
    createDoc: () => void createDoc(lib.dir),
    createFolder: () => void createFolder(lib.dir),
    pasteDoc: () => { pasteOpen = true; },
    save: () => void save(),
    importFiles: openPicker,
    history: () => { historyOpen = true; },
    exportMd,
    copyMd,
    exportDocx: exportDocxCurrent,
    exportHtml: exportHtmlCurrent,
    exportEpub: exportEpubCurrent,
    print: () => void printDoc(),
    deleteDoc: () => { const m = metaOf(doc.path); if (m) void removeDoc(m); },
    settings: () => { settingsOpen = true; },
    backup: () => { backupUi.open = true; },
  };
  const paletteCommands = buildAppCommands(paletteCtx);

  const treeCtl: TreeCtl = {
    isActive: (n) => doc.path === n.path,
    isDirty: (n) => doc.path === n.path && doc.dirty,
    activePath: () => doc.path,
    activeDir: () => (doc.path ? splitPath(docFullPath(doc.path)).folder : ''),
    open: (n) => void openDoc(n.path),
    selectedDir: () => lib.dir,
    selectDir: (p) => { lib.dir = p; },
    createDoc: (dir) => void createDoc(dir),
    createFolder: (dir) => void createFolder(dir),
    rename: (n, input) => (n.type === 'dir' ? renameFolder(n.path, input) : renameDocBy(n.path, input)),
    remove: async (n) => { if (n.type === 'dir') await removeFolder(n.path); else { const m = metaOf(n.path); if (m) await removeDoc(m); } },
    move: (n, dest) => (n.type === 'dir' ? moveFolder(n.path, dest) : moveDoc(n.path, dest)),
    removeMany: (ns) => removeNodes(ns),
    moveMany: (ns, dest) => moveNodes(ns, dest),
    downloadMany: (ns, format) => downloadNodes(ns, format),
    tipLines: (n) => [docFullPath(n.path), ...(docUpdatedAt(n.path) ? [`수정 ${fmtDateTime(docUpdatedAt(n.path))}`] : [])],
  };

  /** 제목 줄의 경로 배지를 눌렀을 때: 그 폴더를 고르고(새 문서가 만들어질 곳), 목록을 열어 그 위치를 보여 준다 */
  function pickCrumb(path: string) {
    lib.dir = path;
    ui.tab = 'files';
    openLeft();
    revealFolder(path);
  }

  // 백업 스케줄러·알림은 대화상자 컴포넌트가 아니라 셸이 시작한다(대화상자는 처음 열 때 받으므로)
  onMount(() => { startBackupScheduler(); void init(); });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && left.open && !viewport.mobile && !e.defaultPrevented && (document.activeElement as HTMLElement | null)?.closest('.left-sidebar')) closeLeft();
    if (searchShortcut(e, !!doc.path) === 'global') openLeft();
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); void save(); }
    else if (k === 'o') { e.preventDefault(); openPicker(); }
    else if (k === 'p' && !e.shiftKey && !e.altKey && doc.path) { e.preventDefault(); void printDoc(); }
  }
  // 입력 후 디바운스 대기 중인 내용을 탭을 숨기거나 닫을 때 바로 기록한다
  function onHide() { void flush(); }
  // 저장 대기 중이거나 저장 중이거나 저장하지 못한 변경이 있는 채로 닫으면 사라질 수 있으므로 경고한다(머무르기로 하면 바로 기록해 둔다)
  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (doc.saveFailed || hasUnsavedWork()) { e.preventDefault(); void flush(); }
  }
</script>

<svelte:window onkeydown={onKey} onpagehide={onHide} onbeforeunload={onBeforeUnload} />
<svelte:document onvisibilitychange={() => { if (document.visibilityState === 'hidden') onHide(); }} />

<div class="shell">
  <SnippetShortcuts />
  <PanelShortcuts />
  <CommandPalette commands={() => paletteCommands} docCommands={() => docCommands(paletteCtx)} />
  {#if !docked && !left.open && !viewport.mobile}
    <div class="left-edge" data-side="left" use:edgeHover={openLeft}></div>
  {/if}
  {#if docked || left.open}
    <aside
      class="sidebar left-sidebar" class:peek={!docked} style:--left-w="{left.width}px" transition:panelFx={{ side: viewport.mobile ? 'bottom' : 'left' }}
      use:peekPanel={{ active: () => !docked && !viewport.mobile, close: closeLeft }}
    >
      <header>
        <button class="root-btn" class:selected={lib.dir === ''} use:tip={{ title: 'Notes', lines: ['이 브라우저에 보관된 문서', '새 문서는 선택한 폴더에 만들어집니다'] }} onclick={() => (lib.dir = '')}>Notes</button>
        <span class="ops-head">
          <button class="icon-btn" use:tip={'새 문서'} aria-label="새 문서" onclick={() => createDoc(lib.dir)}><FilePlus size={17} /></button>
          <button class="icon-btn" use:tip={'새 폴더'} aria-label="새 폴더" onclick={() => createFolder(lib.dir)}><FolderPlus size={17} /></button>
          <button class="icon-btn" use:tip={'붙여넣어 새 문서 만들기'} aria-label="붙여넣어 새 문서 만들기" onclick={() => (pasteOpen = true)}><ClipboardPaste size={17} /></button>
          <button class="icon-btn" use:tip={'파일 가져오기 (Ctrl+O)'} aria-label="파일 가져오기" onclick={openPicker}><FolderOpen size={17} /></button>
          <button class="icon-btn" use:tip={'모든 문서를 zip 으로 내보내기 (백업)'} aria-label="모든 문서 내보내기" onclick={exportAll}><Archive size={17} /></button>
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
        {#if trashOpen && trashView.Comp}
          {@const Trash = trashView.Comp}
          <Trash ctl={trashCtl} onBack={() => (trashOpen = false)} />
        {:else}
          <DocTree nodes={treeNodes} ctl={treeCtl} bind:filter={lib.filter} emptyText="문서가 없습니다. 위의 새 문서 버튼으로 만들거나 .md · .txt · .docx · .html · .odt · .epub 등 · 백업 .zip 파일을 끌어다 놓으세요. 문서는 이 브라우저에 보관됩니다." />
          <TrashFooter count={trash.count} onOpen={() => (trashOpen = true)} />
        {/if}
      </div>
      <div class="tabpane" hidden={ui.tab !== 'search'}>
        <SearchPanel run={searchLibrary} onOpen={openDoc} activeId={doc.path} {replaceHost} />
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
      {#if doc.path}<PathBadges folder={splitPath(docFullPath(doc.path)).folder} onPick={pickCrumb} />{/if}
      <DocTitle title={doc.path ? stripExt(doc.name) : '문서를 선택하세요'} editable={!!doc.path} onRename={renameCurrent} />
      <span class="spacer"></span>
      <SaveFailBadge onRetry={() => void retrySave()} />
      {#if doc.path}
        <ModeToggle />
        {#if historyDlg.Comp}{@const History = historyDlg.Comp}<History docKey={doc.path} {resolveUrl} onRestore={restoreVersion} current={doc.content} bind:open={historyOpen} />{/if}
      {/if}
      <MoreMenu
          hasDoc={!!doc.path}
          onSettings={() => (settingsOpen = true)}
          onBackup={() => (backupUi.open = true)}
          backupStale={isStale()}
          onHistory={() => (historyOpen = true)}
          onMd={exportMd}
          onCopyMd={copyMd}
          onDocx={exportDocxCurrent}
          onHtml={exportHtmlCurrent}
          onEpub={exportEpubCurrent}
          onPrint={printDoc}
          onDelete={() => { const m = metaOf(doc.path); if (m) void removeDoc(m); }}
          options={templateOptions}
          selected={tpl.name ? 'custom' : ''}
          onSelect={(id) => { if (id === '') void clearTemplate(); }}
          actions={[{ label: '템플릿 .docx 파일 선택…', run: pickTemplate }]}
          hint="템플릿은 이 브라우저에 보관됩니다. 첫 docx 사용 때 pandoc 엔진(약 16MB)을 내려받습니다."
        />
      <RightToggle />
      {#if backupDlg.Comp}{@const Backup = backupDlg.Comp}<Backup trigger={false} />{/if}
      {#if settingsDlg.Comp}{@const SettingsDlg = settingsDlg.Comp}<SettingsDlg trigger={false} bind:open={settingsOpen} />{/if}
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
        <div class="placeholder">
          <div class="empty-start">
            <p>열려 있는 문서가 없습니다.</p>
            <div class="empty-actions">
              <button class="primary" onclick={() => createDoc(lib.dir)}><FilePlus size={16} /> 새 글 쓰기</button>
              <button onclick={() => (pasteOpen = true)}><ClipboardPaste size={16} /> 붙여넣기</button>
              {#if viewport.mobile}<button onclick={() => openRight('snippets')}><PanelRight size={16} /> 글감 열기</button>{/if}
            </div>
          </div>
        </div>
      {/if}
    </section>
    <StatusBar />
    <Lightbox root={wrapEl} readMode={!doc.edit} />
  </main>
  <RightSidebar />
</div>

<DropOverlay onDrop={async (items) => { const rest = await divertBundleDrop(items.map((d) => d.file)); if (rest.length) await importFiles(rest); }} />
<PasteModal open={pasteOpen} onClose={() => (pasteOpen = false)} onCreate={createFromText} />
