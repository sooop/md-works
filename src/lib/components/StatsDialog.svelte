<script lang="ts">
  // 집필 통계 창: 요약 다섯 값, 최근 30일 막대 그래프, 최근 12주 잔디 표. 상태 표시줄의 '오늘 +N자' 에서 연다.
  import { backdropFx, modalFx } from '../motion';
  import { tip } from '../tooltip.svelte';
  import { modal } from '../modal';
  import { askConfirm } from '../store.svelte';
  import ModalClose from './ModalClose.svelte';
  import { stats, clearStats } from '../stats/state.svelte';
  import { summarize, lastDays, weekGrid, hasRecords, signed, dayLabel } from '../stats/logic';

  let { open = $bindable(false) }: { open: boolean } = $props();

  const sum = $derived(summarize(stats.days, stats.today));
  const empty = $derived(!hasRecords(stats.days));
  const bars = $derived(lastDays(stats.days, stats.today, 30));
  const grid = $derived(weekGrid(stats.days, stats.today, 12));

  // 막대: 양수는 기준선 위, 음수는 아래. 기준선 높이는 (최대 증가 : 최대 감소) 비율로 정한다
  const geo = $derived.by(() => {
    const up = Math.max(0, ...bars.map((b) => b.value));
    const down = Math.max(0, ...bars.map((b) => -b.value));
    const total = up + down || 1;
    return { total, base: (down / total) * 100 }; // base: 아래에서 기준선까지 %
  });
  const barStyle = (v: number) => {
    const h = (Math.abs(v) / geo.total) * 100;
    return v >= 0 ? `bottom:${geo.base}%;height:${h}%` : `top:${100 - geo.base}%;height:${h}%`;
  };
  const amount = (v: number) => `${signed(v)}자`;

  // 스크린리더용 표: 최근 12주 중 기록이 있는 날
  const srRows = $derived(grid.flat().filter((c) => c && c.value !== 0).reverse() as { date: string; value: number }[]);

  async function clear() {
    if (await askConfirm('집필 기록(날짜별 작성량)을 모두 지울까요? 되돌릴 수 없습니다.', '지우기', true)) clearStats();
  }
  const WD = ['월', '', '수', '', '금', '', '일'];
</script>

