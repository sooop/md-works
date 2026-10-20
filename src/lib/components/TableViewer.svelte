<script lang="ts">
  import { tip } from '../tooltip.svelte';
  // 문서 안 표를 큰 모달의 읽기 전용 표로 보여 준다. 머리글을 누르면 그 열로 정렬(오름차순 → 내림차순 → 원래 순서).
  // 셀 안 서식(굵게·링크)은 일반 텍스트로 보인다. 정렬은 보기 전용이라 문서에 영향이 없다.
  import { tableViewer } from '../tableViewer.svelte';
  import { copyTable, saveTable, type Fmt } from '../tableTools';
  import { doc, toast } from '../store.svelte';
  import { stripExt } from '../utils';

  let sort = $state<{ col: number; dir: 1 | -1 } | null>(null);
  const table = $derived(tableViewer.table);

  // 표가 바뀌면(다른 표를 열면) 정렬을 푼다
  $effect(() => { table; sort = null; });

  const rows = $derived.by(() => {
    if (!table || !sort) return table?.rows ?? [];
    const { col, dir } = sort;
    return [...table.rows].sort((a, b) => dir * (a[col] ?? '').localeCompare(b[col] ?? '', undefined, { numeric: true }));
  });

  function toggleSort(col: number) {
    if (sort?.col !== col) sort = { col, dir: 1 };
    else if (sort.dir === 1) sort = { col, dir: -1 };
    else sort = null;
  }
  // 정렬한 상태 그대로(머리글 + 보이는 순서의 행) 복사·저장한다
  const allRows = () => [table!.header, ...rows.map((r) => table!.header.map((_, i) => r[i] ?? ''))];
  const env = { toast, docName: () => stripExt(doc.name) };
  const copy = (fmt: Fmt) => copyTable(allRows(), fmt, env);
  const save = (fmt: Fmt) => saveTable(allRows(), fmt, table!.index, env);
  const close = () => { tableViewer.table = null; };

  function onKey(e: KeyboardEvent) {
    if (table && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }
</script>

<svelte:window onkeydowncapture={onKey} />

{#if table}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="dialog tv" role="dialog" aria-modal="true" aria-label="표 확대 보기">
      <h2>표 {table.index} 확대 보기 <span class="sub">{table.rows.length}행 × {table.header.length}열</span></h2>
      <div class="tv-scroll">
        <table>
          <thead>
            <tr>
              {#each table.header as h, i}
                <th>
                  <button type="button" onclick={() => toggleSort(i)} use:tip={'클릭하면 이 열로 정렬'}>
                    {h}{#if sort?.col === i}<span class="arrow">{sort.dir === 1 ? '▲' : '▼'}</span>{/if}
                  </button>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as r}
              <tr>{#each table.header as _, i}<td>{r[i] ?? ''}</td>{/each}</tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="actions">
        <span class="hint">머리글을 눌러 정렬할 수 있습니다. 정렬은 문서에 저장되지 않지만 복사·저장에는 반영됩니다.</span>
        <button onclick={() => copy('tsv')}>TSV 복사</button>
        <button onclick={() => copy('csv')}>CSV 복사</button>
        <button onclick={() => save('csv')}>CSV 저장</button>
        <button onclick={() => save('tsv')}>TSV 저장</button>
        <button class="primary" onclick={close}>닫기</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .tv { width: min(1400px, 96vw); max-height: 92vh; display: flex; flex-direction: column; }
  .tv h2 .sub { margin-left: 8px; font-size: 12px; font-weight: 400; color: var(--muted); }
  .tv-scroll { flex: 1; min-height: 0; overflow: auto; margin-bottom: 16px; border: 1px solid var(--border); border-radius: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 1.45; }
  th, td { padding: 4px 10px; border: 1px solid var(--border); text-align: left; vertical-align: top; white-space: pre-wrap; overflow-wrap: break-word; word-break: keep-all; }
  th { position: sticky; top: 0; background: var(--surface-2); padding: 0; }
  th button { width: 100%; justify-content: flex-start; border: 0; border-radius: 0; background: transparent; padding: 4px 10px; font-weight: 600; }
  .arrow { margin-left: 4px; font-size: 10px; color: var(--accent); }
</style>
