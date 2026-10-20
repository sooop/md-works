<script lang="ts">
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import {
    settings, persistSettings, applyTheme,
    type Theme, type ImageMode,
  } from '../store.svelte';
  import { design, setTypo } from '../design/state.svelte';
  import { TYPO_SPEC, DEFAULT_TYPOGRAPHY, type NumSpec } from '../design/schema';
  import DesignPanel from './DesignPanel.svelte';

  let { server = false, trigger = true, open = $bindable(false) }: { server?: boolean; trigger?: boolean; open?: boolean } = $props();
  let designOpen = $state(false);

  const FONT = TYPO_SPEC.fontSize as NumSpec;
  const WIDTH = TYPO_SPEC.contentWidth as NumSpec;

  const themes: [Theme, string][] = [['system', '시스템'], ['light', '라이트'], ['dark', '다크']];
  const modes: [ImageMode, string][] = [['file', '파일(assets 폴더)'], ['base64', 'Base64(문서에 포함)']];

  function setTheme(t: Theme) { settings.theme = t; applyTheme(); persistSettings(); }
  function setMode(m: ImageMode) { settings.imageMode = m; persistSettings(); }
  function toggleAutosave() { settings.autosave = !settings.autosave; persistSettings(); }

  // 글자 크기·본문 폭은 디자인 설정('works.design')에 저장된다
  function setFont(e: Event) {
    setTypo('fontSize', Number((e.currentTarget as HTMLInputElement).value));
  }
  function setWidth(e: Event) {
    setTypo('contentWidth', Number((e.currentTarget as HTMLInputElement).value));
  }
  function toggleFullWidth() {
    setTypo('contentWidth', design.typography.contentWidth > 0 ? 0 : DEFAULT_TYPOGRAPHY.contentWidth);
  }
  function resetLayout() {
    setTypo('fontSize', DEFAULT_TYPOGRAPHY.fontSize);
    setTypo('contentWidth', DEFAULT_TYPOGRAPHY.contentWidth);
  }
  function openDesign() { open = false; designOpen = true; }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') open = false; }} />

<div class="settings">
  {#if trigger}<button class="icon-btn" aria-label="설정" aria-expanded={open} onclick={() => (open = !open)}><SettingsIcon size={18} /></button>{/if}
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={() => (open = false)}></div>
    <div class="popover" role="group" aria-label="설정">
      <div class="field">
        <span class="label">테마</span>
        <div class="seg">
          {#each themes as [v, l]}
            <button class:active={settings.theme === v} onclick={() => setTheme(v)}>{l}</button>
          {/each}
        </div>
      </div>

      <div class="field">
        <span class="label">글자 크기 <b>{design.typography.fontSize}px</b></span>
        <input
          type="range"
          min={FONT.min}
          max={FONT.max}
          step="1"
          value={design.typography.fontSize}
          oninput={setFont}
          aria-label="글자 크기"
        />
      </div>

      <div class="field">
        <span class="label">본문 폭 <b>{design.typography.contentWidth > 0 ? `${design.typography.contentWidth}px` : '전체'}</b></span>
        <input
          type="range"
          min={WIDTH.min}
          max={WIDTH.max}
          step="20"
          value={design.typography.contentWidth > 0 ? design.typography.contentWidth : WIDTH.max}
          disabled={design.typography.contentWidth === 0}
          oninput={setWidth}
          aria-label="본문 폭"
        />
        <label class="check">
          <input type="checkbox" checked={design.typography.contentWidth === 0} onchange={toggleFullWidth} />
          <span>창 폭에 맞추기</span>
        </label>
      </div>
      <button class="link-btn" onclick={resetLayout}>글자 크기·본문 폭 기본값으로</button>
      <button onclick={openDesign}>디자인…</button>

      {#if server}
        <div class="field">
          <span class="label">이미지 삽입 방식</span>
          <div class="seg col">
            {#each modes as [v, l]}
              <button class:active={settings.imageMode === v} onclick={() => setMode(v)}>{l}</button>
            {/each}
          </div>
        </div>
        <label class="check">
          <input type="checkbox" checked={settings.autosave} onchange={toggleAutosave} />
          <span>자동 저장 (입력 후 0.7초, 최대 10초)</span>
        </label>
      {/if}
    </div>
  {/if}
</div>

{#if designOpen}
  <DesignPanel onclose={() => (designOpen = false)} />
{/if}
