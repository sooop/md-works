<script lang="ts">
  let wrapEl = $state<HTMLElement | null>(null);
  import { onMount } from 'svelte';
  import Editor from './Editor.svelte';
  import Lightbox from './Lightbox.svelte';
  import TreeNode from './TreeNode.svelte';
  import Settings from './Settings.svelte';
  import DropOverlay from './DropOverlay.svelte';
  import PasteModal from './PasteModal.svelte';
  import MoreMenu from './MoreMenu.svelte';
  import { printDoc } from '../printCode';
  import HistoryPanel from './HistoryPanel.svelte';
  import ModeToggle from './ModeToggle.svelte';
  import DocTitle from './DocTitle.svelte';
  import CommentsPanel from './CommentsPanel.svelte';
  import CommentLayer from './CommentLayer.svelte';
  import { openCount } from '../comments/store.svelte';
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
    restoreVersion, searchFiles, renameCurrent,
  } from '../server-mode.svelte';
  import { stripExt } from '../utils';
  import { ui, searchShortcut } from '../search/state.svelte';
  import { filterTree } from '../search/nameMatch';

  let sidebarOpen = $state(true);
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

  const visibleNodes = $derived(nav.filter.trim() ? filterTree(tree.nodes, nav.filter) : tree.nodes);

  onMount(() => { void init(); });

  function onKey(e: KeyboardEvent) {
    if (searchShortcut(e, !!doc.path) === 'global') sidebarOpen = true;
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
<svelte:head>
  <title>{doc.dirty ? '● ' : ''}{doc.path ? stripExt(doc.name) : 'Notes'}</title>
</svelte:head>

<div class="shell">
  {#if sidebarOpen}
    <aside class="sidebar">
      <header>
        <button
          class="root-btn"
          class:selected={nav.dir === ''}
          title={`${tree.root} (새 문서는 선택한 폴더에 만들어집니다)`}
          onclick={() => (nav.dir = '')}
        >{tree.root || 'Notes'}</button>
        <span class="ops-head">
          <button class="icon-btn" title="새 문서" aria-label="새 문서" onclick={() => createDoc(nav.dir)}><FilePlus size={17} /></button>
          <button class="icon-btn" title="새 폴더" aria-label="새 폴더" onclick={() => createFolder(nav.dir)}><FolderPlus size={17} /></button>
          <button class="icon-btn" title="붙여넣어 새 문서 만들기" aria-label="붙여넣어 새 문서 만들기" onclick={() => (pasteOpen = true)}><ClipboardPaste size={17} /></button>
        </span>
      </header>
      <div class="sidetabs" role="tablist">
        <button role="tab" class:on={ui.tab === 'files'} aria-selected={ui.tab === 'files'} onclick={() => (ui.tab = 'files')}>파일</button>
        <button role="tab" class:on={ui.tab === 'search'} aria-selected={ui.tab === 'search'} onclick={() => { ui.tab = 'search'; ui.globalFocus++; }} title="모든 문서에서 검색 (Ctrl+Shift+F)">검색</button>
        <button role="tab" class:on={ui.tab === 'comments'} aria-selected={ui.tab === 'comments'} onclick={() => (ui.tab = 'comments')} title="이 문서의 코멘트">코멘트{#if openCount()} <span class="cm-badge">{openCount()}</span>{/if}</button>
      </div>
      <div class="tabpane" hidden={ui.tab !== 'files'}>
        <div class="filterbox">
          <Search size={14} />
          <input bind:value={nav.filter} placeholder="파일 이름 검색 (초성 가능)" aria-label="파일 이름 검색" spellcheck="false" />
          {#if nav.filter}<button class="icon-btn" title="지우기" aria-label="검색어 지우기" onclick={() => (nav.filter = '')}><X size={14} /></button>{/if}
        </div>
        <nav class="tree">
          {#if visibleNodes.length}
            <ul>
              {#each visibleNodes as node (node.path)}
                <TreeNode {node} />
              {/each}
            </ul>
          {:else if nav.filter.trim()}
            <p class="empty">'{nav.filter}' 와 일치하는 파일이 없습니다.</p>
          {:else}
            <p class="empty">문서가 없습니다. 위의 새 문서 버튼으로 만들거나 .md · .txt · .docx 파일을 끌어다 놓으세요.</p>
          {/if}
        </nav>
      </div>
      <div class="tabpane" hidden={ui.tab !== 'search'}>
        <SearchPanel run={searchFiles} onOpen={openDoc} activeId={doc.path} />
      </div>
      <div class="tabpane" hidden={ui.tab !== 'comments'}>
        <CommentsPanel />
      </div>
    </aside>
  {/if}
  <SheetBackdrop open={sidebarOpen} onClose={() => (sidebarOpen = false)} />

  <main class="main">
    <header class="topbar">
      <button class="icon-btn" aria-label="사이드바 토글" onclick={() => (sidebarOpen = !sidebarOpen)}><PanelLeft size={18} /></button>
      <DocTitle title={doc.path ? stripExt(doc.name) : '문서를 선택하세요'} editable={!!doc.path} dirty={doc.dirty} onRename={renameCurrent} />
      <span class="spacer"></span>
      {#if doc.path}
        <ModeToggle />
        <HistoryPanel docKey={doc.path} {resolveUrl} onRestore={restoreVersion} bind:open={historyOpen} />
        <MoreMenu
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
        <button class="primary" disabled={!doc.dirty || doc.saving} onclick={save}>
          <Save size={15} />{doc.saving ? '저장 중…' : '저장'}
        </button>
      {/if}
      <Settings server />
    </header>

    <section class="editor-wrap" bind:this={wrapEl}>
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
</div>

<DropOverlay onDrop={(items) => handleDrop(items.map((d) => d.file))} />
<PasteModal open={pasteOpen} onClose={() => (pasteOpen = false)} onCreate={createFromText} />
