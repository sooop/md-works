<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
  import { toast } from '../store.svelte';
  import { design, setTypo, setColor, selectPreset, resetPalette, resetTypography, importDesign, undoImport, undoState } from '../design/state.svelte';
  import { TYPO_SPEC, PALETTE_KEYS, PALETTE_LABELS, type NumSpec, type TypoKey, type PaletteKey } from '../design/schema';
  import { PRESETS } from '../design/presets';
  import { contrastWarnings, contrastBlock, MIN_APPLY_CONTRAST, normalizeHex, onColor } from '../design/colors';
  import { buildFontFamily, FALLBACK_CODE } from '../design/fontStack';
  import { serializeDesign, parseDesign } from '../design/io';

  let { onclose }: { onclose: () => void } = $props();

  type Tab = 'font' | 'block' | 'color' | 'io';
  const tabs: [Tab, string][] = [['font', '서체·간격'], ['block', '제목·블록'], ['color', '색상'], ['io', '이식']];
  let tab = $state<Tab>('font');

  // 색상 탭에서 편집할 모드: 현재 화면에 적용 중인 쪽으로 시작
  let mode = $state<'light' | 'dark'>(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

  // 한글 글쓰기 서체 후보 + (가능하면) 내 컴퓨터 폰트
  const FONT_HINTS = [
    'Pretendard Variable', 'Noto Serif KR', 'Noto Sans KR', 'Nanum Myeongjo', 'Nanum Gothic', 'KoPub Batang', 'Malgun Gothic',
    'Batang', 'Georgia', 'Times New Roman', 'Consolas', 'Cascadia Mono',
  ];
  let localFonts = $state<string[]>([]);
  let canQueryFonts = $state(typeof (window as any).queryLocalFonts === 'function');
  const fontOptions = $derived([...new Set([...FONT_HINTS, ...localFonts])]);

  async function loadLocalFonts() {
    try {
      const list: { family: string }[] = await (window as any).queryLocalFonts();
      localFonts = [...new Set(list.map((f) => f.family))].sort((a, b) => a.localeCompare(b)).slice(0, 1500);
      if (!localFonts.length) canQueryFonts = false;
    } catch {
      canQueryFonts = false; // 권한 거부·미지원: 조용히 숨긴다
    }
  }

  const t = $derived(design.typography);
  const previewStyle = $derived(
    [
      buildFontFamily(t.bodyFont) && `font-family:${buildFontFamily(t.bodyFont)}`,
      `font-size:${t.fontSize}px`,
      `line-height:${t.lineHeight}`,
      `letter-spacing:${t.letterSpacing}em`,
      `font-weight:${t.bodyWeight}`,
      `text-align:${t.align}`,
      `text-indent:${t.indent}em`,
    ].filter(Boolean).join(';'),
  );
  const headStyle = $derived(
    [
      (buildFontFamily(t.headingFont) || buildFontFamily(t.bodyFont)) && `font-family:${buildFontFamily(t.headingFont) || buildFontFamily(t.bodyFont)}`,
      `font-size:${t.fontSize * t.h2Scale}px`,
    ].filter(Boolean).join(';'),
  );
  const codeStyle = $derived(
    [`font-family:${buildFontFamily(t.codeFont, FALLBACK_CODE) || 'var(--font-code)'}`, `font-size:${t.fontSize * t.codeScale}px`].join(';'),
  );

  const num = (k: TypoKey) => TYPO_SPEC[k] as NumSpec;
  const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
  function onNum(k: TypoKey, e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    setTypo(k, Number(el.value) as never);
    el.value = fmt(design.typography[k] as number); // 클램프된 값으로 되돌려 표시
  }
  function onStr(k: TypoKey, e: Event) { setTypo(k, (e.currentTarget as HTMLInputElement).value as never); }
  function onBool(k: TypoKey, e: Event) { setTypo(k, (e.currentTarget as HTMLInputElement).checked as never); }
  function toggleFull() { setTypo('contentWidth', (t.contentWidth > 0 ? 0 : 980) as never); }

  const palette = $derived(design.palettes[mode]);
  const warnings = $derived(contrastWarnings(palette));
  const warnOf = (k: PaletteKey) => {
    const key = k === 'text' ? 'text' : k === 'muted' ? 'muted' : k === 'primary' ? 'primary' : null;
    return key ? warnings.find((w) => w.key === key) : undefined;
  };
  // 대비가 너무 낮아 적용을 보류한 색(입력칸에는 사용자가 넣은 값이 남고, 실제 적용·저장은 하지 않는다)
  let blocked = $state<{ key: PaletteKey; ratio: number } | null>(null);
  function tryColor(k: PaletteKey, hex: string): boolean {
    const ratio = contrastBlock(palette, k, hex);
    if (ratio !== null) { blocked = { key: k, ratio }; return false; }
    blocked = null;
    setColor(mode, k, hex);
    return true;
  }
  function onHex(k: PaletteKey, e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const hex = normalizeHex(el.value);
    if (hex && !tryColor(k, hex)) return; // 보류: 입력한 값을 그대로 둔다
    el.value = design.palettes[mode][k];
  }

  function doExport() {
    const blob = new Blob([serializeDesign(design)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'md-works-design.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function doImport(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    const res = parseDesign(await file.text());
    if (!res.ok) { toast(`디자인을 가져오지 못했습니다: ${res.error}`, 'error'); return; }
    importDesign(res.value);
    toast('디자인을 적용했습니다. 되돌리려면 "직전 설정으로 되돌리기"를 누르세요');
  }
</script>

{#snippet numRow(k: TypoKey, label: string, unit: string)}
  {@const s = num(k)}
  <label class="row">
    <span class="lbl">{label}</span>
    <input type="range" min={s.min} max={s.max} step={s.step} value={t[k] as number} oninput={(e) => onNum(k, e)} aria-label={label} />
    <input class="n" type="number" min={s.min} max={s.max} step={s.step} value={fmt(t[k] as number)} onchange={(e) => onNum(k, e)} aria-label={`${label} 값`} />
    <span class="unit">{unit}</span>
  </label>
{/snippet}

{#snippet fontRow(k: 'bodyFont' | 'headingFont' | 'codeFont', label: string, placeholder: string)}
  <label class="row">
    <span class="lbl">{label}</span>
    <input class="txt" type="text" list="design-fonts" value={t[k]} {placeholder} onchange={(e) => onStr(k, e)} aria-label={label} maxlength="200" spellcheck="false" />
  </label>
{/snippet}

{#snippet check(k: TypoKey, label: string)}
  <label class="chk"><input type="checkbox" checked={t[k] as boolean} onchange={(e) => onBool(k, e)} /><span>{label}</span></label>
{/snippet}

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose(); }} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="dialog design-panel" role="dialog" aria-modal="true" aria-label="편집기 디자인">
    <header class="dp-head">
      <h2>편집기 디자인</h2>
      <button class="icon-btn" aria-label="닫기" onclick={onclose}><X size={18} /></button>
    </header>

    <div class="dp-tabs" role="tablist" aria-label="디자인 항목">
      {#each tabs as [id, name]}
        <button role="tab" aria-selected={tab === id} class:on={tab === id} onclick={() => (tab = id)}>{name}</button>
      {/each}
    </div>

    <datalist id="design-fonts">
      {#each fontOptions as f}<option value={f}></option>{/each}
    </datalist>

    <div class="dp-body">
      {#if tab === 'font'}
        {@render fontRow('bodyFont', '본문 서체', '비우면 기본(Pretendard)')}
        {@render fontRow('headingFont', '제목 서체', '비우면 본문과 동일')}
        {#if canQueryFonts}
          <button class="link-btn" onclick={loadLocalFonts}>내 컴퓨터 폰트 불러오기</button>
        {/if}
        <p class="hint">시스템에 설치된 폰트 이름을 입력하세요(쉼표로 여러 개 가능). 목록에 없는 폰트는 기본 서체로 대체됩니다.</p>
        {@render numRow('fontSize', '글자 크기', 'px')}
        {@render numRow('lineHeight', '줄간격', '배')}
        {@render numRow('letterSpacing', '자간', 'em')}
        {@render numRow('bodyWeight', '본문 굵기', '')}
        {@render numRow('headingWeight', '제목 굵기 (0 = 기본)', '')}
        {@render numRow('boldWeight', '굵게(강조) 굵기', '')}
        <p class="hint">굵기는 100~900 이며 폰트가 해당 굵기를 지원할 때만 바뀝니다. 제목 굵기는 숫자 칸에 0 을 넣으면 기본값입니다(가변 폰트는 모두 지원, 일반 폰트는 보통·굵게 두 단계만 보일 수 있습니다).</p>
        {@render numRow('paragraphGap', '문단 간격', 'em')}
        {@render numRow('indent', '첫 줄 들여쓰기', 'em')}
        <div class="row">
          <span class="lbl">정렬</span>
          <div class="seg" role="group" aria-label="정렬">
            <button class:active={t.align === 'left'} onclick={() => setTypo('align', 'left')}>왼쪽</button>
            <button class:active={t.align === 'justify'} onclick={() => setTypo('align', 'justify')}>양쪽</button>
          </div>
        </div>
        {#if t.contentWidth > 0}{@render numRow('contentWidth', '본문 폭', 'px')}{/if}
        <label class="chk"><input type="checkbox" checked={t.contentWidth === 0} onchange={toggleFull} /><span>본문 폭을 창 폭에 맞추기</span></label>

        <div class="preview" aria-label="미리보기">
          <div class="pv-h" style={headStyle}>미리보기 제목 Preview 123</div>
          <p style={previewStyle}>
            가나다라마바사 아자차카타파하. 다람쥐 헌 쳇바퀴에 타고파 — The quick brown fox jumps over the lazy dog. 0123456789 (2026.10.19)
          </p>
          <p style={previewStyle}>두 번째 문단입니다. 문단 간격과 첫 줄 들여쓰기, 자간이 이렇게 보입니다.</p>
        </div>
      {:else if tab === 'block'}
        <h3>제목</h3>
        <div class="hgrid" role="group" aria-label="제목 단계별 설정">
          <span></span><span class="gh">크기 배율</span><span class="gh">위 여백(em)</span><span class="gh">아래 여백(em)</span>
          {#each [1, 2, 3, 4, 5, 6] as i}
            <span class="lbl">H{i}</span>
            <input type="number" min={num(`h${i}Scale` as TypoKey).min} max={num(`h${i}Scale` as TypoKey).max} step="0.05" value={fmt(t[`h${i}Scale` as TypoKey] as number)} onchange={(e) => onNum(`h${i}Scale` as TypoKey, e)} aria-label={`H${i} 크기 배율`} />
            <input type="number" min="0" max="4" step="0.05" value={fmt(t[`h${i}Before` as TypoKey] as number)} onchange={(e) => onNum(`h${i}Before` as TypoKey, e)} aria-label={`H${i} 위 여백(em)`} />
            <input type="number" min="0" max="4" step="0.05" value={fmt(t[`h${i}After` as TypoKey] as number)} onchange={(e) => onNum(`h${i}After` as TypoKey, e)} aria-label={`H${i} 아래 여백(em)`} />
          {/each}
        </div>
        <p class="hint">여백은 본문 글자 크기의 배수입니다.</p>

        <h3>인용문 <span class="sub">('글감 인용' 블록과 공유)</span></h3>
        {@render numRow('quoteBar', '왼쪽 선 굵기', 'px')}
        {@render check('quoteUseColor', '선에 팔레트의 인용문 색 사용')}
        {@render check('quoteBg', '배경 표시')}
        {@render check('quoteItalic', '기울임')}

        <h3>코드</h3>
        {@render fontRow('codeFont', '코드 블록 서체', '비우면 기본(Geist Mono 등)')}
        {@render numRow('codeScale', '크기 배율', '배')}
        <pre class="pv-code" style={codeStyle}>const 인사 = 'Hello, 세계';</pre>

        <h3>표</h3>
        {@render check('tableStripe', '줄무늬')}
        {@render numRow('cellPadY', '셀 위·아래 여백', 'px')}
        {@render numRow('cellPadX', '셀 좌·우 여백', 'px')}
      {:else if tab === 'color'}
        <div class="row">
          <span class="lbl">프리셋</span>
          <select aria-label="색상 프리셋" value={design.presetId ?? ''} onchange={(e) => selectPreset((e.currentTarget as HTMLSelectElement).value)}>
            {#if !design.presetId}<option value="">(직접 설정)</option>{/if}
            {#each PRESETS as p}<option value={p.id}>{p.name}</option>{/each}
          </select>
          <button onclick={resetPalette}>프리셋으로 되돌리기</button>
        </div>
        <div class="row">
          <span class="lbl">편집 대상</span>
          <div class="seg" role="group" aria-label="편집할 팔레트">
            <button class:active={mode === 'light'} onclick={() => { mode = 'light'; blocked = null; }}>라이트</button>
            <button class:active={mode === 'dark'} onclick={() => { mode = 'dark'; blocked = null; }}>다크</button>
          </div>
        </div>
        <p class="hint">테마(시스템/라이트/다크)에 따라 현재 적용 중인 쪽 팔레트가 쓰입니다. 나머지 색(보조 면, 호버, 선택, 진한 테두리 등)은 이 10색에서 계산됩니다.</p>
        <div class="colors">
          {#each PALETTE_KEYS as k}
            {@const w = warnOf(k)}
            <div class="crow">
              <span class="lbl">{PALETTE_LABELS[k]}</span>
              <input type="color" value={palette[k]} oninput={(e) => tryColor(k, (e.currentTarget as HTMLInputElement).value)} aria-label={`${PALETTE_LABELS[k]} 색 선택`} />
              <input class="hex" type="text" value={palette[k]} onchange={(e) => onHex(k, e)} maxlength="7" spellcheck="false" aria-label={`${PALETTE_LABELS[k]} 16진수`} />
              {#if w}
                <span class="warn" role="img" aria-label={`대비 부족: ${w.ratio.toFixed(2)} (기준 ${w.need})`} title={`대비 ${w.ratio.toFixed(2)} — 기준 ${w.need} 미달`}>
                  <AlertTriangle size={14} /> {w.ratio.toFixed(1)}:1
                </span>
              {/if}
              {#if blocked && blocked.key === k}
                <span class="warn block" role="alert">대비가 너무 낮아 적용하지 않았습니다(최소 {MIN_APPLY_CONTRAST.toFixed(1)}:1, 지금 {blocked.ratio.toFixed(1)}:1)</span>
              {/if}
            </div>
          {/each}
        </div>
        <div class="swatch" style={`background:${palette.bg};color:${palette.text};border-color:${palette.border}`}>
          <b>본문 글자</b> <span style={`color:${palette.muted}`}>보조 글자</span>
          <span class="chip" style={`background:${palette.primary};color:${onColor(palette.primary)}`}>강조</span>
        </div>
      {:else}
        <p class="hint">타이포그래피와 라이트·다크 팔레트 전체를 JSON 파일로 저장하거나 불러옵니다.</p>
        <div class="row">
          <button onclick={doExport}>디자인 내보내기 (.json)</button>
          <label class="filebtn">
            디자인 가져오기
            <input type="file" accept="application/json,.json" onchange={doImport} aria-label="디자인 JSON 파일 선택" />
          </label>
        </div>
        <p class="hint">가져오면 미리보기 없이 즉시 적용됩니다. 형식이 잘못된 항목은 무시하거나 허용 범위로 보정합니다.</p>
        <div class="row">
          <button onclick={undoImport} disabled={!undoState.prev}>직전 설정으로 되돌리기</button>
          <button onclick={resetTypography}>타이포 기본값으로</button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .design-panel { width: min(720px, calc(100vw - 24px)); max-height: calc(100vh - 32px); display: flex; flex-direction: column; padding: 16px; }
  .dp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .dp-head h2 { margin: 0; }
  .dp-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); overflow-x: auto; flex: none; }
  .dp-tabs button { border: 0; background: transparent; border-radius: 6px 6px 0 0; border-bottom: 2px solid transparent; color: var(--muted); white-space: nowrap; }
  .dp-tabs button.on { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
  .dp-body { overflow-y: auto; padding: 12px 2px 4px; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  .dp-body h3 { margin: 10px 0 0; font-size: 14px; }
  .dp-body h3 .sub { font-size: 12px; font-weight: 400; color: var(--muted); }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lbl { flex: none; width: 110px; font-size: 13px; color: var(--muted); }
  .row input[type='range'] { flex: 1; min-width: 120px; accent-color: var(--primary); }
  .row .n { width: 76px; }
  .row .unit { width: 24px; font-size: 12px; color: var(--muted); }
  .row .txt { flex: 1; min-width: 180px; }
  .dp-body input[type='text'], .dp-body input[type='number'], .dp-body select {
    padding: 4px 8px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--surface); width: auto; margin: 0;
  }
  .chk { display: flex; align-items: center; gap: 8px; font-size: 14px; white-space: nowrap; }
  .chk input[type="checkbox"] { width: auto; margin: 0; padding: 0; flex: none; }
  .hint { margin: 0; font-size: 12px; color: var(--muted); }
  .hgrid { display: grid; grid-template-columns: 40px repeat(3, minmax(70px, 1fr)); gap: 6px 8px; align-items: center; }
  .hgrid .lbl { width: auto; }
  .hgrid .gh { font-size: 12px; color: var(--muted); }
  .hgrid input { width: 100%; }
  .preview { border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; background: var(--bg); }
  .preview p { margin: 6px 0; }
  .pv-h { font-weight: 700; }
  .pv-code { margin: 0; padding: 8px 12px; border-radius: 6px; background: var(--code-bg, var(--surface)); overflow-x: auto; }
  .colors { display: flex; flex-direction: column; gap: 6px; }
  .crow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .crow input[type='color'] { width: 36px; height: 28px; padding: 0; border: 1px solid var(--border-strong); border-radius: 6px; background: transparent; }
  .crow .hex { width: 88px; font-family: var(--font-code); }
  .warn.block { flex-basis: 100%; }
  .warn { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; color: var(--danger); }
  .swatch { border: 1px solid; border-radius: 8px; padding: 10px 14px; display: flex; gap: 12px; align-items: center; }
  .chip { border-radius: 6px; padding: 2px 10px; font-size: 13px; }
  .filebtn { position: relative; display: inline-flex; align-items: center; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 8px; padding: 5px 12px; cursor: pointer; }
  .filebtn:hover { background: var(--hover); }
  .filebtn input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
  @media (max-width: 720px) {
    .lbl { width: 100%; }
    .design-panel { padding: 12px; }
  }
</style>
