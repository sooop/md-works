<script lang="ts">
  // 왼쪽 사이드바의 휴지통 보기(서버·스탠드얼론 공용). 데이터는 TrashCtl 로만 다룬다.
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import FileText from '@lucide/svelte/icons/file-text';
  import Folder from '@lucide/svelte/icons/folder';
  import X from '@lucide/svelte/icons/x';
  import { tip } from '../tooltip.svelte';
  import { askConfirm, toast, errMsg } from '../store.svelte';
  import { listFx, flipFx, LIST_FX_MAX } from '../motion';
  import { TRASH_DAYS, restoreMessage, trashFolder, trashLabel, trashWhen, type TrashCtl, type TrashItem } from '../trash';

  interface Props {
    ctl: TrashCtl;
    /** '← 파일 목록' */
    onBack: () => void;
  }
  let { ctl, onBack }: Props = $props();

  let items = $state<TrashItem[]>([]);
  let loaded = $state(false);
  let loading = $state(true);
  let error = $state('');
  let busy = $state(false);
  let picked = $state<string[]>([]);
  let now = $state(Date.now());
  let seq = 0;

  const fxOff = $derived(items.length > LIST_FX_MAX);
  const docsOf = (list: TrashItem[]) => list.reduce((n, i) => n + i.docs, 0);
  const byId = (ids: string[]) => items.filter((i) => ids.includes(i.id));
  const allPicked = $derived(items.length > 0 && picked.length === items.length);

  /** 목록을 읽는다. quiet: 다른 탭의 변경을 받아 다시 읽을 때(불러오는 중 표시·오류 표시를 하지 않는다) */
  async function load(quiet = false) {
    const mine = ++seq;
    if (!quiet) { loading = true; error = ''; }
    try {
      const r = await ctl.list();
      if (mine !== seq) return;
      items = r;
      error = '';
      now = Date.now();
      picked = picked.filter((id) => r.some((i) => i.id === id));
    } catch (e) {
      if (mine !== seq) return;
      if (!quiet || !loaded) error = errMsg(e);
    } finally {
      if (mine === seq) { loading = false; loaded = true; }
    }
  }

  onMount(() => {
    void load();
    const unsub = ctl.subscribe?.(() => void load(true));
    const tick = setInterval(() => { now = Date.now(); }, 60_000); // '3분 전' 같은 상대 시각을 갱신한다
    return () => { unsub?.(); clearInterval(tick); };
  });

  function toggle(id: string) { picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]; }
  const toggleAll = () => { picked = allPicked ? [] : items.map((i) => i.id); };

  async function restore(list: TrashItem[]) {
    if (!list.length || busy) return;
    busy = true;
    try {
      const r = await ctl.restore(list.map((i) => i.id));
      const m = restoreMessage(list, r);
      toast(m.text, m.kind);
      picked = picked.filter((id) => !list.some((i) => i.id === id));
    } catch (e) {
      toast(`복구하지 못했습니다: ${errMsg(e)}`, 'error');
    } finally {
      busy = false;
    }
    await load(true);
  }

  const what = (list: TrashItem[]) => {
    if (list.length === 1) {
      const it = list[0];
      return it.type === 'dir' ? (it.docs ? `폴더 '${trashLabel(it)}' 와 그 안의 글 ${it.docs}개` : `빈 폴더 '${trashLabel(it)}'`) : `'${trashLabel(it)}' 글`;
    }
    const n = docsOf(list);
    return `선택한 ${list.length}개 항목(글 ${n}개)`;
  };

  async function purge(list: TrashItem[], okMsg: (n: number) => string, message = `${what(list)}를 완전히 삭제할까요? 되돌릴 수 없습니다.`, label = '삭제') {
    if (!list.length || busy) return;
    if (!(await askConfirm(message, label, true))) return;
    busy = true;
    try {
      await ctl.purge(list.map((i) => i.id));
      toast(okMsg(list.length));
      picked = picked.filter((id) => !list.some((i) => i.id === id));
    } catch (e) {
      toast(`완전히 삭제하지 못했습니다: ${errMsg(e)}`, 'error');
    } finally {
      busy = false;
    }
    await load(true);
  }

  const purgeItems = (list: TrashItem[]) => purge(list, (n) => (n === 1 ? `완전히 삭제했습니다: ${trashLabel(list[0])}` : `${n}개를 완전히 삭제했습니다`));

  async function emptyAll() {
    if (!items.length || busy) return;
    const list = [...items];
    if (!(await askConfirm(`휴지통을 비울까요? 항목 ${list.length}개(글 ${docsOf(list)}개)가 완전히 삭제되며 되돌릴 수 없습니다.`, '비우기', true))) return;
    busy = true;
    try {
      await ctl.empty();
      toast('휴지통을 비웠습니다');
      picked = [];
    } catch (e) {
      toast(`휴지통을 비우지 못했습니다: ${errMsg(e)}`, 'error');
    } finally {
      busy = false;
    }
    await load(true);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && picked.length && !e.defaultPrevented) { e.preventDefault(); picked = []; }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="trashpanel" onkeydown={onKey}>
  <div class="tp-bar">
    <button class="tp-back" onclick={onBack} aria-label="파일 목록으로 돌아가기" use:tip={'파일 목록으로 돌아가기'}><ArrowLeft size={15} /> 파일 목록</button>
    <span class="tp-title">휴지통</span>
    <span class="spacer"></span>
    <button class="tp-empty" disabled={!items.length || busy} onclick={() => void emptyAll()} use:tip={{ title: '휴지통 비우기', lines: ['모든 항목을 완전히 삭제합니다'] }}>비우기</button>
  </div>
  <p class="tp-note">삭제한 글은 {TRASH_DAYS}일 동안 보관한 뒤 자동으로 지웁니다.</p>

  {#if picked.length}
    <div class="selbar" role="toolbar" aria-label="선택한 항목 일괄 작업">
      <span>{picked.length}개 선택</span>
      <span class="spacer"></span>
      <button disabled={busy} onclick={() => void restore(byId(picked))}><Undo2 size={14} /> 복구</button>
      <button class="danger" disabled={busy} onclick={() => void purgeItems(byId(picked))}><Trash2 size={14} /> 완전 삭제</button>
      <button class="icon-btn" aria-label="선택 해제" use:tip={'선택 해제'} onclick={() => (picked = [])}><X size={15} /></button>
    </div>
  {:else if items.length > 1}
    <label class="tp-all"><input type="checkbox" checked={allPicked} onchange={toggleAll} /> 전체 선택</label>
  {/if}

  {#if loading && !loaded}
    <p class="tp-empty-msg" role="status">불러오는 중…</p>
  {:else if error}
    <div class="tp-empty-msg err" role="alert">
      <p>휴지통을 불러오지 못했습니다: {error}</p>
      <button onclick={() => void load()}>다시 시도</button>
    </div>
  {:else if !items.length}
    <p class="tp-empty-msg">휴지통이 비어 있습니다. 삭제한 글과 폴더는 여기에 {TRASH_DAYS}일 동안 보관됩니다.</p>
  {:else}
    <ul class="tp-list" aria-label="휴지통 항목">
      {#each items as it (it.id)}
        {@const folder = trashFolder(it)}
        <li class="tp-item" class:picked={picked.includes(it.id)} animate:flip={flipFx(fxOff)} transition:listFx={{ off: fxOff }}>
          <input type="checkbox" class="tp-check" checked={picked.includes(it.id)} onchange={() => toggle(it.id)} aria-label={`${trashLabel(it)} 선택`} />
          <span class="tp-icon" aria-hidden="true">{#if it.type === 'dir'}<Folder size={16} />{:else}<FileText size={16} />{/if}</span>
          <div class="tp-body">
            <span class="tp-name" title={trashLabel(it)}>{trashLabel(it)}</span>
            <span class="tp-meta">{folder ? folder : '최상위'}{#if it.type === 'dir'} · 글 {it.docs}개{/if}</span>
            <span class="tp-meta">{trashWhen(it.deletedAt, now)}</span>
          </div>
          <span class="tp-ops">
            <button class="icon-btn" disabled={busy} aria-label={`${trashLabel(it)} 복구`} use:tip={{ title: '복구', lines: ['원래 위치로 되돌립니다'] }} onclick={() => void restore([it])}><Undo2 size={16} /></button>
            <button class="icon-btn danger" disabled={busy} aria-label={`${trashLabel(it)} 완전 삭제`} use:tip={{ title: '완전 삭제', lines: ['되돌릴 수 없습니다'] }} onclick={() => void purgeItems([it])}><Trash2 size={16} /></button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .trashpanel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .tp-bar { display: flex; align-items: center; gap: 6px; padding: 8px 8px 0; }
  .tp-back {
    display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; color: var(--muted);
    font-size: 13px; padding: 4px 8px 4px 4px; border-radius: 6px;
  }
  .tp-back:hover { background: var(--hover); color: var(--text); }
  .tp-title { font-size: 13px; font-weight: 600; }
  .spacer { flex: 1; }
  .tp-empty {
    font-size: 12px; padding: 3px 8px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--bg); color: var(--text); cursor: pointer;
    transition: background-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
  }
  .tp-empty:hover:not(:disabled) { color: var(--danger); border-color: var(--danger); }
  .tp-empty:disabled { opacity: .5; cursor: default; }
  .tp-note { margin: 6px 12px 4px; color: var(--muted); font-size: 12px; }
  .tp-all { display: flex; align-items: center; gap: 6px; margin: 2px 12px 0; color: var(--muted); font-size: 12px; cursor: pointer; }
  .tp-all input, .tp-check { width: auto; margin: 0; padding: 0; flex: none; }
  .tp-empty-msg { color: var(--muted); padding: 12px; font-size: 13px; margin: 0; }
  .tp-empty-msg.err { color: var(--danger); display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .tp-empty-msg.err p { margin: 0; overflow-wrap: anywhere; }
  .tp-list { flex: 1; overflow: auto; list-style: none; margin: 0; padding: 6px 4px 16px; }
  .tp-item {
    display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border-radius: 6px;
    transition: background-color var(--dur-1) var(--ease-out);
  }
  .tp-item:hover, .tp-item:focus-within { background: var(--hover); }
  .tp-item.picked { background: var(--selected); }
  .tp-check { margin-top: 3px; }
  .tp-icon { flex: none; display: inline-flex; margin-top: 1px; color: var(--muted); }
  .tp-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .tp-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tp-meta { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tp-ops { flex: none; display: inline-flex; gap: 2px; }
  .tp-ops .icon-btn { padding: 3px 5px; }
  .tp-ops .icon-btn.danger:hover:not(:disabled) { color: var(--danger); }
  .tp-ops .icon-btn:disabled { opacity: .5; }
  @media (max-width: 720px) {
    .tp-ops .icon-btn { padding: 8px; }
    .tp-empty { padding: 6px 10px; }
  }
</style>
