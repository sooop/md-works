<script lang="ts">
  // ⋯ 메뉴: 작업(이력) → 내보내기 → 문서 도구 → 앱(설정·백업) 순. 모든 항목에 아이콘을 붙이고, 드물게 쓰는 것은 접는 하위 메뉴로 둔다.
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Check from '@lucide/svelte/icons/check';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import History from '@lucide/svelte/icons/history';
  import Download from '@lucide/svelte/icons/download';
  import FileDown from '@lucide/svelte/icons/file-down';
  import Copy from '@lucide/svelte/icons/copy';
  import FileType from '@lucide/svelte/icons/file-type';
  import Printer from '@lucide/svelte/icons/printer';
  import Wrench from '@lucide/svelte/icons/wrench';
  import ImageDown from '@lucide/svelte/icons/image-down';
  import ImageUp from '@lucide/svelte/icons/image-up';
  import FilePlus2 from '@lucide/svelte/icons/file-plus-2';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import DatabaseBackup from '@lucide/svelte/icons/database-backup';
  import Command from '@lucide/svelte/icons/command';
  import { openPalette } from '../commands/registry.svelte';
  import { tip } from '../tooltip.svelte';
  import { popFx, slideFx } from '../motion';
  interface Props {
    /** 열린 문서가 있는가 — 없으면 문서 관련 항목(이력·내보내기·도구)을 숨긴다 */
    hasDoc: boolean;
    onSettings: () => void;
    onBackup: () => void;
    /** 백업한 지 오래됨 — 메뉴 아이콘에 점을 찍어 알린다 */
    backupStale?: boolean;
    onHistory: () => void;
    onDocx: () => void;
    onPrint?: () => void;
    onMd?: () => void;
    onCopyMd?: () => void;
    /** 서버 모드: 문서의 이미지를 Base64 ↔ 파일로 바꾸는 항목 */
    onImages?: (to: 'base64' | 'file') => void;
    /** docx 템플릿 선택지 (id '' 는 기본 템플릿) */
    options: { id: string; label: string }[];
    selected: string;
    onSelect: (id: string) => void;
    /** 메뉴를 열 때 호출 (템플릿 목록 새로고침 등) */
    onOpen?: () => void;
    hint?: string;
    actions?: { label: string; run: () => void }[];
  }
  let { hasDoc, onSettings, onBackup, backupStale = false, onHistory, onDocx, onPrint, onMd, onCopyMd, onImages, options, selected, onSelect, onOpen, hint = '', actions = [] }: Props = $props();

  let open = $state(false);
  let sub = $state<'' | 'export' | 'tools'>(''); // 펼친 하위 메뉴(하나만)

  function toggle() {
    open = !open;
    if (open) { sub = ''; onOpen?.(); }
  }
  function run(fn: () => void) {
    open = false;
    fn();
  }
  const flip = (k: 'export' | 'tools') => { sub = sub === k ? '' : k; };
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') open = false; }} />

