<script lang="ts">
  import { backdropFx, modalFx } from '../motion';
  // 문서 안 표를 큰 모달에서 다루는 화면: 정렬·검색·열별 필터·열 이동, 선택한 칸의 통계(합계·평균·분산 등),
  // 복사(TSV/CSV/HTML/아스키/마크다운)·저장, 그리고 지금 보이는 상태(필터·정렬·열 순서)를 문서의 표에 반영.
  // 셀 안 서식(굵게·링크)은 일반 텍스트로 다룬다. 보기 상태는 '문서에 반영'을 누르기 전에는 문서에 영향이 없다.
  import { tip } from '../tooltip.svelte';
  import Search from '@lucide/svelte/icons/search';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Columns3 from '@lucide/svelte/icons/columns-3';
  import Copy from '@lucide/svelte/icons/copy';
  import Download from '@lucide/svelte/icons/download';
  import Code from '@lucide/svelte/icons/code';
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
  import TablePlus from '@lucide/svelte/icons/table-properties';
  import Replace from '@lucide/svelte/icons/replace';
  import Pop from './Pop.svelte';
  import { tableViewer } from '../tableViewer.svelte';
  import { listExport, openListExport } from '../tableListUi.svelte';
  import { copyAs, saveAs, COPY_KINDS, SAVE_KINDS, type CopyKind, type SaveKind, type Fmt } from '../tableTools';
  import { toAscii } from '../tableFormats';
  import { filterRows, sortRows, computeStats, fmtNum, sliceGrid } from '../tableOps';
  import { doc, toast, askConfirm, settings, persistSettings, editorBridge } from '../store.svelte';
  import { stripExt } from '../utils';

  const table = $derived(tableViewer.table);

  let sort = $state<{ col: number; dir: 1 | -1 } | null>(null); // col = 원래 열 번호
  let order = $state<number[]>([]); // 보이는 열 순서(원래 열 번호)
  let query = $state('');
  let colFilters = $state<string[]>([]);
  let showFilters = $state(false);
  type Rect = { r0: number; c0: number; r1: number; c1: number };
  let sel = $state<Rect | null>(null); // 보이는 칸 좌표(격자 기준: 0행 = 머리글 행, 1행부터 본문)
  let anchor: { r: number; c: number } | null = null;
  let dragging = false;
  let copyOpen = $state(false);
  let saveOpen = $state(false);
  let codeOpen = $state(false);

  // 표가 바뀌면(다른 표를 열면) 보기 상태를 모두 처음으로
  $effect(() => {
    const t = table;
    sort = null; query = ''; showFilters = false; sel = null; anchor = null;
    order = t ? t.header.map((_, i) => i) : [];
    colFilters = t ? t.header.map(() => '') : [];
  });

  const vheader = $derived(table ? order.map((ci) => table.header[ci] ?? '') : []);
  const vrows = $derived.by(() => {
    if (!table) return [];
    let r = filterRows(table.rows, query, colFilters);
    if (sort) r = sortRows(r, sort.col, sort.dir);
    return r;
  });
  const matrix = $derived(vrows.map((r) => order.map((ci) => r[ci] ?? '')));
  const grid = $derived([vheader, ...matrix]); // 머리글 행을 맨 앞에 둔 '지금 보이는 상태'
  // 첫 행 헤더가 꺼진 표(머리글이 비었거나 table.headerless): 머리글 줄을 얇게 접고 선택·정렬 대상에서 뺀다
  const headerless = $derived(!!table && (!!table.headerless || table.header.every((h) => h === '')));
  const filtered = $derived(!!query.trim() || colFilters.some((f) => f.trim()));
  const reordered = $derived(order.some((c, i) => c !== i));
  const changed = $derived(filtered || !!sort || reordered);
  const hiddenRows = $derived(table ? table.rows.length - vrows.length : 0);

  const rect = $derived(sel ? { r0: Math.min(sel.r0, sel.r1), r1: Math.max(sel.r0, sel.r1), c0: Math.min(sel.c0, sel.c1), c1: Math.max(sel.c0, sel.c1) } : null);
  const inSel = (r: number, c: number) => !!rect && r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1;
  const selCells = $derived(rect ? sliceGrid(grid, rect.r0, rect.c0, rect.r1, rect.c1).flat() : []);
  const selHasHeader = $derived(!!rect && rect.r0 === 0 && !headerless);
  // 선택의 첫 행이 새 표의 머리글이라, 두 행 이상이어야 본문이 있는 표가 된다
  const canMakeTable = $derived(!!rect && rect.r1 > rect.r0);
  const stat = $derived(computeStats(selCells));

  // 정렬: 머리글 → 오름 → 내림 → 원래 순서
  function toggleSort(ci: number) {
    if (sort?.col !== ci) sort = { col: ci, dir: 1 };
    else if (sort.dir === 1) sort = { col: ci, dir: -1 };
    else sort = null;
  }
  function resetView() { sort = null; query = ''; colFilters = colFilters.map(() => ''); order = table ? table.header.map((_, i) => i) : order; sel = null; }

  // ---- 칸 선택: 누른 채 끌기, Shift+클릭으로 확장, 열 선택 단추 ----
  function down(e: PointerEvent, r: number, c: number) {
    if (e.button !== 0 || (r === 0 && headerless)) return;
    if (e.shiftKey && anchor) sel = { r0: anchor.r, c0: anchor.c, r1: r, c1: c };
    else { anchor = { r, c }; sel = { r0: r, c0: c, r1: r, c1: c }; dragging = true; }
  }
  function enter(r: number, c: number) { if (dragging && anchor) sel = { r0: anchor.r, c0: anchor.c, r1: r, c1: c }; }
  function selectColumn(c: number, e: MouseEvent) {
    const top = headerless ? 1 : 0; // 접힌 머리글 줄은 열 선택에서 뺀다
    if (grid.length <= top) return;
    if (e.shiftKey && anchor) sel = { r0: top, c0: anchor.c, r1: grid.length - 1, c1: c };
    else { anchor = { r: top, c }; sel = { r0: top, c0: c, r1: grid.length - 1, c1: c }; }
  }

  // ---- 복사·저장·문서 반영: 보이는 상태 그대로 ----
  const allRows = () => grid;
  const env = { toast, docName: () => stripExt(doc.name) };
  const defaultFmt = (): Fmt => (settings.tableCopyFormat === 'csv' ? 'csv' : 'tsv');
  // 복사 단추는 가장 최근에 고른 형식으로 복사한다(처음에는 설정의 기본 형식)
  const SHORT: Record<CopyKind, string> = { tsv: 'TSV', csv: 'CSV', html: 'HTML 서식', htmlsrc: 'HTML 소스', ascii: '아스키 표', markdown: '마크다운 표' };
  const lastCopy = $derived<CopyKind>(settings.tableLastCopy || defaultFmt());
  function copy(kind: CopyKind) {
    copyAs(allRows(), kind, env);
    settings.tableLastCopy = kind;
    persistSettings();
  }
  const save = (kind: SaveKind) => saveAs(allRows(), kind, table!.index, env);
  // 코드 블록으로: 커서 위치에 아스키 표를 넣는다(목록 변환은 별도 창)
  const canCode = $derived(doc.edit && !!editorBridge.insertCode);
  function insertAscii() {
    if (editorBridge.insertCode?.('text', toAscii(allRows()))) { toast('문서에 아스키 표 코드 블록을 넣었습니다'); close(); }
  }
  function copySelection() {
    if (!rect) return;
    copyAs(sliceGrid(grid, rect.r0, rect.c0, rect.r1, rect.c1), defaultFmt(), env);
  }
  async function applyToDoc() {
    const t = table;
    if (!t?.apply) return;
    const warn = `${hiddenRows ? `숨겨진 ${hiddenRows}행이 문서에서 삭제됩니다. ` : ''}셀 안의 서식(굵게·링크 등)은 일반 글자로 바뀝니다. 지금 보이는 표를 문서에 반영할까요?`;
    if (!(await askConfirm(warn, '반영'))) return;
    if (t.apply(vheader, matrix)) { toast('문서의 표를 지금 보이는 상태로 바꿨습니다'); close(); }
    else toast('문서에서 이 표를 찾지 못했습니다', 'error');
  }
  // 선택 영역 → 새 표(첫 행이 헤더). 문서 표 바로 아래에 추가하거나 현재 표를 교체한다
  function selectionRows() { return rect ? sliceGrid(grid, rect.r0, rect.c0, rect.r1, rect.c1) : []; }
  function addAsNewTable() {
    const t = table;
    if (!t?.insertAfter || !canMakeTable) return;
    if (t.insertAfter(selectionRows())) { toast('선택한 영역을 새 표로 문서에 추가했습니다'); close(); }
    else toast('문서에서 이 표를 찾지 못했습니다', 'error');
  }
  async function replaceWithSelection() {
    const t = table;
    if (!t?.replaceWith || !canMakeTable) return;
    if (!(await askConfirm('선택한 영역 밖의 행·열은 문서에서 사라지고, 셀 안의 서식(굵게·링크 등)은 일반 글자로 바뀝니다. 이 표를 선택한 영역으로 교체할까요?', '교체'))) return;
    if (t.replaceWith(selectionRows())) { toast('문서의 표를 선택한 영역으로 교체했습니다'); close(); }
    else toast('문서에서 이 표를 찾지 못했습니다', 'error');
  }
  // 행·열 바꾸기: 문서의 원본 표 기준(필터·정렬·열 이동은 반영하지 않음). 뷰어의 보기 상태가 무의미해지므로 닫는다
  async function transposeDoc() {
    const t = table;
    if (!t?.transpose) return;
    if (changed && !(await askConfirm('행·열 바꾸기는 필터·정렬·열 이동을 적용하지 않은 문서의 원래 표 기준으로 동작하며, 이 보기는 닫힙니다. 계속할까요?', '바꾸기'))) return;
    if (t.transpose()) close(); // 못 바꾸는 경우의 안내는 transpose 가 토스트로 알린다
  }
  const close = () => { tableViewer.table = null; };

  function onKey(e: KeyboardEvent) {
    if (!table || listExport.rows) return; // 위에 뜬 '목록으로' 창이 키를 받는다
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (copyOpen || saveOpen || codeOpen) return; // 팝오버가 먼저 닫힌다
      if (sel) sel = null; else close();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && rect && !(e.target as HTMLElement).closest('input, textarea') && !window.getSelection()?.toString()) {
      e.preventDefault();
      copySelection();
    }
  }
