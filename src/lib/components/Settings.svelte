<script lang="ts">
  // 설정 창: 가운데에 크게 띄우고 왼쪽에 분류, 오른쪽에 그 분류의 항목. 위쪽 검색으로 모든 분류의 항목을 찾는다.
  // 변경은 즉시 적용·저장된다. 테마 편집기는 '디자인' 분류에서 연다.
  import { tick } from 'svelte';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import Monitor from '@lucide/svelte/icons/monitor';
  import PenLine from '@lucide/svelte/icons/pen-line';
  import StickyNote from '@lucide/svelte/icons/sticky-note';
  import DatabaseBackup from '@lucide/svelte/icons/database-backup';
  import Palette from '@lucide/svelte/icons/palette';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import MonitorCog from '@lucide/svelte/icons/monitor-cog';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Check from '@lucide/svelte/icons/check';
  import {
    settings, persistSettings, applyTheme,
    type Theme, type ImageMode,
  } from '../store.svelte';
  import { design, setTypo, selectPreset } from '../design/state.svelte';
  import { TYPO_SPEC, DEFAULT_TYPOGRAPHY, type NumSpec } from '../design/schema';
  import { PRESETS } from '../design/presets';
  import { writing, setSpaces } from '../writing/state.svelte';
  import { backupUi, lastBackupAt, ago, hasUnbacked, isStale } from '../bundle/backupState.svelte';
  import { tip } from '../tooltip.svelte';
  import DesignEditor from './DesignEditor.svelte';
  import DesignPreview from './DesignPreview.svelte';

  let { server = false, trigger = true, open = $bindable(false) }: { server?: boolean; trigger?: boolean; open?: boolean } = $props();

  const FONT = TYPO_SPEC.fontSize as NumSpec;
  const WIDTH = TYPO_SPEC.contentWidth as NumSpec;

  type Cat = 'view' | 'write' | 'snippet' | 'save' | 'design';
  const cats: { id: Cat; label: string; icon: typeof Monitor }[] = [
    { id: 'view', label: '화면', icon: Monitor },
    { id: 'write', label: '글쓰기', icon: PenLine },
    { id: 'snippet', label: '글감', icon: StickyNote },
    { id: 'save', label: '저장과 백업', icon: DatabaseBackup },
    { id: 'design', label: '디자인', icon: Palette },
  ];
  let active = $state<Cat>('view');
  let q = $state('');
  let searchEl = $state<HTMLInputElement>();

  // 검색에 걸릴 항목(분류 · 이름 · 설명에 들어 있는 낱말). 서버 전용 항목은 서버 모드에서만 센다.
  const rows: { id: string; cat: Cat; text: string; server?: boolean }[] = [
    { id: 'theme', cat: 'view', text: '테마 라이트 다크 시스템 밝기 색 화면' },
    { id: 'fontSize', cat: 'view', text: '글자 크기 폰트 서체 크기 본문' },
    { id: 'width', cat: 'view', text: '본문 폭 너비 넓이 가로 창 폭' },
    { id: 'count', cat: 'write', text: '글자 수 공백 포함 제외 상태 표시줄 세기' },
    { id: 'tablefmt', cat: 'write', text: '표 복사 형식 tsv csv 탭 쉼표 엑셀 기본 복사' },
    { id: 'image', cat: 'write', text: '이미지 삽입 방식 파일 assets base64 붙여넣기', server: true },
    { id: 'colors', cat: 'snippet', text: '글감 색 색상 라벨 필터 포스트잇' },
    { id: 'autosave', cat: 'save', text: '자동 저장 저장 입력 후', server: true },
    { id: 'backup', cat: 'save', text: '백업 가져오기 내보내기 번들 텔레그램 복원' },
    { id: 'preset', cat: 'design', text: '디자인 프리셋 팔레트 색상 테마 모음' },
    { id: 'editor', cat: 'design', text: '디자인 편집기 서체 간격 제목 인용 코드 표 색 직접 편집 불러오기 내보내기' },
  ];
  const needle = $derived(q.trim().toLowerCase());
  const matches = (id: string) => {
    const r = rows.find((x) => x.id === id);
    if (!r || (r.server && !server)) return false;
    return !needle || `${cats.find((c) => c.id === r.cat)?.label} ${r.text}`.toLowerCase().includes(needle);
  };
  const catShown = (c: Cat) => (needle ? rows.some((r) => r.cat === c && matches(r.id)) : active === c);
  const hitCount = $derived(needle ? rows.filter((r) => matches(r.id)).length : 0);
  /** 디자인 분류가 보이는 동안만, 설정 창 옆에 미리보기 섬을 띄운다 */
  const island = $derived(catShown('design'));

  const themes: { id: Theme; label: string; icon: typeof Sun }[] = [
    { id: 'system', label: '시스템', icon: MonitorCog },
    { id: 'light', label: '라이트', icon: Sun },
    { id: 'dark', label: '다크', icon: Moon },
  ];
  const modes: [ImageMode, string, string][] = [
    ['file', '파일로 분리', '노트 폴더의 assets 폴더에 이미지 파일로 저장'],
    ['base64', '문서에 포함', 'Base64 로 문서 안에 넣어 글 하나로 유지'],
  ];

  function setTheme(t: Theme) { settings.theme = t; applyTheme(); persistSettings(); }
  function setMode(m: ImageMode) { settings.imageMode = m; persistSettings(); }
  function toggleAutosave() { settings.autosave = !settings.autosave; persistSettings(); }
  function setTableFmt(f: 'tsv' | 'csv') { settings.tableCopyFormat = f; persistSettings(); }
  function toggleColors() { settings.snippetColors = !settings.snippetColors; persistSettings(); }

  // 글자 크기·본문 폭은 디자인 설정('works.design')에 저장된다
  const setFont = (e: Event) => setTypo('fontSize', Number((e.currentTarget as HTMLInputElement).value));
  const setWidth = (e: Event) => setTypo('contentWidth', Number((e.currentTarget as HTMLInputElement).value));
  const toggleFullWidth = () => setTypo('contentWidth', design.typography.contentWidth > 0 ? 0 : DEFAULT_TYPOGRAPHY.contentWidth);
  function resetLayout() {
    setTypo('fontSize', DEFAULT_TYPOGRAPHY.fontSize);
    setTypo('contentWidth', DEFAULT_TYPOGRAPHY.contentWidth);
  }
  function openBackup() { open = false; backupUi.open = true; }

  const backupLine = $derived(
    lastBackupAt() ? `마지막 백업 ${ago(lastBackupAt())}${hasUnbacked() ? ' · 이후 변경이 있습니다' : ' · 최신 상태입니다'}` : '아직 백업한 적이 없습니다',
  );

  // 열릴 때 검색 칸에 포커스, 분류는 처음으로
  $effect(() => {
    if (!open) return;
    q = '';
    void tick().then(() => searchEl?.focus());
  });

  // 현재 모드(라이트/다크)의 프리셋 색 견본
  const dark = $derived(typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark');
</script>

<svelte:window onkeydown={(e) => { if (open && e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); open = false; } }} />

