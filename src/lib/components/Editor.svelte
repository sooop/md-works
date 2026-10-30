<script lang="ts">
  import { untrack } from 'svelte';
  import { CrepeBuilder } from '@milkdown/crepe/builder';
  import { blockEdit } from '@milkdown/crepe/feature/block-edit';
  import { codeMirror } from '@milkdown/crepe/feature/code-mirror';
  import { cursor } from '@milkdown/crepe/feature/cursor';
  import { imageBlock } from '@milkdown/crepe/feature/image-block';
  import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip';
  import { latex } from '@milkdown/crepe/feature/latex';
  import { listItem } from '@milkdown/crepe/feature/list-item';
  import { placeholder } from '@milkdown/crepe/feature/placeholder';
  import { table } from '@milkdown/crepe/feature/table';
  import { toolbar } from '@milkdown/crepe/feature/toolbar';
  import { editorViewCtx, commandsCtx, serializerCtx } from '@milkdown/kit/core';
  import { callCommand } from '@milkdown/kit/utils';
  import {
    clearTextInCurrentBlockCommand, toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand, wrapInHeadingCommand, wrapInBlockquoteCommand,
    wrapInBulletListCommand, wrapInOrderedListCommand, createCodeBlockCommand, insertHrCommand, turnIntoTextCommand,
  } from '@milkdown/kit/preset/commonmark';
  import { toggleStrikethroughCommand, insertTableCommand } from '@milkdown/kit/preset/gfm';
  import { editorBridge, doc, settings, toast, askChoose, focusNext, type EditorCommand } from '../store.svelte';
  import { stripExt } from '../utils';
  import { tableHeaderless } from '../tableHeaderless';
  import { codeClipboard } from '../codeClipboard';
  import { tablePaste,attachTableTools, insertGridAtCursor, insertCodeAtCursor, codeSourceAt, selectionSourceAt, type CodeSource, type TableData } from '../tableTools';
  import { tableViewer } from '../tableViewer.svelte';
  import { openListImport, openListExport } from '../tableListUi.svelte';
  import { attachFinder } from '../search/pmSearch';
  import { bindComments } from '../comments/store.svelte';
  import { finder } from '../search/state.svelte';
  import { codeLanguages, codeHighlight } from '../codeLanguages';
  import { onlyDoubleTilde } from '../gfmTilde';
  import { attachCodePicker } from '../codePicker';
  import { footnotes, insertFootnote, normalizeNow, attachFootnoteTips } from '../footnotes';
  import { trimSelectionSpaces } from '../inlineCode';
  import { notionHeading, notionHeadingBackspace } from '../headingNotion';
  import { buildPrintClone } from '../printCode';
  import { flashAfter } from '../flashDoc';
  import { splitFrontmatter, joinFrontmatter, frontInner, frontOuter } from '../frontmatter';

  interface Props {
    initial: string;
    onChange: (md: string) => void;
    upload: (file: File) => Promise<string>;
    resolveUrl: (src: string) => string | Promise<string>;
    readonly?: boolean; // 읽기 모드 (바뀌면 에디터를 다시 만들지 않고 편집 가능 여부만 바꾼다)
    preview?: boolean; // 이력 미리보기: 문서 내 검색·코멘트에 연결하지 않는다
  }
  let { initial, onChange, upload, resolveUrl, readonly = false, preview = false }: Props = $props();

  // frontmatter 는 에디터 밖에서 원문으로 들고 있다가 내보낼 때 앞에 붙인다
  const split = untrack(() => splitFrontmatter(initial));
  let front = $state(split.front);
  let frontOpen = $state(false);
  const emit = (body: string) => joinFrontmatter(front, body);
  function editFront(e: Event) {
    front = frontOuter((e.currentTarget as HTMLTextAreaElement).value);
    onChange(emit(builder?.getMarkdown() ?? ''));
  }

  // Ctrl+E(인라인 코드): 에디터보다 먼저 받아 선택 영역 앞뒤 공백을 뺀 뒤 넘긴다
  function attachCodeTrim(view: import('@milkdown/kit/prose/view').EditorView) {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e' && view.editable) trimSelectionSpaces(view);
    };
    view.dom.addEventListener('keydown', onKey, true);
    return () => view.dom.removeEventListener('keydown', onKey, true);
  }
  // lucide 'list-tree' 아이콘 윤곽(Crepe 메뉴 아이콘은 SVG 문자열)
  const LIST_TABLE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5h13"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/></svg>';

  let host: HTMLDivElement;
  let builder: CrepeBuilder | undefined;
  let ready = $state(false);

  $effect(() => {
    const ro = readonly;
    if (ready) builder?.setReadonly(ro);
  });

  // 문서가 바뀌면 부모가 {#key} 로 이 컴포넌트를 새로 만든다. 여기서는 한 번만 생성한다.
  $effect(() => {
    let crepe: CrepeBuilder | undefined;
    let ctl: ReturnType<typeof attachFinder> | undefined;
    let unbind: (() => void) | undefined;
    let unbindTable: (() => void) | undefined;
    let unbindCode: (() => void) | undefined;
    let unbindPicker: (() => void) | undefined;
    let unbindTips: (() => void) | undefined;
    let disposed = false;
    untrack(() => {
      const c = new CrepeBuilder({ root: host, defaultValue: split.body })
        .addFeature(cursor)
        .addFeature(listItem)
        .addFeature(linkTooltip)
        .addFeature(blockEdit, {
          // '/' 메뉴는 이름에 포함된 글자로만 걸러지므로, 한글로도 찾도록 이름 뒤에 한글을 붙인다(아이콘은 기본값 유지)
          textGroup: {
            text: { label: 'Text · 텍스트(본문)' },
            h1: { label: 'Heading 1 · 제목 1' }, h2: { label: 'Heading 2 · 제목 2' }, h3: { label: 'Heading 3 · 제목 3' },
            h4: { label: 'Heading 4 · 제목 4' }, h5: { label: 'Heading 5 · 제목 5' }, h6: { label: 'Heading 6 · 제목 6' },
            quote: { label: 'Quote · 인용' }, divider: { label: 'Divider · 구분선' },
          },
          listGroup: {
            bulletList: { label: 'Bullet List · 글머리 목록' }, orderedList: { label: 'Ordered List · 번호 목록' }, taskList: { label: 'Task List · 할 일(체크리스트)' },
          },
          advancedGroup: {
            image: { label: 'Image · 이미지(사진)' }, codeBlock: { label: 'Code · 코드 블록' }, table: { label: 'Table · 표(테이블)' }, math: { label: 'Math · 수식' },
          },
          // '/' 메뉴: Table 바로 아래에 '목록·표 텍스트에서 표 만들기'(JSON·YAML·마크다운 목록·CSV 등)
          buildMenu: (b) => b.getGroup('advanced').addItem('table-from-list', {
            label: 'Table from list · 목록에서 표 만들기',
            icon: LIST_TABLE_ICON,
            onRun: (ctx) => {
              ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key); // 입력한 '/…' 글자를 지운다
              openListImport();
            },
          }),
        })
        .addFeature(toolbar, {
          // 선택한 블록(목록·`| a | b |` 줄 등)을 표로 변환
          buildToolbar: (b) => b.addGroup('table-from-selection', 'Table').addItem('selection-table', {
            icon: LIST_TABLE_ICON,
            label: '선택 영역을 표로 변환',
            active: () => false,
            onRun: (ctx) => {
              const src = selectionSourceAt(ctx.get(editorViewCtx), ctx.get(serializerCtx));
              if (src) openListImport(src);
              else toast('코드 블록·표를 뺀 본문을 선택하세요');
            },
          }),
        })
        .addFeature(codeMirror, { languages: codeLanguages, theme: codeHighlight })
        .addFeature(table)
        .addFeature(latex) // $수식$ · $$블록 수식$$ (KaTeX)
        .addFeature(placeholder, { text: '내용을 입력하세요. / 를 누르면 블록 메뉴가 열립니다.' })
        .addFeature(imageBlock, {
          onUpload: upload,
          blockOnUpload: upload,
          inlineOnUpload: upload,
          proxyDomURL: resolveUrl,
        });
      const tableEnv = { toast, askChoose, docName: () => stripExt(doc.name), openViewer: (t: TableData) => { tableViewer.table = t; }, defaultFmt: () => (settings.tableCopyFormat === 'csv' ? 'csv' as const : 'tsv' as const), openExport: openListExport, openFromCode: (src: CodeSource) => openListImport(src), selectionSource: () => editorBridge.selectionSource?.() ?? null };
      c.editor.use(tablePaste(tableEnv)); // TSV/CSV 붙여넣기 → 표
      c.editor.use(codeClipboard); // 코드 블록 복사는 ``` 언어명 펜스 마크다운으로
      c.editor.use(tableHeaderless); // 모든 셀이 빈 헤더 행은 얇게 접어 헤더 없는 표처럼 보이게
      onlyDoubleTilde(c.editor); // 취소선은 ~~A~~ 만 인식하고 글자 그대로의 ~ 는 보존한다
      footnotes(c.editor); // 각주: 정의는 문서 끝에 모으고 등장 순서로 번호
      notionHeading(c.editor); // 제목: ## 입력은 level 설정, 맨 앞 Backspace 는 문단으로
      if (readonly) c.setReadonly(true);
      c.on((l) => l.markdownUpdated((_ctx, md, prev) => { if (md !== prev) onChange(emit(md)); }));
      c.create().then(() => {
        if (disposed) void c.destroy();
        else {
          crepe = c;
          notionHeadingBackspace(c.editor);
          if (!readonly) normalizeNow(c.editor.action((ctx) => ctx.get(editorViewCtx)));
          builder = c;
          ready = true;
          unbindTable = attachTableTools(c.editor.action((ctx) => ctx.get(editorViewCtx)), tableEnv); // 표 → TSV/CSV 복사·저장
          unbindPicker = attachCodePicker(host);
          unbindTips = attachFootnoteTips(c.editor.action((ctx) => ctx.get(editorViewCtx)));
          unbindCode = attachCodeTrim(c.editor.action((ctx) => ctx.get(editorViewCtx)));
          if (!preview) {
            editorBridge.getMarkdown = () => emit(c.getMarkdown());
            const pv = c.editor.action((ctx) => ctx.get(editorViewCtx));
            editorBridge.preparePrint = () => buildPrintClone(pv, host);
            // 문서 내 검색·코멘트: 열린 문서의 에디터만 연결한다
            const view = c.editor.action((ctx) => ctx.get(editorViewCtx));
            ctl = attachFinder(view, (st) => Object.assign(finder, st));
            finder.ctlPath = doc.path;
            finder.ctl = ctl;
            unbind = bindComments(view, doc.path);
            editorBridge.focus = () => { if (!readonly) view.focus(); };
            // 명령 팔레트의 서식 명령. 읽기 모드에서는 문서를 바꾸지 않는다
            const run = (key: never, payload?: unknown) => c.editor.action(callCommand(key, payload as never));
            const table: Record<EditorCommand, () => void> = {
              bold: () => run(toggleStrongCommand.key as never), italic: () => run(toggleEmphasisCommand.key as never),
              code: () => { trimSelectionSpaces(view); run(toggleInlineCodeCommand.key as never); }, strike: () => run(toggleStrikethroughCommand.key as never),
              h1: () => run(wrapInHeadingCommand.key as never, 1), h2: () => run(wrapInHeadingCommand.key as never, 2), h3: () => run(wrapInHeadingCommand.key as never, 3),
              paragraph: () => run(turnIntoTextCommand.key as never), quote: () => run(wrapInBlockquoteCommand.key as never),
              bullet: () => run(wrapInBulletListCommand.key as never), ordered: () => run(wrapInOrderedListCommand.key as never),
              codeblock: () => flashAfter(view, () => run(createCodeBlockCommand.key as never), 'insert'), hr: () => flashAfter(view, () => run(insertHrCommand.key as never), 'insert'),
              table: () => flashAfter(view, () => run(insertTableCommand.key as never, { row: 3, col: 3 }), 'insert'),
              footnote: () => { insertFootnote(view); },
            };
            editorBridge.command = (name) => { if (readonly) { toast('읽기 모드에서는 서식을 바꿀 수 없습니다'); return; } view.focus(); table[name](); };
            // 표·목록 변환 창이 만든 결과를 커서 위치에 넣는다
            const insertable = () => { if (readonly) { toast('읽기 모드에서는 문서를 바꿀 수 없습니다', 'error'); return false; } return true; };
            editorBridge.insertTable = (rows) => { if (!insertable()) return false; insertGridAtCursor(view, rows); return true; };
            editorBridge.insertCode = (lang, text) => { if (!insertable()) return false; insertCodeAtCursor(view, lang, text); return true; };
            editorBridge.codeSource = () => codeSourceAt(view, view.state.selection.from);
            editorBridge.selectionSource = () => c.editor.action((ctx) => selectionSourceAt(view, ctx.get(serializerCtx)));
            if (focusNext.on) { focusNext.on = false; editorBridge.focus(); } // 새로 만든 글: 바로 타이핑할 수 있게
          }
        }
      });
    });
    return () => {
      disposed = true;
      ready = false;
      builder = undefined;
      if (!preview) { editorBridge.focus = null; editorBridge.command = null; editorBridge.insertTable = null; editorBridge.insertCode = null; editorBridge.codeSource = null; editorBridge.selectionSource = null; }
      unbind?.();
      unbindTable?.();
      unbindCode?.();
      unbindPicker?.();
      unbindTips?.();
      if (ctl) {
        ctl.destroy();
        if (finder.ctl === ctl) { finder.ctl = null; finder.total = 0; finder.current = -1; finder.error = ''; }
      }
      void crepe?.destroy();
    };
  });
</script>

{#if front}
  <details class="frontmatter" bind:open={frontOpen}>
    <summary>Frontmatter</summary>
    <textarea
      value={frontInner(front)}
      readonly={readonly}
      spellcheck="false"
      rows={Math.min(20, frontInner(front).split(/\r?\n/).length + 1)}
      onchange={editFront}
    ></textarea>
  </details>
{/if}
<div class="editor-host" class:is-readonly={readonly} bind:this={host}></div>

<style>
  .frontmatter { max-width: var(--editor-width, 980px); margin: 0 auto; padding: 24px 48px 0; box-sizing: content-box; }
  .frontmatter summary { cursor: pointer; font-size: 12px; color: var(--muted); user-select: none; }
  .frontmatter textarea {
    display: block; width: 100%; margin-top: 8px; box-sizing: border-box; resize: vertical;
    font-family: var(--font-code); font-size: 13px; line-height: 1.55; padding: 8px 12px;
    background: var(--surface); color: var(--text); border: 1px solid var(--border-strong); border-radius: 8px;
  }
</style>
