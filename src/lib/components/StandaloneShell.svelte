<script lang="ts">
  let wrapEl = $state<HTMLElement | null>(null);
  import { onMount } from 'svelte';
  import Editor from './Editor.svelte';
  import Lightbox from './Lightbox.svelte';
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
  import SearchPanel from './SearchPanel.svelte';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Archive from '@lucide/svelte/icons/archive';
  import FileText from '@lucide/svelte/icons/file-text';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
  import { doc } from '../store.svelte';
  import {
    lib, init, save, flush, exportMd, copyMd, exportAll, openPicker, openDoc, createDoc, renameDoc, removeDoc, onEditorChange,
    upload, resolveUrl, importFiles, createFromText, exportDocxCurrent, tpl, pickTemplate, clearTemplate, restoreVersion, searchLibrary, renameCurrent,
  } from '../standalone-mode.svelte';
  import { stripExt } from '../utils';
  import { ui, searchShortcut } from '../search/state.svelte';
  import { matchName } from '../search/nameMatch';

  let pasteOpen = $state(false);
  let sidebarOpen = $state(true);
  let historyOpen = $state(false);

  const templateOptions = $derived([
    { id: '', label: '기본 템플릿' },
    ...(tpl.name ? [{ id: 'custom', label: tpl.name }] : []),
  ]);

  const visibleDocs = $derived(lib.filter.trim() ? lib.docs.filter((d) => matchName(stripExt(d.name), lib.filter)) : lib.docs);

  onMount(() => { void init(); });

  function onKey(e: KeyboardEvent) {
    if (searchShortcut(e, !!doc.path) === 'global') sidebarOpen = true;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); void save(); }
    else if (k === 'o') { e.preventDefault(); openPicker(); }
    else if (k === 'p' && !e.shiftKey && !e.altKey && doc.path) { e.preventDefault(); void printDoc(); }
  }
  // 입력 후 디바운스 대기 중인 내용을 탭을 숨기거나 닫을 때 바로 기록한다
  function onHide() { void flush(); }
</script>

<svelte:window onkeydown={onKey} onpagehide={onHide} />
<svelte:document onvisibilitychange={() => { if (document.visibilityState === 'hidden') onHide(); }} />
<svelte:head>
  <title>{doc.path ? stripExt(doc.name) : 'Notes'}</title>
</svelte:head>

<div class="shell">
  {#if sidebarOpen}
    <aside class="sidebar">
      <header>
        <span class="root-btn" title="이 브라우저에 보관된 문서">Notes</span>
        <span class="ops-head">
          <button class="icon-btn" title="새 문서" aria-label="새 문서" onclick={createDoc}><FilePlus size={17} /></button>
          <button class="icon-btn" title="붙여넣어 새 문서 만들기" aria-label="붙여넣어 새 문서 만들기" onclick={() => (pasteOpen = true)}><ClipboardPaste size={17} /></button>
          <button class="icon-btn" title="파일 가져오기 (Ctrl+O)" aria-label="파일 가져오기" onclick={openPicker}><FolderOpen size={17} /></button>
          <button class="icon-btn" title="모든 문서를 zip 으로 내보내기 (백업)" aria-label="모든 문서 내보내기" onclick={exportAll}><Archive size={17} /></button>
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
          <input bind:value={lib.filter} placeholder="파일 이름 검색 (초성 가능)" aria-label="파일 이름 검색" spellcheck="false" />
          {#if lib.filter}<button class="icon-btn" title="지우기" aria-label="검색어 지우기" onclick={() => (lib.filter = '')}><X size={14} /></button>{/if}
        </div>
        <nav class="tree">
          {#if visibleDocs.length}
            <ul>
              {#each visibleDocs as d (d.id)}
                <li>
                  <div class="row" class:active={doc.path === d.id} style:padding-left="8px">
                    <button class="name" onclick={() => openDoc(d.id)}>
                      <span class="twisty"></span>
                      <FileText size={15} class="ico" />
                      <span class="label">{stripExt(d.name)}</span>
                    </button>
                    <span class="ops">
                      <button title="이름 변경" aria-label="이름 변경" onclick={() => renameDoc(d)}><Pencil size={14} /></button>
                      <button title="삭제" aria-label="삭제" onclick={() => removeDoc(d)}><Trash2 size={14} /></button>
                    </span>
                  </div>
                </li>
              {/each}
            </ul>
          {:else if lib.filter.trim()}
            <p class="empty">'{lib.filter}' 와 일치하는 문서가 없습니다.</p>
          {:else}
            <p class="empty">문서가 없습니다. 위의 새 문서 버튼으로 만들거나 .md · .txt · .docx · 백업 .zip 파일을 끌어다 놓으세요. 문서는 이 브라우저에 보관됩니다.</p>
          {/if}
        </nav>
      </div>
      <div class="tabpane" hidden={ui.tab !== 'search'}>
        <SearchPanel run={searchLibrary} onOpen={openDoc} activeId={doc.path} />
      </div>
      <div class="tabpane" hidden={ui.tab !== 'comments'}>
        <CommentsPanel />
      </div>
    </aside>
  {/if}

  <main class="main">
    <header class="topbar">
      <button class="icon-btn" aria-label="사이드바 토글" onclick={() => (sidebarOpen = !sidebarOpen)}><PanelLeft size={18} /></button>
      <DocTitle title={doc.path ? stripExt(doc.name) : '문서를 선택하세요'} editable={!!doc.path} onRename={renameCurrent} />
      <span class="spacer"></span>
      {#if doc.path}
        <ModeToggle />
        <HistoryPanel docKey={doc.path} {resolveUrl} onRestore={restoreVersion} current={doc.content} bind:open={historyOpen} />
        <MoreMenu
          onHistory={() => (historyOpen = true)}
          onMd={exportMd}
          onCopyMd={copyMd}
          onDocx={exportDocxCurrent}
          onPrint={printDoc}
          options={templateOptions}
          selected={tpl.name ? 'custom' : ''}
          onSelect={(id) => { if (id === '') void clearTemplate(); }}
          actions={[{ label: '템플릿 .docx 파일 선택…', run: pickTemplate }]}
          hint="템플릿은 이 브라우저에 보관됩니다. 첫 docx 사용 때 pandoc 엔진(약 16MB)을 내려받습니다."
        />
      {/if}
      <Settings />
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
    <Lightbox root={wrapEl} readMode={!doc.edit} />
  </main>
</div>

<DropOverlay onDrop={(items) => importFiles(items.map((d) => d.file))} />
<PasteModal open={pasteOpen} onClose={() => (pasteOpen = false)} onCreate={createFromText} />
