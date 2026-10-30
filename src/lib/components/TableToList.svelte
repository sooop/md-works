<script lang="ts">
  import { backdropFx, modalFx } from '../motion';
  // 표를 JSON·YAML·마크다운 목록으로 바꿔 미리 보고, 복사·파일 저장·문서에 코드 블록으로 넣는 창.
  // 편집기의 표 메뉴(⋯·우클릭)와 표 확대 보기의 복사 메뉴에서 열린다.
  import Switch from './Switch.svelte';
  import { exportListText, type ListExportFormat } from '../tableList';
  import { listExport } from '../tableListUi.svelte';
  import { doc, editorBridge, toast } from '../store.svelte';
  import { downloadBlob, stripExt, writeClipboard } from '../utils';

  const FORMATS: { v: 'json' | 'yaml' | 'md'; l: string }[] = [
    { v: 'json', l: 'JSON' }, { v: 'yaml', l: 'YAML' }, { v: 'md', l: '마크다운 목록' },
  ];
  const MD_STYLES: { v: ListExportFormat; l: string; d: string }[] = [
    { v: 'md-record', l: '레코드', d: '행마다 "- 열: 값" 묶음 — 어떤 형식으로든 되돌리기 쉬움' },
    { v: 'md-tree', l: '계층', d: '왼쪽 열이 상위 항목 — 같은 값이 이어지면 합침(정렬된 표에 적합)' },
    { v: 'md-line', l: '한 줄', d: '"- 값 | 값 | 값" 한 줄에 한 행' },
  ];
  const EXT: Record<string, { ext: string; mime: string; lang: string }> = {
    json: { ext: 'json', mime: 'application/json', lang: 'json' },
    yaml: { ext: 'yaml', mime: 'text/yaml', lang: 'yaml' },
    md: { ext: 'md', mime: 'text/markdown', lang: 'markdown' },
  };

  const base = $derived(listExport.format.startsWith('md') ? 'md' : listExport.format);
  const result = $derived.by((): { text: string } | { err: string } | null => {
    const rows = listExport.rows;
    if (!rows) return null;
    try { return { text: exportListText(rows, listExport.format, listExport) }; }
    catch (e) { return { err: e instanceof Error ? e.message : String(e) }; }
  });
  const text = $derived(result && 'text' in result ? result.text : '');
  const canInsert = $derived(doc.edit && !!editorBridge.insertCode);

  const close = () => { listExport.rows = null; };
  const setBase = (b: 'json' | 'yaml' | 'md') => { listExport.format = b === 'md' ? (base === 'md' ? listExport.format : 'md-record') : b; };

  const copy = () => writeClipboard(text).then(() => toast('클립보드에 복사했습니다'), (e) => toast(e instanceof Error ? e.message : String(e), 'error'));
  function save() {
    const t = EXT[base];
    const name = `${stripExt(doc.name) || '표'}-표${listExport.index}.${t.ext}`;
    downloadBlob(name, new Blob([text], { type: `${t.mime};charset=utf-8` }));
    toast(`${t.ext.toUpperCase()} 파일을 내려받았습니다`);
  }
  function insertCode() {
    if (editorBridge.insertCode?.(EXT[base].lang, text)) { toast('문서에 코드 블록으로 넣었습니다'); close(); }
  }

  function onKey(e: KeyboardEvent) {
    if (!listExport.rows || e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }
</script>

<svelte:window onkeydowncapture={onKey} />

{#if listExport.rows}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay" transition:backdropFx onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="dialog wide ttl" role="dialog" transition:modalFx aria-modal="true" aria-label="표를 목록으로 내보내기">
      <h2>표 {listExport.index} 를 목록으로 <span class="sub">{listExport.rows.length - 1}행 × {listExport.rows[0]?.length ?? 0}열</span></h2>

      <div class="opts">
        <div class="seg" role="radiogroup" aria-label="출력 형식">
          {#each FORMATS as f (f.v)}
            <button role="radio" aria-checked={base === f.v} class:active={base === f.v} onclick={() => setBase(f.v)}>{f.l}</button>
          {/each}
        </div>
        {#if base === 'md'}
          <div class="seg" role="radiogroup" aria-label="마크다운 목록 방식">
            {#each MD_STYLES as s (s.v)}
              <button role="radio" aria-checked={listExport.format === s.v} class:active={listExport.format === s.v} title={s.d} onclick={() => (listExport.format = s.v)}>{s.l}</button>
            {/each}
          </div>
        {/if}
      </div>
      {#if base === 'md'}
        <p class="note">{MD_STYLES.find((s) => s.v === listExport.format)?.d}</p>
      {/if}

      <div class="checks">
        {#if base !== 'md'}
          <Switch bind:checked={listExport.infer}>숫자·true/false 를 값으로 (끄면 모두 글자)</Switch>
          <Switch bind:checked={listExport.unflat}>열 이름의 <code>a.b</code>·<code>a[0]</code> 를 중첩 구조로</Switch>
        {:else if listExport.format !== 'md-record'}
          <Switch bind:checked={listExport.inclHeader}>첫 줄에 머리글 넣기 (되읽을 때 열 이름 복원)</Switch>
        {/if}
      </div>

      {#if result && 'err' in result}
        <div class="err">{result.err}</div>
      {:else}
        <textarea readonly value={text} rows="14" spellcheck="false" aria-label="변환 결과" onfocus={(e) => e.currentTarget.select()}></textarea>
      {/if}

      <div class="actions">
        <span class="hint">{text ? `${text.split('\n').length}줄 · ${text.length.toLocaleString()}자` : ''}</span>
        {#if canInsert}<button onclick={insertCode} disabled={!text} title="커서 위치에 코드 블록으로 넣습니다">문서에 코드 블록으로</button>{/if}
        <button onclick={save} disabled={!text}>{EXT[base].ext.toUpperCase()} 파일로 저장</button>
        <button class="primary" onclick={copy} disabled={!text}>복사</button>
        <button onclick={close}>닫기</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .ttl { width: min(760px, calc(100vw - 32px)); }
  .ttl h2 .sub { margin-left: 8px; font-size: 12px; font-weight: 400; color: var(--muted); }
  .opts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-bottom: 8px; }
  .seg button { padding: 3px 10px; font-size: 13px; }
  .note { margin: 0 0 8px; font-size: 12.5px; color: var(--muted); }
  .ttl textarea { min-height: 220px; white-space: pre; overflow: auto; }
  .err { padding: 10px 12px; margin-bottom: 12px; border: 1px solid var(--border); border-radius: 8px; color: var(--danger); white-space: pre-wrap; }
  .actions { flex-wrap: wrap; align-items: center; }
</style>