{#if trigger}<button class="icon-btn" aria-label="설정" aria-expanded={open} onclick={() => (open = !open)}><SettingsIcon size={18} /></button>{/if}

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) open = false; }}>
   <div class="sw-stage" class:island onclick={(e) => { if (e.target === e.currentTarget) open = false; }}>
    <div class="sw" role="dialog" aria-modal="true" aria-label="설정">
      <header class="sw-head">
        <h2><SettingsIcon size={18} /> 설정</h2>
        <div class="sw-search">
          <Search size={15} />
          <input bind:this={searchEl} bind:value={q} placeholder="설정 검색" aria-label="설정 검색" spellcheck="false" />
          {#if q}<button class="icon-btn" aria-label="검색어 지우기" use:tip={'지우기'} onclick={() => { q = ''; searchEl?.focus(); }}><X size={14} /></button>{/if}
        </div>
        <button class="icon-btn sw-close" aria-label="설정 닫기" use:tip={{ title: '닫기', kbd: 'Esc' }} onclick={() => (open = false)}><X size={18} /></button>
      </header>

      <div class="sw-body">
        <div class="sw-nav" role="tablist" aria-label="설정 분류">
          {#each cats as c (c.id)}
            <button role="tab" aria-selected={!needle && active === c.id} class:on={!needle && active === c.id} class:has={needle && catShown(c.id)} onclick={() => { q = ''; active = c.id; }}>
              <c.icon size={17} /><span>{c.label}</span>
            </button>
          {/each}
        </div>

        <div class="sw-main">
          {#if needle && !hitCount}
            <p class="sw-none">'{q}' 와 맞는 설정이 없습니다.</p>
          {/if}

          {#if catShown('view')}
            <section>
              <h3><Monitor size={16} /> 화면</h3>
              {#if matches('theme')}
                <div class="srow col">
                  <div class="s-text"><b>테마</b><small>앱 전체의 밝기. 시스템은 운영체제 설정을 따릅니다.</small></div>
                  <div class="cards" role="radiogroup" aria-label="테마">
                    {#each themes as t (t.id)}
                      <button role="radio" aria-checked={settings.theme === t.id} class="card" class:on={settings.theme === t.id} onclick={() => setTheme(t.id)}>
                        <t.icon size={20} /><span>{t.label}</span>{#if settings.theme === t.id}<Check size={14} class="ck" />{/if}
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
              {#if matches('fontSize')}
                <div class="srow">
                  <div class="s-text"><b>글자 크기</b><small>본문 글자의 크기. 제목은 이 크기에 비례합니다.</small></div>
                  <div class="s-ctl"><input type="range" min={FONT.min} max={FONT.max} step="1" value={design.typography.fontSize} oninput={setFont} aria-label="글자 크기" /><output>{design.typography.fontSize}px</output></div>
                </div>
              {/if}
              {#if matches('width')}
                <div class="srow">
                  <div class="s-text"><b>본문 폭</b><small>글이 놓이는 가로 폭. 창 폭에 맞추면 제한이 없습니다.</small></div>
                  <div class="s-ctl">
                    <input type="range" min={WIDTH.min} max={WIDTH.max} step="20" value={design.typography.contentWidth > 0 ? design.typography.contentWidth : WIDTH.max} disabled={design.typography.contentWidth === 0} oninput={setWidth} aria-label="본문 폭" />
                    <output>{design.typography.contentWidth > 0 ? `${design.typography.contentWidth}px` : '전체'}</output>
                    <button class="sw-switch" role="switch" aria-checked={design.typography.contentWidth === 0} aria-label="창 폭에 맞추기" use:tip={'창 폭에 맞추기'} onclick={toggleFullWidth}><span></span></button>
                  </div>
                </div>
              {/if}
              {#if matches('fontSize') || matches('width')}
                <div class="srow end"><button class="linkish" onclick={resetLayout}><RotateCcw size={13} /> 글자 크기·본문 폭 기본값으로</button></div>
              {/if}
            </section>
          {/if}

          {#if catShown('write')}
            <section>
              <h3><PenLine size={16} /> 글쓰기</h3>
              {#if matches('count')}
                <div class="srow">
                  <div class="s-text"><b>글자 수에 공백 포함</b><small>하단 상태 표시줄의 글자 수를 세는 기준(눌러서 바꿀 수도 있습니다).</small></div>
                  <button class="sw-switch" role="switch" aria-checked={writing.spaces} aria-label="글자 수에 공백 포함" onclick={() => setSpaces(!writing.spaces)}><span></span></button>
                </div>
              {/if}
              {#if matches('tablefmt')}
                <div class="srow col">
                  <div class="s-text"><b>표 복사 기본 형식</b><small>표 위의 "복사" 단추와 확대 보기의 "복사"가 쓰는 형식. HTML·아스키·마크다운 등 다른 형식은 메뉴에서 고릅니다.</small></div>
                  <div class="cards two" role="radiogroup" aria-label="표 복사 기본 형식">
                    {#each [['tsv', 'TSV', '탭으로 구분 — 엑셀·구글 시트에 바로 붙여넣기'], ['csv', 'CSV', '쉼표로 구분 — 다른 프로그램으로 옮기기']] as [v, l, d] (v)}
                      <button role="radio" aria-checked={settings.tableCopyFormat === v} class="card left" class:on={settings.tableCopyFormat === v} onclick={() => setTableFmt(v as 'tsv' | 'csv')}>
                        <span class="ct"><b>{l}</b>{#if settings.tableCopyFormat === v}<Check size={14} class="ck" />{/if}</span><small>{d}</small>
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
              {#if server && matches('image')}
                <div class="srow col">
                  <div class="s-text"><b>이미지 삽입 방식</b><small>붙여넣거나 끌어다 놓은 이미지를 어떻게 저장할지.</small></div>
                  <div class="cards two" role="radiogroup" aria-label="이미지 삽입 방식">
                    {#each modes as [v, l, d] (v)}
                      <button role="radio" aria-checked={settings.imageMode === v} class="card left" class:on={settings.imageMode === v} onclick={() => setMode(v)}>
                        <span class="ct"><b>{l}</b>{#if settings.imageMode === v}<Check size={14} class="ck" />{/if}</span><small>{d}</small>
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
            </section>
          {/if}

          {#if catShown('snippet')}
            <section>
              <h3><StickyNote size={16} /> 글감</h3>
              {#if matches('colors')}
                <div class="srow">
                  <div class="s-text"><b>글감 색 사용</b><small>글감에 색을 지정하고 색으로 거르는 기능을 켭니다. 꺼 두어도 이미 지정한 색은 카드에 보입니다.</small></div>
                  <button class="sw-switch" role="switch" aria-checked={settings.snippetColors} aria-label="글감 색 사용" onclick={toggleColors}><span></span></button>
                </div>
              {/if}
            </section>
          {/if}

          {#if catShown('save')}
            <section>
              <h3><DatabaseBackup size={16} /> 저장과 백업</h3>
              {#if server && matches('autosave')}
                <div class="srow">
                  <div class="s-text"><b>자동 저장</b><small>입력이 0.7초 멈추면 저장하고, 계속 쓰는 중에도 10초마다 저장합니다.</small></div>
                  <button class="sw-switch" role="switch" aria-checked={settings.autosave} aria-label="자동 저장" onclick={toggleAutosave}><span></span></button>
                </div>
              {/if}
              {#if !server && !needle}
                <div class="srow"><div class="s-text"><b>저장 위치</b><small>문서는 입력할 때마다 이 브라우저(IndexedDB)에 자동으로 저장됩니다. 다른 기기로 옮기려면 백업 파일을 내보내세요.</small></div></div>
              {/if}
              {#if matches('backup')}
                <div class="srow">
                  <div class="s-text">
                    <b>백업 · 가져오기</b>
                    <small class:warn={isStale()}>{backupLine}</small>
                  </div>
                  <button class="primary-btn" onclick={openBackup}><DatabaseBackup size={15} /> 열기</button>
                </div>
              {/if}
            </section>
          {/if}

          {#if catShown('design')}
            <section class="design-sec">
              <h3><Palette size={16} /> 디자인</h3>
              <DesignEditor />
            </section>
          {/if}
        </div>
      </div>
    </div>
    {#if island}
      <aside class="sw-island" aria-label="디자인 미리보기"><DesignPreview /></aside>
    {/if}
   </div>
  </div>
{/if}

<style>
  .sw-stage { display: flex; align-items: center; justify-content: center; gap: 14px; width: 100%; height: 100%; padding: 20px 12px; box-sizing: border-box; }
  .sw-island {
    flex: 0 1 460px; min-width: 300px; height: min(640px, calc(100vh - 40px)); border-radius: 14px; overflow: hidden;
    border: 1px solid var(--border-strong); box-shadow: var(--shadow); background: var(--surface);
  }
  .sw {
    flex: 0 1 880px; min-width: 0; height: min(640px, calc(100vh - 40px)); display: flex; flex-direction: column;
    background: var(--bg); border: 1px solid var(--border-strong); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden;
  }
  .sw-head { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .sw-head h2 { margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px; flex: none; }
  .sw-search { flex: 1; display: flex; align-items: center; gap: 8px; max-width: 360px; margin-left: auto; padding: 5px 10px; border: 1px solid var(--border-strong); border-radius: 9px; background: var(--surface); color: var(--muted); }
  .sw-search:focus-within { border-color: var(--accent); }
  .sw-search input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; color: var(--text); font: inherit; font-size: 13.5px; }
  .sw-close { margin-left: 4px; }
  .sw-body { flex: 1; min-height: 0; display: flex; }
  .sw-nav { width: 190px; flex: none; padding: 10px; display: flex; flex-direction: column; gap: 2px; border-right: 1px solid var(--border); background: var(--surface); }
  .sw-nav button { display: flex; align-items: center; gap: 10px; text-align: left; border: 0; background: transparent; padding: 9px 10px; border-radius: 8px; color: var(--muted); }
  .sw-nav button:hover { background: var(--hover); color: var(--text); }
  .sw-nav button.on { background: var(--accent-soft); color: var(--text); font-weight: 600; }
  .sw-nav button.on :global(svg) { color: var(--primary); }
  .sw-nav button.has { color: var(--text); }
  .sw-main { flex: 1; min-width: 0; overflow: auto; padding: 8px 26px 28px; }
  section h3 { display: flex; align-items: center; gap: 8px; font-size: 15px; margin: 18px 0 4px; color: var(--text); }
  section h3 :global(svg) { color: var(--primary); }
  .sw-none { color: var(--muted); padding: 24px 0; }
  .srow { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 14px 0; border-bottom: 1px solid var(--border); }
  .srow.col { flex-direction: column; align-items: stretch; gap: 12px; }
  .srow.end { justify-content: flex-end; border-bottom: 0; padding-top: 8px; }
  .s-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .s-text b { font-weight: 600; font-size: 14px; }
  .s-text small { color: var(--muted); font-size: 12.5px; line-height: 1.5; }
  .s-text small.warn { color: var(--danger); }
  .s-ctl { display: flex; align-items: center; gap: 12px; flex: none; }
  .s-ctl input[type='range'] { width: 200px; accent-color: var(--primary); }
  .s-ctl output { min-width: 46px; text-align: right; font-variant-numeric: tabular-nums; font-size: 13px; color: var(--muted); }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .cards.two { grid-template-columns: repeat(2, 1fr); }
  .card { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 10px; border-radius: 10px; border: 1px solid var(--border-strong); background: var(--surface); }
  .card.left { align-items: flex-start; text-align: left; gap: 4px; }
  .card.left small { color: var(--muted); font-size: 12px; line-height: 1.4; }
  .card .ct { display: flex; align-items: center; gap: 6px; }
  .card:hover { background: var(--hover); }
  .card.on { border-color: var(--accent); background: var(--accent-soft); }
  .card :global(.ck) { color: var(--primary); }
  .card:not(.left) :global(.ck) { position: absolute; top: 8px; right: 8px; }
  .sw-switch { position: relative; width: 42px; height: 24px; flex: none; padding: 0; border-radius: 12px; border: 1px solid var(--border-strong); background: var(--border); transition: background 0.15s; }
  .sw-switch span { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); transition: transform 0.15s; }
  /* 좁은 화면에서 상단바 버튼에 걸리는 최소 크기(40px)가 스위치를 네모로 만들지 않게 */
  .sw .sw-switch.sw-switch { min-width: 42px; min-height: 24px; }
  .sw-switch[aria-checked='true'] { background: var(--primary); border-color: var(--primary); }
  .sw-switch[aria-checked='true'] span { transform: translateX(18px); }
  .primary-btn { display: inline-flex; align-items: center; gap: 6px; flex: none; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--primary); background: var(--primary); color: var(--on-primary); font-weight: 600; }
  .primary-btn:hover { filter: brightness(1.08); background: var(--primary); }
  .linkish { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--muted); padding: 4px 6px; }
  .linkish:hover { color: var(--text); background: transparent; text-decoration: underline; }
  /* 폭이 모자라면 미리보기 섬을 설정 창 아래로 내린다 */
  @media (max-width: 1100px) {
    .sw-stage.island { flex-direction: column; gap: 10px; }
    .sw-stage.island .sw { flex: none; width: min(880px, 100%); height: calc(100vh - 40px - 210px - 10px); min-height: 300px; }
    .sw-island { flex: none; width: min(880px, 100%); height: 210px; min-width: 0; }
  }
  @media (max-width: 720px) {
    .sw-stage { padding: 0; }
    .sw-island { display: none; }
    .sw { width: 100vw; height: 100dvh; border-radius: 0; border: 0; }
    .sw-head { flex-wrap: wrap; gap: 8px; }
    .sw-search { order: 3; max-width: none; flex-basis: 100%; margin-left: 0; }
    .sw-body { flex-direction: column; }
    .sw-nav { width: auto; flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--border); padding: 6px; }
    .sw-nav button span { white-space: nowrap; }
    .sw-main { padding: 4px 16px 24px; }
    .srow { gap: 14px; }
    .srow:has(.s-ctl) { flex-direction: column; align-items: stretch; gap: 10px; }
    .s-ctl input[type='range'] { width: 100%; flex: 1; }
    .cards { grid-template-columns: repeat(3, 1fr); }
  }
</style>
