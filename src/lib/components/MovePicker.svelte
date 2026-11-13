<script lang="ts">
  // '이동…' 대상 폴더 고르기: 최상위 + 모든 폴더를 들여쓰기로 보이고 하나를 고른다. 자기 자신·자기 하위·현재 위치는 비활성(여러 항목이면 하나라도 해당하는 자기 하위, 전부 이미 있는 현재 위치).
  // 키: ↑/↓(비활성은 건너뜀, 끝에서 돌아감)·Home/End·Enter·Esc(닫고 연 요소로 포커스 복귀)·Tab(닫기). 바깥 클릭·창 전환으로 닫는다.
  import { onMount } from 'svelte';
  import Folder from '@lucide/svelte/icons/folder';
  import Home from '@lucide/svelte/icons/house';
  import { popFx } from '../motion';
  import { stepEnabled, edgeEnabled, type MoveTarget } from '../treeKeys';

  interface Props {
    /** 옮길 항목의 이름(제목에 보인다). 여럿이면 첫 항목의 이름 */
    name: string;
    /** 옮길 항목 수(2 이상이면 제목이 '선택한 N개' 로 바뀐다) */
    count?: number;
    targets: MoveTarget[];
    x: number;
    y: number;
    /** 닫을 때 포커스를 돌려줄 요소 */
    from?: HTMLElement | null;
    onPick: (destDir: string) => void;
    onClose: () => void;
  }
  let { name, count = 1, targets, x, y, from = null, onPick, onClose }: Props = $props();
  const what = $derived(count > 1 ? `선택한 ${count}개` : `'${name}'`);

  let el = $state<HTMLElement>();
  let pos = $state({ left: 0, top: 0 });

  const buttons = () => [...(el?.querySelectorAll<HTMLButtonElement>('button[data-i]') ?? [])];
  const focusAt = (i: number) => buttons().find((b) => Number(b.dataset.i) === i)?.focus();

  onMount(() => {
    const pad = 8;
    if (el) {
      pos = {
        left: Math.max(pad, Math.min(x, innerWidth - el.offsetWidth - pad)),
        top: Math.max(pad, Math.min(y, innerHeight - el.offsetHeight - pad)),
      };
    }
    focusAt(edgeEnabled(targets));
  });

  function close(restore: boolean) {
    onClose();
    if (restore) from?.focus();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === 'Tab') { e.preventDefault(); close(true); return; }
    if (e.isComposing || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const cur = Number((document.activeElement as HTMLElement | null)?.dataset?.i ?? -1);
    const to = e.key === 'Home' ? edgeEnabled(targets) : e.key === 'End' ? edgeEnabled(targets, true) : stepEnabled(targets, cur, e.key === 'ArrowDown' ? 1 : -1);
    if (to >= 0) focusAt(to);
  }
</script>

<svelte:window onkeydowncapture={onKey} onblur={() => close(false)} onresize={() => close(false)} onpointerdowncapture={(e) => { if (!el?.contains(e.target as Node)) close(false); }} />

<div bind:this={el} class="mv-pop" role="dialog" aria-label="{what} 옮길 위치" tabindex="-1" transition:popFx style:left="{pos.left}px" style:top="{pos.top}px">
  <p class="mv-title">{what} 옮길 위치</p>
  <div class="mv-list" role="menu">
    {#each targets as t, i (t.path)}
      <button role="menuitem" class="mv-row" data-i={i} disabled={t.disabled} style:padding-left="{10 + t.depth * 14}px" onclick={() => { onClose(); onPick(t.path); }}>
        {#if t.path === ''}<Home size={15} />{:else}<Folder size={15} />{/if}
        <span class="mv-name">{t.label}</span>
        {#if t.note}<small>{t.note}</small>{/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .mv-pop {
    position: fixed; z-index: 91; width: min(280px, calc(100vw - 16px)); max-height: min(60vh, 380px); display: flex; flex-direction: column;
    padding: 4px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: var(--shadow);
    -webkit-touch-callout: none;
  }
  .mv-title { margin: 0; padding: 6px 10px 4px; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mv-list { overflow: auto; display: flex; flex-direction: column; gap: 1px; }
  .mv-row { display: flex; align-items: center; gap: 6px; text-align: left; border: 0; background: transparent; padding: 6px 10px; border-radius: 6px; min-height: 32px; }
  .mv-row :global(svg) { flex: none; color: var(--muted); }
  .mv-row:disabled { opacity: 0.45; cursor: default; }
  .mv-row:disabled:hover { background: transparent; }
  .mv-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mv-row small { flex: none; font-size: 11px; color: var(--muted); }
  .mv-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