<div class="menu">
  <button class="icon-btn menu-btn" onclick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label="메뉴" use:tip={backupStale ? { title: '메뉴', lines: ['백업한 지 오래됐습니다'] } : '메뉴 (이력·내보내기·설정·백업)'}>
    <Ellipsis size={18} />{#if backupStale}<span class="stale-dot" aria-hidden="true"></span>{/if}
  </button>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={() => (open = false)}></div>
    <div class="popover menu-list" role="menu" transition:popFx>
      <button role="menuitem" class="mi" onclick={() => run(openPalette)}><Command size={16} /><span class="t">명령 팔레트</span><kbd>Ctrl+K</kbd></button>
      <hr />
      {#if hasDoc}
        <button role="menuitem" class="mi" onclick={() => run(onHistory)}><History size={16} /><span class="t">이전 버전 (이력)</span></button>

        <button role="menuitem" class="mi" aria-expanded={sub === 'export'} onclick={() => flip('export')}>
          <Download size={16} /><span class="t">내보내기</span>{#if sub === 'export'}<ChevronDown size={14} class="chev" />{:else}<ChevronRight size={14} class="chev" />{/if}
        </button>
        {#if sub === 'export'}
          <div class="subgroup" role="group" aria-label="내보내기" transition:slideFx>
            {#if onMd}<button role="menuitem" class="mi" onclick={() => run(onMd)}><FileDown size={15} /><span class="t">.md 파일로 저장</span></button>{/if}
            {#if onCopyMd}<button role="menuitem" class="mi" onclick={() => run(onCopyMd)}><Copy size={15} /><span class="t">마크다운 텍스트 복사</span></button>{/if}
            <button role="menuitem" class="mi" onclick={() => run(onDocx)}><FileType size={15} /><span class="t">.docx 로 내보내기</span></button>
            {#if onPrint}<button role="menuitem" class="mi" onclick={() => run(onPrint)}><Printer size={15} /><span class="t">인쇄 …</span></button>{/if}
          </div>
        {/if}

        <button role="menuitem" class="mi" aria-expanded={sub === 'tools'} onclick={() => flip('tools')}>
          <Wrench size={16} /><span class="t">문서 도구</span>{#if sub === 'tools'}<ChevronDown size={14} class="chev" />{:else}<ChevronRight size={14} class="chev" />{/if}
        </button>
        {#if sub === 'tools'}
          <div class="subgroup" role="group" aria-label="문서 도구" transition:slideFx>
            {#if onImages}
              <button role="menuitem" class="mi" onclick={() => run(() => onImages('base64'))}><ImageDown size={15} /><span class="t">이미지를 Base64로 변환</span></button>
              <button role="menuitem" class="mi" onclick={() => run(() => onImages('file'))}><ImageUp size={15} /><span class="t">이미지를 파일로 분리</span></button>
            {/if}
            <span class="label">DOCX 서식 템플릿</span>
            {#each options as o (o.id)}
              <button role="menuitemradio" aria-checked={selected === o.id} class="mi" class:active={selected === o.id} onclick={() => onSelect(o.id)}>
                <span class="ck">{#if selected === o.id}<Check size={14} />{/if}</span><span class="t">{o.label}</span>
              </button>
            {/each}
            {#each actions as a (a.label)}
              <button role="menuitem" class="mi" onclick={() => run(a.run)}><FilePlus2 size={15} /><span class="t">{a.label}</span></button>
            {/each}
            {#if hint}<p class="menu-hint">{hint}</p>{/if}
          </div>
        {/if}
        <hr />
      {/if}
      <button role="menuitem" class="mi" onclick={() => run(onSettings)}><SettingsIcon size={16} /><span class="t">설정</span></button>
      <button role="menuitem" class="mi" onclick={() => run(onBackup)}>
        <DatabaseBackup size={16} /><span class="t">백업 · 가져오기</span>{#if backupStale}<span class="stale-note">백업 필요</span>{/if}
      </button>
    </div>
  {/if}
</div>

<style>
  .menu-btn { position: relative; }
  .stale-dot { position: absolute; top: 3px; right: 5px; width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
  .stale-note { color: var(--danger); font-size: 11.5px; margin-left: auto; }
  .mi { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 7px 10px; border-radius: 8px; }
  .mi :global(svg) { flex: none; color: var(--muted); }
  .mi:hover :global(svg) { color: var(--text); }
  .mi .t { flex: 1; min-width: 0; }
  .mi :global(.chev) { margin-left: auto; }
  .mi kbd { font: inherit; font-size: 11px; padding: 1px 6px; border-radius: 5px; border: 1px solid var(--border-strong); color: var(--muted); }
  .subgroup { display: flex; flex-direction: column; gap: 1px; margin: 0 0 4px 14px; padding-left: 8px; border-left: 2px solid var(--border); }
  .subgroup .mi { padding: 5px 8px; font-size: 13px; }
  .ck { width: 15px; flex: none; color: var(--primary); display: inline-flex; }
  .subgroup .label { padding: 6px 8px 2px; }
  .menu-hint { margin: 4px 8px 2px; font-size: 12px; color: var(--muted); word-break: break-all; }
</style>
