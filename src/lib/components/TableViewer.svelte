<script lang="ts">
  // 문서 안 표를 큰 모달에서 다루는 화면: 정렬·검색·열별 필터·열 이동, 선택한 칸의 통계(합계·평균·분산 등),
  // 복사(TSV/CSV/HTML/아스키/마크다운)·저장, 그리고 지금 보이는 상태(필터·정렬·열 순서)를 문서의 표에 반영.
  // 셀 안 서식(굵게·링크)은 일반 텍스트로 다룬다. 보기 상태는 '문서에 반영'을 누르기 전에는 문서에 영향이 없다.
  import { tip } from '../tooltip.svelte';
  import Search from '@lucide/svelte/icons/search';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Columns3 from '@lucide/svelte/icons/columns-3';
  import Copy from '@lucide/svelte/icons/copy';
  import X from '@lucide/svelte/icons/x';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Pop from './Pop.svelte';
  import { tableViewer } from '../tableViewer.svelte';
  import { copyAs, saveTable, COPY_KINDS, type CopyKind, type Fmt } from '../tableTools';
  import { filterRows, sortRows, moveItem, computeStats, fmtNum } from '../tableOps';
  import { doc, toast, askConfirm, settings } from '../store.svelte';
  import { stripExt } from '../utils';

  const table = $derived(tableViewer.table);

  let sort = $state<{ col: number; dir: 1 | -1 } | null>(null); // col = 원래 열 번호
  let order = $state<number[]>([]); // 보이는 열 순서(원래 열 번호)
  let query = $state('');
  let colFilters = $state<string[]>([]);
  let showFilters = $state(false);
  type Rect = { r0: number; c0: number; r1: number; c1: number };
  let sel = $state<Rect | null>(null); // 보이는 칸 좌표
  let anchor: { r: number; c: number } | null = null;
  let dragging = false;
  let copyOpen = $state(false);

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
  const filtered = $derived(!!query.trim() || colFilters.some((f) => f.trim()));
  const reordered = $derived(order.some((c, i) => c !== i));
  const changed = $derived(filtered || !!sort || reordered);
  const hiddenRows = $derived(table ? table.rows.length - vrows.length : 0);

  const rect = $derived(sel ? { r0: Math.min(sel.r0, sel.r1), r1: Math.max(sel.r0, sel.r1), c0: Math.min(sel.c0, sel.c1), c1: Math.max(sel.c0, sel.c1) } : null);
  const inSel = (r: number, c: number) => !!rect && r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1;
  const selCells = $derived(rect ? matrix.slice(rect.r0, rect.r1 + 1).flatMap((r) => r.slice(rect.c0, rect.c1 + 1)) : []);
  const stat = $derived(computeStats(selCells));

  // 정렬: 머리글 → 오름 → 내림 → 원래 순서
  function toggleSort(ci: number) {
    if (sort?.col !== ci) sort = { col: ci, dir: 1 };
    else if (sort.dir === 1) sort = { col: ci, dir: -1 };
    else sort = null;
  }
  function moveCol(vi: number, delta: -1 | 1) {
    const to = vi + delta;
    if (to < 0 || to >= order.length) return;
    order = moveItem(order, vi, to);
    sel = null; // 열이 움직이면 좌표가 어긋나므로 선택을 푼다
  }
  function resetView() { sort = null; query = ''; colFilters = colFilters.map(() => ''); order = table ? table.header.map((_, i) => i) : order; sel = null; }

  // ---- 칸 선택: 누른 채 끌기, Shift+클릭으로 확장, 열 선택 단추 ----
  function down(e: PointerEvent, r: number, c: number) {
    if (e.button !== 0) return;
    if (e.shiftKey && anchor) sel = { r0: anchor.r, c0: anchor.c, r1: r, c1: c };
    else { anchor = { r, c }; sel = { r0: r, c0: c, r1: r, c1: c }; dragging = true; }
  }
  function enter(r: number, c: number) { if (dragging && anchor) sel = { r0: anchor.r, c0: anchor.c, r1: r, c1: c }; }
  function selectColumn(c: number, e: MouseEvent) {
    if (!matrix.length) return;
    if (e.shiftKey && anchor) sel = { r0: 0, c0: anchor.c, r1: matrix.length - 1, c1: c };
    else { anchor = { r: 0, c }; sel = { r0: 0, c0: c, r1: matrix.length - 1, c1: c }; }
  }

  // ---- 복사·저장·문서 반영: 보이는 상태 그대로 ----
  const allRows = () => [vheader, ...matrix];
  const env = { toast, docName: () => stripExt(doc.name) };
  const defaultFmt = (): Fmt => (settings.tableCopyFormat === 'csv' ? 'csv' : 'tsv');
  const copy = (kind: CopyKind) => copyAs(allRows(), kind, env);
  const save = (fmt: Fmt) => saveTable(allRows(), fmt, table!.index, env);
  function copySelection() {
    if (!rect) return;
    copyAs(matrix.slice(rect.r0, rect.r1 + 1).map((r) => r.slice(rect.c0, rect.c1 + 1)), defaultFmt(), env);
  }
  async function applyToDoc() {
    const t = table;
    if (!t?.apply) return;
    const warn = `${hiddenRows ? `숨겨진 ${hiddenRows}행이 문서에서 삭제됩니다. ` : ''}셀 안의 서식(굵게·링크 등)은 일반 글자로 바뀝니다. 지금 보이는 표를 문서에 반영할까요?`;
    if (!(await askConfirm(warn, '반영'))) return;
    if (t.apply(vheader, matrix)) { toast('문서의 표를 지금 보이는 상태로 바꿨습니다'); close(); }
    else toast('문서에서 이 표를 찾지 못했습니다', 'error');
  }
  const close = () => { tableViewer.table = null; };

  function onKey(e: KeyboardEvent) {
    if (!table) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (copyOpen) return; // 팝오버가 먼저 닫힌다
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
  <div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="dialog tv" role="dialog" aria-modal="true" aria-label="표 확대 보기">
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
                  <button aria-label="왼쪽으로 옮기기" use:tip={'열을 왼쪽으로'} disabled={vi === 0} onclick={() => moveCol(vi, -1)}><ChevronLeft size={13} /></button>
                  <button aria-label="이 열 선택" use:tip={{ title: '이 열 선택', lines: ['Shift+클릭: 여러 열'] }} onclick={(e) => selectColumn(vi, e)}><Columns3 size={13} /></button>
                  <button aria-label="오른쪽으로 옮기기" use:tip={'열을 오른쪽으로'} disabled={vi === order.length - 1} onclick={() => moveCol(vi, 1)}><ChevronRight size={13} /></button>
                </th>
              {/each}
            </tr>
            <tr>
              {#each order as ci (ci)}
                <th>
                  <button type="button" class="hd" onclick={() => toggleSort(ci)} use:tip={'클릭하면 이 열로 정렬'}>
                    {table.header[ci]}{#if sort?.col === ci}<span class="arrow">{sort.dir === 1 ? '▲' : '▼'}</span>{/if}
                  </button>
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
                  <td class:sel={inSel(ri, vi)} onpointerdown={(e) => down(e, ri, vi)} onpointerenter={() => enter(ri, vi)}>{v}</td>
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
          <span class="chip">선택 {rect.r1 - rect.r0 + 1}행 × {rect.c1 - rect.c0 + 1}열</span>
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
          <span class="muted">칸을 누르거나 끌어서 선택하면 합계·평균·분산 등이 여기에 표시됩니다. (열 위의 <Columns3 size={12} /> 로 열 전체 선택 · Ctrl+C 로 선택 칸 복사)</span>
        {/if}
      </div>

      <div class="actions">
        <span class="hint">머리글을 눌러 정렬합니다. {changed ? '복사·저장은 지금 보이는 상태 그대로 나갑니다.' : ''}</span>
        {#if changed && table.apply}
          <button onclick={applyToDoc} use:tip={{ title: '문서의 표를 바꿉니다', lines: ['필터로 숨긴 행은 삭제됩니다'] }}>문서 표에 반영</button>
        {/if}
        <span class="split">
          <button class="main" onclick={() => copy(defaultFmt())} use:tip={`${defaultFmt().toUpperCase()} 로 복사 (설정에서 기본 형식을 바꿉니다)`}><Copy size={14} /> 복사</button>
          <Pop bind:open={copyOpen} label="복사·저장 형식" width={250}>
            {#snippet trigger({ toggle, open })}
              <button class="drop" class:on={open} aria-haspopup="dialog" aria-expanded={open} aria-label="복사·저장 형식 더 보기" onclick={toggle}><ChevronDown size={14} /></button>
            {/snippet}
            {#snippet children({ close: pclose })}
              {#each COPY_KINDS as k (k.kind)}
                <button class="pop-row" onclick={() => { copy(k.kind); pclose(); }}><span class="txt"><b>{k.label}</b><small>{k.desc}</small></span></button>
              {/each}
              <hr />
              <button class="pop-row" onclick={() => { save('csv'); pclose(); }}><span class="txt"><b>CSV 파일로 저장</b></span></button>
              <button class="pop-row" onclick={() => { save('tsv'); pclose(); }}><span class="txt"><b>TSV 파일로 저장</b></span></button>
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
  th.cb { display: table-cell; text-align: center; height: 22px; background: var(--surface); }
  th.cb button { border: 0; background: transparent; padding: 1px 4px; color: var(--muted); border-radius: 4px; line-height: 1; }
  th.cb button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
  th.cb button:disabled { opacity: 0.25; }
  th .hd { width: 100%; justify-content: flex-start; border: 0; border-radius: 0; background: transparent; padding: 4px 10px; font-weight: 600; }
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
</style>
