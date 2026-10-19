<script lang="ts">
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import {
    settings, persistSettings, applyTheme, applyLayout, FONT_RANGE, WIDTH_RANGE, DEFAULT_FONT_SIZE, DEFAULT_CONTENT_WIDTH,
    type Theme, type ImageMode,
  } from '../store.svelte';

  let { server = false }: { server?: boolean } = $props();
  let open = $state(false);

  const themes: [Theme, string][] = [['system', '시스템'], ['light', '라이트'], ['dark', '다크']];
  const modes: [ImageMode, string][] = [['file', '파일(assets 폴더)'], ['base64', 'Base64(문서에 포함)']];

  function setTheme(t: Theme) { settings.theme = t; applyTheme(); persistSettings(); }
  function setMode(m: ImageMode) { settings.imageMode = m; persistSettings(); }
  function toggleAutosave() { settings.autosave = !settings.autosave; persistSettings(); }

  function layoutChanged() { applyLayout(); persistSettings(); }
  function setFont(e: Event) {
    settings.fontSize = Number((e.currentTarget as HTMLInputElement).value);
    layoutChanged();
  }
  function setWidth(e: Event) {
    settings.contentWidth = Number((e.currentTarget as HTMLInputElement).value);
    layoutChanged();
  }
  function toggleFullWidth() {
    settings.contentWidth = settings.contentWidth > 0 ? 0 : DEFAULT_CONTENT_WIDTH;
    layoutChanged();
  }
  function resetLayout() {
    settings.fontSize = DEFAULT_FONT_SIZE;
    settings.contentWidth = DEFAULT_CONTENT_WIDTH;
    layoutChanged();
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') open = false; }} />

<div class="settings">
  <button class="icon-btn" aria-label="설정" aria-expanded={open} onclick={() => (open = !open)}><SettingsIcon size={18} /></button>
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
        <span class="label">글자 크기 <b>{settings.fontSize}px</b></span>
        <input
          type="range"
          min={FONT_RANGE.min}
          max={FONT_RANGE.max}
          step="1"
          value={settings.fontSize}
          oninput={setFont}
          aria-label="글자 크기"
        />
      </div>

      <div class="field">
        <span class="label">본문 폭 <b>{settings.contentWidth > 0 ? `${settings.contentWidth}px` : '전체'}</b></span>
        <input
          type="range"
          min={WIDTH_RANGE.min}
          max={WIDTH_RANGE.max}
          step="20"
          value={settings.contentWidth > 0 ? settings.contentWidth : WIDTH_RANGE.max}
          disabled={settings.contentWidth === 0}
          oninput={setWidth}
          aria-label="본문 폭"
        />
        <label class="check">
          <input type="checkbox" checked={settings.contentWidth === 0} onchange={toggleFullWidth} />
          <span>창 폭에 맞추기</span>
        </label>
      </div>
      <button class="link-btn" onclick={resetLayout}>글자 크기·본문 폭 기본값으로</button>

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
