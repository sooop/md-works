<script lang="ts">
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Check from '@lucide/svelte/icons/check';
  import { tip } from '../tooltip.svelte';
  interface Props {
    /** 열린 문서가 있는가 — 없으면 문서 관련 항목(이력·내보내기·템플릿)을 숨긴다 */
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

  function toggle() {
    open = !open;
    if (open) onOpen?.();
  }
  function run(fn: () => void) {
    open = false;
    fn();
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') open = false; }} />

<div class="menu">
  <button class="icon-btn menu-btn" onclick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label="메뉴" use:tip={backupStale ? { title: '메뉴', lines: ['백업한 지 오래됐습니다'] } : '메뉴 (패널·이력·내보내기·설정·백업)'}>
    <Ellipsis size={18} />{#if backupStale}<span class="stale-dot" aria-hidden="true"></span>{/if}
  </button>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={() => (open = false)}></div>
    <div class="popover menu-list" role="menu">
      {#if hasDoc}
      <button role="menuitem" onclick={() => run(onHistory)}>이전 버전 보기 (이력)</button>
      {#if onImages}
        <hr />
        <span class="label">이미지</span>
        <button role="menuitem" onclick={() => run(() => onImages('base64'))}>이 문서의 이미지를 Base64로 변환</button>
        <button role="menuitem" onclick={() => run(() => onImages('file'))}>이 문서의 이미지를 파일로 분리</button>
      {/if}
      <hr />
      <span class="label">내보내기</span>
      {#if onMd}<button role="menuitem" onclick={() => run(onMd)}>.md 파일로 내려받기</button>{/if}
      {#if onCopyMd}<button role="menuitem" onclick={() => run(onCopyMd)}>마크다운 텍스트 복사</button>{/if}
      <button role="menuitem" onclick={() => run(onDocx)}>.docx 로 내보내기</button>
      {#if onPrint}<button role="menuitem" onclick={() => run(onPrint)}>인쇄 …</button>{/if}
      <hr />
      <span class="label">DOCX 서식 템플릿</span>
      {#each options as o (o.id)}
        <button role="menuitemradio" aria-checked={selected === o.id} class:active={selected === o.id} onclick={() => onSelect(o.id)}>
          <span class="check">{#if selected === o.id}<Check size={14} />{/if}</span>{o.label}
        </button>
      {/each}
      {#each actions as a (a.label)}
        <button role="menuitem" onclick={() => run(a.run)}>{a.label}</button>
      {/each}
      {#if hint}<p class="menu-hint">{hint}</p>{/if}
      {/if}
      <hr />
      <button role="menuitem" onclick={() => run(onSettings)}>설정 …</button>
      <button role="menuitem" onclick={() => run(onBackup)}>백업 · 가져오기{#if backupStale}<span class="stale-note"> · 백업 필요</span>{/if}</button>
    </div>
  {/if}
</div>

<style>
  .menu-btn { position: relative; }
  .stale-dot { position: absolute; top: 3px; right: 5px; width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
  .stale-note { color: var(--danger); font-size: 12px; }
</style>