{#if open}
  <div class="overlay" transition:backdropFx use:modal={{ onClose: () => (open = false) }}>
    <div class="dialog stats-dialog" role="dialog" aria-modal="true" aria-label="집필 통계" transition:modalFx>
      <ModalClose onclick={() => (open = false)} />
      <h2>집필 통계</h2>
      <p class="note">하루 작성량은 그날 모든 글의 글자 수(공백 제외)가 순수하게 늘어난 만큼입니다. 한 번에 2,000자를 넘게 바뀐 변화(붙여넣기·가져오기·버전 복구)는 세지 않습니다.</p>

      <dl class="sums">
        <div><dt>오늘</dt><dd>{amount(sum.today)}</dd></div>
        <div><dt>최근 7일</dt><dd>{amount(sum.week)}</dd></div>
        <div><dt>최근 30일</dt><dd>{amount(sum.month)}</dd></div>
        <div><dt>연속 작성</dt><dd>{sum.streak}일</dd></div>
        <div><dt>최장 연속</dt><dd>{sum.best}일</dd></div>
      </dl>

      {#if empty}
        <p class="none">아직 기록이 없습니다. 글을 쓰면 여기에 쌓입니다.</p>
      {:else}
        <h3>최근 30일</h3>
        <div class="bars" aria-hidden="true">
          <span class="axis" style:bottom="{geo.base}%"></span>
          {#each bars as b (b.date)}
            <div class="col" use:tip={`${dayLabel(b.date)} · ${amount(b.value)}`}>
              {#if b.value !== 0}<span class="bar" class:neg={b.value < 0} style={barStyle(b.value)}></span>{/if}
            </div>
          {/each}
        </div>
        <div class="bar-axis" aria-hidden="true"><span>{dayLabel(bars[0].date)}</span><span>오늘</span></div>

        <h3>최근 12주</h3>
        <div class="heat" aria-hidden="true">
          <div class="wd">{#each WD as w}<span>{w}</span>{/each}</div>
          {#each grid as week}
            <div class="week">
              {#each week as c}
                {#if c}
                  <span class="cell l{c.level}" class:neg={c.value < 0} use:tip={`${dayLabel(c.date)} · ${amount(c.value)}`}></span>
                {:else}
                  <span class="cell blank"></span>
                {/if}
              {/each}
            </div>
          {/each}
        </div>
        <div class="legend" aria-hidden="true">적음 {#each [0, 1, 2, 3, 4] as l}<span class="cell l{l}"></span>{/each} 많음</div>

        <table class="sr-only">
          <caption>최근 12주 날짜별 작성량 (기록이 있는 날만)</caption>
          <thead><tr><th scope="col">날짜</th><th scope="col">작성량</th></tr></thead>
          <tbody>{#each srRows as r (r.date)}<tr><th scope="row">{dayLabel(r.date)}</th><td>{amount(r.value)}</td></tr>{/each}</tbody>
        </table>
      {/if}

      <div class="actions">
        <button class="danger-text" onclick={clear} disabled={empty}>기록 지우기</button>
        <span class="grow"></span>
        <button class="primary" onclick={() => (open = false)}>닫기</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .stats-dialog { width: min(560px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow-y: auto; position: relative; }
  .stats-dialog h2 { padding-right: 36px; }
  .stats-dialog h3 { margin: 18px 0 8px; font-size: 13px; color: var(--muted); font-weight: 600; }
  .note { margin: 0 0 14px; font-size: 12px; color: var(--muted); }
  .none { margin: 24px 0; text-align: center; color: var(--muted); }
  .sums { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 0; }
  .sums div { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 6px; text-align: center; min-width: 0; }
  .sums dt { font-size: 11px; color: var(--muted); }
  .sums dd { margin: 2px 0 0; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  @media (max-width: 520px) { .sums { grid-template-columns: repeat(3, 1fr); } }

  .bars { position: relative; display: grid; grid-template-columns: repeat(30, 1fr); gap: 2px; height: 110px; }
  .axis { position: absolute; left: 0; right: 0; height: 1px; background: var(--border-strong); }
  .col { position: relative; height: 100%; }
  .bar { position: absolute; left: 0; right: 0; min-height: 2px; border-radius: 2px; background: var(--accent); }
  .bar.neg { background: var(--danger); opacity: 0.75; }
  .bar-axis { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: var(--muted); }

  .heat { display: flex; gap: 3px; align-items: flex-start; }
  .wd { display: grid; grid-template-rows: repeat(7, 14px); gap: 3px; font-size: 10px; color: var(--muted); padding-right: 4px; line-height: 14px; }
  .week { display: grid; grid-template-rows: repeat(7, 14px); gap: 3px; flex: 1; min-width: 0; }
  .cell { display: block; width: 100%; height: 14px; border-radius: 3px; background: var(--surface-2); border: 1px solid var(--border); box-sizing: border-box; }
  .cell.blank { background: transparent; border-color: transparent; }
  .cell.l1 { background: color-mix(in srgb, var(--accent) 28%, var(--surface-2)); border-color: transparent; }
  .cell.l2 { background: color-mix(in srgb, var(--accent) 52%, var(--surface-2)); border-color: transparent; }
  .cell.l3 { background: color-mix(in srgb, var(--accent) 76%, var(--surface-2)); border-color: transparent; }
  .cell.l4 { background: var(--accent); border-color: transparent; }
  .cell.neg { border-color: var(--danger); }
  .legend { display: flex; align-items: center; justify-content: flex-end; gap: 3px; margin-top: 6px; font-size: 11px; color: var(--muted); }
  .legend .cell { width: 14px; }

  .actions { display: flex; align-items: center; gap: 8px; margin-top: 20px; }
  .grow { flex: 1; }
  .danger-text { color: var(--danger); }

  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
