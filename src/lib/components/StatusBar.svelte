<script lang="ts">
  import { tip } from '../tooltip.svelte';
  // 하단 상태 표시줄: 글자 수(공백 포함/제외 전환·선택 글자 수), 오늘 작성량(누르면 통계 창), 글별 목표 분량 진행 막대, 집중 모드 버튼.
  import { onMount, tick } from 'svelte';
  import Focus from '@lucide/svelte/icons/focus';
  import Target from '@lucide/svelte/icons/target';
  import WritingLayer from './WritingLayer.svelte';
  import { doc } from '../store.svelte';
  import { writing, setSpaces, toggleFocus } from '../writing/state.svelte';
  import { countChars } from '../writing/countChars';
  import { parseGoal, goalProgress, formatProgress, loadGoal, saveGoal } from '../writing/goal';
  import StatsDialog from './StatsDialog.svelte';
  import { stats, statsUi, trackDoc, startStats } from '../stats/state.svelte';
  import { summarize, signed } from '../stats/logic';

  const count = $derived(countChars(doc.content, { spaces: writing.spaces }));

  // 집필 통계: 글자 수 변화량을 오늘 날짜에 모은다. 글 식별자는 doc.key(글을 열 때마다 바뀜)라 글을 바꾸거나 다시 불러오면 기준값만 다시 잡는다.
  // 기준은 화면의 '공백 포함/제외' 설정과 무관하게 공백 제외로 고정한다(같은 계산 함수 countChars 사용)
  $effect(() => { trackDoc(doc.path ? String(doc.key) : null, countChars(doc.content, { spaces: false })); });
  onMount(startStats);
  const sum = $derived(summarize(stats.days, stats.today));
  const todayText = $derived(sum.today === 0 ? '오늘 0자' : sum.today > 0 ? `오늘 +${sum.today.toLocaleString('en-US')}자` : `−${Math.abs(sum.today).toLocaleString('en-US')}자`);
  let statsOpen = $state(false);
  $effect(() => { if (statsUi.open) { statsUi.open = false; statsOpen = true; } }); // 명령 팔레트의 '집필 통계'(단추가 숨는 좁은 화면용)

  let goal = $state<number | null>(null);
  let editing = $state(false);
  let draft = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  // 문서가 바뀌면 그 문서의 목표를 불러온다
  $effect(() => {
    goal = loadGoal(doc.path);
    editing = false;
  });

  const progress = $derived(goalProgress(count, goal));

  async function startEdit() {
    draft = goal ? String(goal) : '';
    editing = true;
    await tick();
    inputEl?.select();
  }
  function commit() {
    if (!editing) return;
    editing = false;
    goal = parseGoal(draft);
    saveGoal(doc.path, goal);
  }
  function onInputKey(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = false; }
  }
</script>

<WritingLayer />

{#if doc.path}
  <footer class="statusbar" aria-label="집필 상태">
    <button
      onclick={() => setSpaces(!writing.spaces)}
      aria-label={`글자 수 ${count.toLocaleString('en-US')}자, ${writing.spaces ? '공백 포함' : '공백 제외'}. 누르면 ${writing.spaces ? '공백 제외' : '공백 포함'}로 전환`}
      use:tip={'글자 수 기준 전환 (공백 포함 / 제외)'}
    >{count.toLocaleString('en-US')}자 · {writing.spaces ? '공백 포함' : '공백 제외'}</button>
    {#if writing.selection > 0}<span class="sb-sel" aria-live="polite">선택 {writing.selection.toLocaleString('en-US')}자</span>{/if}
    <button class="sb-stat" onclick={() => (statsOpen = true)} aria-haspopup="dialog" aria-label={`오늘 작성량 ${signed(sum.today)}자${sum.streak >= 2 ? `, ${sum.streak}일째 연속 작성` : ''}. 누르면 집필 통계`} use:tip={'집필 통계 보기'}>{todayText}{#if sum.streak >= 2} · {sum.streak}일째{/if}</button>
    <span class="spacer"></span>
    <span class="sb-goal">
      {#if editing}
        <input
          bind:this={inputEl}
          bind:value={draft}
          inputmode="numeric"
          placeholder="목표 글자 수 (비우면 없음)"
          aria-label="목표 글자 수"
          style:width="180px"
          onkeydown={onInputKey}
          onblur={commit}
        />
      {:else}
        <button onclick={startEdit} aria-label={goal ? `목표 분량 ${goal.toLocaleString('en-US')}자 수정` : '목표 분량 설정'} use:tip={'목표 분량 설정 (비우면 없음)'}>
          <Target size={13} />{#if goal}{formatProgress(count, goal)}{:else}목표{/if}
        </button>
        {#if progress}
          <span class="sb-bar" class:reached={progress.reached} role="progressbar" aria-label="목표 진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(100, progress.percent)}>
            <span style:width="{progress.ratio * 100}%"></span>
          </span>
          <span>{progress.percent}%</span>
        {/if}
      {/if}
    </span>
    <button onclick={() => toggleFocus()} aria-label="집중 모드" aria-pressed={writing.focus} use:tip={'집중 모드 (Ctrl+Alt+Enter, Esc 로 해제)'}>
      <Focus size={14} />집중
    </button>
  </footer>
{/if}

<StatsDialog bind:open={statsOpen} />

<style>
  /* 폭이 좁으면 가장 먼저 숨긴다(모바일은 글자 수·목표·집중 단추 우선) */
  .sb-stat { white-space: nowrap; min-width: 0; }
  @media (max-width: 720px) { .sb-stat { display: none !important; } }
</style>