</script>

<svelte:window onkeydowncapture={onKey} onpointerup={() => { dragging = false; }} />

{#if table}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay" transition:backdropFx onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="dialog tv" role="dialog" transition:modalFx aria-modal="true" aria-label="표 확대 보기">
      <header class="tv-head">
        <h2>표 {table.index} <span class="sub">{vrows.length}{filtered ? ` / ${table.rows.length}` : ''}행 × {table.header.length}열</span></h2>
        <label class="tv-search"><Search size={14} /><input bind:value={query} placeholder="표 안에서 찾기" aria-label="표 안에서 찾기" spellcheck="false" />
          {#if query}<button class="icon-btn" aria-label="지우기" onclick={() => (query = '')}><X size={13} /></button>{/if}
        </label>
        <button class="icon-btn" class:on={showFilters || colFilters.some((f) => f.trim())} aria-pressed={showFilters} aria-label="열별 필터" use:tip={{ title: '열별 필터', lines: ['글자 일부 · >10 · <=5 · =값 · !=값'] }} onclick={() => (showFilters = !showFilters)}><ListFilter size={16} /></button>
        {#if changed}<button class="icon-btn" aria-label="보기 초기화" use:tip={'정렬·필터·열 순서를 처음으로'} onclick={resetView}><RotateCcw size={15} /></button>{/if}
        <span class="spacer"></span>
        <button class="icon-btn" aria-label="닫기" use:tip={{ title: '닫기', kbd: 'Esc' }} onclick={close}><X size={18} /></button>
      </header>

      <div class="tv-scroll">
        <table>
          <thead>
            <tr class="colbar">
              {#each order as ci, vi (ci)}
                <th class="cb">
                  <button aria-label="이 열 선택" use:tip={{ title: '이 열 선택', lines: ['Shift+클릭: 여러 열'] }} onclick={(e) => selectColumn(vi, e)}><Columns3 size={13} /></button>
                  <button class="sortbtn" class:on={sort?.col === ci} aria-label="이 열로 정렬" use:tip={{ title: '이 열로 정렬', lines: ['오름차순 → 내림차순 → 원래 순서'] }} onclick={() => toggleSort(ci)}>
                    {#if sort?.col === ci}<span class="arrow">{sort.dir === 1 ? '▲' : '▼'}</span>{:else}<ArrowUpDown size={13} />{/if}
                  </button>
                </th>
              {/each}
            </tr>
            <tr class:foldrow={headerless}>
              {#each order as ci, vi (ci)}
                <th class="hcell" class:fold={headerless} class:sel={inSel(0, vi)} onpointerdown={(e) => down(e, 0, vi)} onpointerenter={() => enter(0, vi)}>
                  {#if !headerless}
                    <span class="hd">{table.header[ci]}</span>
                  {/if}
                </th>
              {/each}
            </tr>
            {#if showFilters}
              <tr class="filters">
                {#each order as ci (ci)}
                  <th><input bind:value={colFilters[ci]} placeholder="필터" aria-label={`${table.header[ci]} 필터`} spellcheck="false" /></th>
                {/each}
              </tr>
            {/if}
          </thead>
          <tbody>
            {#each matrix as r, ri}
              <tr>
                {#each r as v, vi}
                  <td class:sel={inSel(ri + 1, vi)} onpointerdown={(e) => down(e, ri + 1, vi)} onpointerenter={() => enter(ri + 1, vi)}>{v}</td>
                {/each}
              </tr>
            {/each}
            {#if !matrix.length}
              <tr><td class="none" colspan={Math.max(1, order.length)}>조건에 맞는 행이 없습니다.</td></tr>
            {/if}
          </tbody>
        </table>
      </div>

      <div class="tv-stats" aria-live="polite">
        {#if rect}
          <span class="chip">선택 {rect.r1 - rect.r0 + 1}행 × {rect.c1 - rect.c0 + 1}열{selHasHeader ? ' (머리글 포함)' : ''}</span>
          {#if table.insertAfter}
            <button class="mk" disabled={!canMakeTable} onclick={addAsNewTable} use:tip={{ title: '선택으로 새 표 추가', lines: canMakeTable ? ['선택의 첫 행이 새 표의 머리글, 이 표 바로 아래에 추가'] : ['두 행 이상 선택해야 합니다 (첫 행이 머리글)'] }}><TablePlus size={13} /> 선택으로 새 표 추가</button>
            <button class="mk" disabled={!canMakeTable} onclick={replaceWithSelection} use:tip={{ title: '이 표를 선택으로 교체', lines: canMakeTable ? ['선택 밖의 행·열은 문서에서 사라집니다'] : ['두 행 이상 선택해야 합니다 (첫 행이 머리글)'] }}><Replace size={13} /> 이 표를 선택으로 교체</button>
          {/if}
          <span>채워진 칸 <b>{stat.count}</b></span>
          {#if stat.stats}
            <span>숫자 <b>{stat.numbers}</b></span>
            <span>합계 <b>{fmtNum(stat.stats.sum)}</b></span>
            <span>평균 <b>{fmtNum(stat.stats.mean)}</b></span>
            <span>최솟값 <b>{fmtNum(stat.stats.min)}</b></span>
            <span>최댓값 <b>{fmtNum(stat.stats.max)}</b></span>
            <span>중앙값 <b>{fmtNum(stat.stats.median)}</b></span>
            <span>분산 <b>{fmtNum(stat.stats.variance)}</b></span>
            <span>표준편차 <b>{fmtNum(stat.stats.stdev)}</b></span>
          {:else}<span class="muted">숫자 칸이 없어 계산할 수 없습니다.</span>{/if}
        {:else}
          <span class="muted">머리글을 포함해 칸을 누르거나 끌어서 선택하면 합계·평균·분산 등이 여기에 표시됩니다. (열 위의 <Columns3 size={12} /> 로 열 전체 선택 · Ctrl+C 로 선택 칸 복사)</span>
        {/if}
      </div>

      <div class="actions">
        <span class="hint">{headerless ? '' : '열 위의 ↕ 로 정렬합니다.'} {changed ? '복사·저장은 지금 보이는 상태 그대로 나갑니다.' : ''}</span>
        {#if table.transpose}
          <button onclick={transposeDoc} use:tip={{ title: '행·열 바꾸기', lines: ['문서의 원래 표를 전치합니다(필터·정렬 미적용)', '머리글이 켜진 표는 첫 열이 새 머리글이 됩니다'] }}>행·열 바꾸기</button>
        {/if}
        {#if changed && table.apply}
          <button onclick={applyToDoc} use:tip={{ title: '문서의 표를 바꿉니다', lines: ['필터로 숨긴 행은 삭제됩니다'] }}>문서 표에 반영</button>
        {/if}
        {#if canCode}
          <Pop bind:open={codeOpen} label="코드 블록으로 넣기" width={290}>
            {#snippet trigger({ toggle, open })}
              <button class:on={open} aria-haspopup="dialog" aria-expanded={open} onclick={toggle}><Code size={14} /> 코드 블록으로</button>
            {/snippet}
            {#snippet children({ close: pclose })}
              <button class="pop-row" onclick={() => { insertAscii(); pclose(); }}><span class="txt"><b>아스키 표</b><small>+---+ 로 그린 고정폭 표를 커서 위치에</small></span></button>
              <button class="pop-row" onclick={() => { openListExport(allRows(), table!.index); pclose(); }}><span class="txt"><b>목록…</b><small>JSON·YAML·마크다운 목록으로 변환해 넣기</small></span></button>
            {/snippet}
          </Pop>
        {/if}
        <Pop bind:open={saveOpen} label="저장 형식" width={290}>
          {#snippet trigger({ toggle, open })}
            <button class:on={open} aria-haspopup="dialog" aria-expanded={open} onclick={toggle}><Download size={14} /> 저장…</button>
          {/snippet}
          {#snippet children({ close: pclose })}
            {#each SAVE_KINDS as k (k.kind)}
              <button class="pop-row" onclick={() => { save(k.kind); pclose(); }}><span class="txt"><b>{k.label} <span class="ext">.{k.ext}</span></b><small>{k.desc}</small></span></button>
            {/each}
          {/snippet}
        </Pop>
        <span class="split">
          <button class="main" onclick={() => copy(lastCopy)} use:tip={'가장 최근에 고른 형식으로 복사합니다 (오른쪽 ▾ 로 다른 형식)'}><Copy size={14} /> {SHORT[lastCopy]} 복사</button>
          <Pop bind:open={copyOpen} label="복사 형식" width={290}>
            {#snippet trigger({ toggle, open })}
              <button class="drop" class:on={open} aria-haspopup="dialog" aria-expanded={open} aria-label="복사 형식 고르기" onclick={toggle}><ChevronDown size={14} /></button>
            {/snippet}
            {#snippet children({ close: pclose })}
              {#each COPY_KINDS as k (k.kind)}
                <button class="pop-row" onclick={() => { copy(k.kind); pclose(); }}><span class="txt"><b>{k.label}{#if k.kind === lastCopy} <Check size={12} />{/if}</b><small>{k.desc}</small></span></button>
              {/each}
            {/snippet}
          </Pop>
        </span>
        <button class="primary" onclick={close}>닫기</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .tv { width: min(1400px, 96vw); height: min(860px, 92vh); max-height: 92vh; display: flex; flex-direction: column; padding: 14px 16px; }
  .tv-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .tv-head h2 { margin: 0; font-size: 16px; }
  .tv-head h2 .sub { margin-left: 8px; font-size: 12px; font-weight: 400; color: var(--muted); }
  .tv-head .spacer { flex: 1; }
  .tv-head .icon-btn.on { color: var(--accent); background: var(--accent-soft); }
  .tv-search { display: flex; align-items: center; gap: 6px; padding: 3px 8px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); color: var(--muted); margin-left: 8px; }
  .tv-search:focus-within { border-color: var(--accent); }
  .tv-search input { border: 0; background: transparent; outline: none; color: var(--text); font: inherit; font-size: 13px; width: 180px; padding: 2px 0; margin: 0; }
  .tv-scroll { flex: 1; min-height: 0; overflow: auto; margin-bottom: 8px; border: 1px solid var(--border); border-radius: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 1.45; }
  th, td { padding: 4px 10px; border: 1px solid var(--border); text-align: left; vertical-align: top; white-space: pre-wrap; overflow-wrap: break-word; word-break: keep-all; }
  thead th { position: sticky; background: var(--surface-2); padding: 0; z-index: 1; }
  thead tr:nth-child(1) th { top: 0; }
  thead tr:nth-child(2) th { top: 22px; }
  thead tr:nth-child(3) th { top: 52px; }
  thead:has(.foldrow) tr:nth-child(3) th { top: 28px; }
  th.cb { display: table-cell; text-align: center; height: 22px; background: var(--surface); }
  th.cb button { border: 0; background: transparent; padding: 1px 4px; color: var(--muted); border-radius: 4px; line-height: 1; }
  th.cb button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
  th.cb button.on { color: var(--accent); background: var(--hover); }
  th.hcell { display: table-cell; cursor: cell; user-select: none; }
  th.hcell.sel { background: var(--accent-soft); outline: 1px solid var(--accent); outline-offset: -1px; }
  th.hcell.fold { height: 6px; padding: 0; font-size: 0; line-height: 0; cursor: default; }
  tr.foldrow { height: 6px; }
  th .hd { display: inline-block; padding: 4px 4px 4px 10px; font-weight: 600; }
  .tv-stats .mk { display: inline-flex; flex-direction: row; align-items: center; gap: 4px; padding: 2px 8px; font-size: 12px; white-space: nowrap; }
  .filters th input { width: 100%; box-sizing: border-box; border: 0; border-radius: 0; background: var(--bg); padding: 4px 8px; font-size: 12.5px; margin: 0; }
  .filters th input:focus { outline: 2px solid var(--accent); outline-offset: -2px; }
  .arrow { margin-left: 4px; font-size: 10px; color: var(--accent); }
  td { cursor: cell; user-select: none; }
  td.sel { background: var(--accent-soft); outline: 1px solid var(--accent); outline-offset: -1px; }
  td.none { text-align: center; color: var(--muted); padding: 24px; cursor: default; }
  .tv-stats { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; min-height: 28px; padding: 6px 10px; margin-bottom: 8px; border-radius: 8px; background: var(--surface); font-size: 12.5px; }
  .tv-stats b { font-variant-numeric: tabular-nums; font-weight: 600; }
  .tv-stats .muted { color: var(--muted); }
  .tv-stats .chip { background: var(--accent-soft); border-radius: 10px; padding: 1px 8px; }
  .actions { align-items: center; flex-wrap: wrap; }
  .actions .hint { flex: 1; min-width: 160px; font-size: 12px; color: var(--muted); margin-right: auto; }
  .split { display: inline-flex; }
  .split .main { display: inline-flex; flex-direction: row; align-items: center; gap: 6px; white-space: nowrap; border-radius: 8px 0 0 8px; }
  .split .drop { border-radius: 0 8px 8px 0; border-left: 0; padding: 5px 7px; }
  .split .drop.on { background: var(--accent-soft); }
  .actions :global(.pop-wrap > button.on) { background: var(--accent-soft); }
  .ext { font-weight: 400; color: var(--muted); font-size: 12px; }
</style>
