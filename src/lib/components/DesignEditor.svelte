<script lang="ts">
  import { tip } from '../tooltip.svelte';
  import Check from '@lucide/svelte/icons/check';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Save from '@lucide/svelte/icons/save';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
  import { toast } from '../store.svelte';
  import { design, setTypo, setColor, selectPreset, resetPalette, resetTypography, importDesign, undoImport, undoState, customs, saveCustom, renameCustom, overwriteCustom, deleteCustom } from '../design/state.svelte';
  import { CUSTOM_PREFIX } from '../design/custom';
  import { dui } from '../design/ui.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import FontPicker from './FontPicker.svelte';
  import Dices from '@lucide/svelte/icons/dices';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import { varyColors, randomizeColors } from '../design/state.svelte';
  import type { VaryStrength } from '../design/generate';
  import RenameInput from './RenameInput.svelte';
  import { TYPO_SPEC, PALETTE_KEYS, PALETTE_LABELS, type NumSpec, type TypoKey, type PaletteKey } from '../design/schema';
  import { PRESETS } from '../design/presets';
  import { contrastWarnings, contrastBlock, MIN_APPLY_CONTRAST, normalizeHex, onColor } from '../design/colors';
  import { buildFontFamily, FALLBACK_CODE } from '../design/fontStack';
  import { serializeDesign, parseDesign } from '../design/io';

  type Tab = 'preset' | 'color' | 'font' | 'block' | 'io';
  const tabs: [Tab, string][] = [['preset', '프리셋'], ['color', '색상'], ['font', '서체·간격'], ['block', '제목·블록'], ['io', '이식']];
  let tab = $state<Tab>('preset');
  let renamingId = $state('');
  let strength = $state<VaryStrength>('mid');
  let seed = $state(0);
  const newSeed = () => 1 + Math.floor(Math.random() * 999_999);
  let saving = $state(false);
  let newName = $state('');
  const basic = PRESETS.filter((p) => p.group === 'basic');
  const terminal = PRESETS.filter((p) => p.group === 'terminal');
  function doSave() {
    saveCustom(newName || '내 테마');
    newName = '';
    saving = false;
  }

  // 색상 탭에서 편집할 모드: 현재 화면에 적용 중인 쪽으로 시작
  const mode = $derived(dui.mode);
  const dark = $derived(mode === 'dark');

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
  <div class="row">
    <span class="lbl">{label}</span>
    <div class="fpw"><FontPicker value={t[k]} kind={k === 'codeFont' ? 'code' : 'text'} {placeholder} {label} onchange={(v) => setTypo(k, v as never)} /></div>
  </div>
{/snippet}

{#snippet check(k: TypoKey, label: string)}
  <label class="chk"><input type="checkbox" checked={t[k] as boolean} onchange={(e) => onBool(k, e)} /><span>{label}</span></label>
{/snippet}

<div class="design-editor">
  <div class="dp-tabs" role="tablist" aria-label="디자인 항목">
    {#each tabs as [id, name]}
      <button role="tab" aria-selected={tab === id} class:on={tab === id} onclick={() => (tab = id)}>{name}</button>
    {/each}
  </div>


    <div class="dp-body">
      {#if tab === 'preset'}
        {#snippet card(id: string, name: string, c: import('../design/schema').Palette, active: boolean)}
          <button class="pcard" class:on={active} onclick={() => selectPreset(id)} aria-pressed={active} aria-label={`프리셋 ${name}`}>
            <span class="pc-sample" style:background={c.bg} style:color={c.text} style:border-color={c.border}>
              <i style:background={c.primary}></i><i style:background={c.accent}></i><i style:background={c.accentSoft}></i><em>가나다 Aa</em>
            </span>
            <span class="pc-name">{name}{#if active}<Check size={13} />{/if}</span>
          </button>
        {/snippet}

        <h3>기본</h3>
        <div class="pgrid">{#each basic as p (p.id)}{@render card(p.id, p.name, dark ? p.dark : p.light, design.presetId === p.id)}{/each}</div>
        <h3>터미널·에디터 테마</h3>
        <div class="pgrid">{#each terminal as p (p.id)}{@render card(p.id, p.name, dark ? p.dark : p.light, design.presetId === p.id)}{/each}</div>

        <h3>내 테마 <span class="sub">(이 기기에 저장 · 타이포 포함)</span></h3>
        <div class="pgrid">
          {#each customs as c (c.id)}
            <div class="pcard-wrap">
              {#if renamingId === c.id}
                <RenameInput value={c.name} onCommit={(v) => { renameCustom(c.id, v); renamingId = ''; }} onCancel={() => (renamingId = '')} />
              {:else}
                {@render card(CUSTOM_PREFIX + c.id, c.name, dark ? c.dark : c.light, design.presetId === CUSTOM_PREFIX + c.id)}
              {/if}
              <span class="pc-ops">
                <button class="icon-btn" aria-label="이름 변경" use:tip={'이름 변경'} onclick={() => (renamingId = c.id)}><Pencil size={13} /></button>
                <button class="icon-btn" aria-label="지금 디자인으로 덮어쓰기" use:tip={'지금 디자인으로 덮어쓰기'} onclick={() => overwriteCustom(c.id)}><Save size={13} /></button>
                <button class="icon-btn" aria-label="삭제" use:tip={'삭제'} onclick={() => deleteCustom(c.id)}><Trash2 size={13} /></button>
              </span>
            </div>
          {/each}
          {#if saving}
            <div class="pcard-new">
              <input type="text" bind:value={newName} placeholder="테마 이름" maxlength="40" aria-label="새 테마 이름" spellcheck="false"
                onkeydown={(e) => { if (e.isComposing) return; if (e.key === 'Enter') doSave(); else if (e.key === 'Escape') { e.stopPropagation(); saving = false; } }} />
              <button class="primary" onclick={doSave}>저장</button>
            </div>
          {:else}
            <button class="pcard add" onclick={() => { saving = true; newName = ''; }}><Save size={16} /> 지금 디자인을 내 테마로 저장</button>
          {/if}
        </div>
        {#if !customs.length && !saving}<p class="hint">색과 서체를 마음에 들게 고친 뒤 저장해 두면 여기서 한 번에 불러올 수 있습니다.</p>{/if}
      {:else if tab === 'font'}
        {@render fontRow('bodyFont', '본문 서체', '비우면 기본(Pretendard Variable)')}
        {@render fontRow('headingFont', '제목 서체', '비우면 본문과 동일')}
        <p class="hint">목록에서 고르거나 직접 입력할 수 있고(쉼표로 여러 개), 이 컴퓨터에 설치된 글꼴만 쓸 수 있습니다. 없는 글꼴은 기본 서체로 대체됩니다.</p>
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
        {@render fontRow('codeFont', '코드 블록 서체', '비우면 기본(Jetendard)')}
        {@render numRow('codeScale', '크기 배율', '배')}
        <pre class="pv-code" style={codeStyle}>const 인사 = 'Hello, 세계';</pre>

        <h3>표</h3>
        {@render check('tableStripe', '줄무늬')}
        {@render numRow('cellPadY', '셀 위·아래 여백', 'px')}
        {@render numRow('cellPadX', '셀 좌·우 여백', 'px')}
      {:else if tab === 'color'}
        <div class="gen" role="group" aria-label="색 만들기">
          <div class="gen-row">
            <span class="lbl">변주</span>
            <div class="seg" role="group" aria-label="변주 세기">
              {#each [['low', '약하게'], ['mid', '보통'], ['high', '강하게']] as [id, name]}
                <button class:active={strength === id} onclick={() => (strength = id as VaryStrength)}>{name}</button>
              {/each}
            </div>
            <button onclick={() => { seed = newSeed(); varyColors(strength, seed); blocked = null; }} use:tip={{ title: '지금 색을 조금씩 흔들기', lines: ['라이트·다크 모두 분위기는 유지하면서 약간 달라집니다', '마음에 들 때까지 반복해 눌러도 됩니다'] }}><RefreshCw size={14} /> 변주</button>
          </div>
          <div class="gen-row">
            <span class="lbl">랜덤</span>
            <button onclick={() => { seed = newSeed(); randomizeColors(seed); blocked = null; }} use:tip={{ title: '완전히 새로운 테마', lines: ['한 색조에서 라이트·다크 한 쌍을 만듭니다', '바탕은 눈이 편하게 낮은 채도, 글자 대비는 항상 기준 이상'] }}><Dices size={14} /> 랜덤 테마 만들기</button>
            <button onclick={undoImport} disabled={!undoState.prev}><Undo2 size={14} /> 직전으로</button>
            {#if seed}<small class="hint">시드 #{seed}</small>{/if}
          </div>
        </div>
        <div class="row">
          <button onclick={resetPalette}>프리셋 색으로 되돌리기</button>
        </div>
        <div class="row">
          <span class="lbl">편집 대상</span>
          <div class="seg" role="group" aria-label="편집할 팔레트">
            <button class:active={mode === 'light'} onclick={() => { dui.mode = 'light'; blocked = null; }}>라이트</button>
            <button class:active={mode === 'dark'} onclick={() => { dui.mode = 'dark'; blocked = null; }}>다크</button>
          </div>
        </div>
        <p class="hint">테마(시스템/라이트/다크)에 따라 현재 적용 중인 쪽 팔레트가 쓰입니다. 나머지 색(보조 면, 호버, 선택, 진한 테두리 등)은 이 10색에서 계산됩니다.</p>
        <div class="colors">
          {#each PALETTE_KEYS as k}
            {@const w = warnOf(k)}
            <div class="crow">
              <span class="lbl">{PALETTE_LABELS[k]}</span>
              <ColorPicker value={palette[k]} bg={palette.bg} label={PALETTE_LABELS[k]} mixable={k !== 'bg'}
                against={k === 'text' || k === 'muted' || k === 'primary' ? palette.bg : k === 'bg' ? palette.text : ''}
                onpick={(hex) => tryColor(k, hex)} />
              <input class="hex" type="text" value={palette[k]} onchange={(e) => onHex(k, e)} maxlength="7" spellcheck="false" aria-label={`${PALETTE_LABELS[k]} 16진수`} />
              {#if w}
                <span class="warn" role="img" aria-label={`대비 부족: ${w.ratio.toFixed(2)} (기준 ${w.need})`} use:tip={`대비 ${w.ratio.toFixed(2)} — 기준 ${w.need} 미달`}>
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

<style>
  .design-editor { display: flex; flex-direction: column; gap: 10px; padding-top: 6px; }
  .gen { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
  .gen-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .gen button { display: inline-flex; align-items: center; gap: 6px; }
  .fpw { flex: 1; min-width: 200px; max-width: 360px; }
  .pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .pcard { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 10px; border: 1px solid var(--border-strong); background: var(--surface); text-align: left; width: 100%; }
  .pcard:hover { background: var(--hover); }
  .pcard.on { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .pcard.add { align-items: center; justify-content: center; flex-direction: row; gap: 8px; color: var(--muted); border-style: dashed; min-height: 74px; }
  .pc-sample { display: flex; align-items: center; gap: 5px; padding: 12px 10px; border-radius: 7px; border: 1px solid; }
  .pc-sample i { width: 14px; height: 14px; border-radius: 50%; display: inline-block; flex: none; }
  .pc-sample em { margin-left: auto; font-style: normal; font-size: 12.5px; font-weight: 600; }
  .pc-name { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
  .pcard-wrap { position: relative; }
  .pc-ops { position: absolute; top: 4px; right: 4px; display: none; gap: 0; background: var(--surface); border-radius: 6px; box-shadow: var(--shadow); }
  .pcard-wrap:hover .pc-ops, .pcard-wrap:focus-within .pc-ops { display: flex; }
  .pcard-new { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px dashed var(--accent); border-radius: 10px; }
  .dp-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); overflow-x: auto; flex: none; }
  .dp-tabs button { border: 0; background: transparent; border-radius: 6px 6px 0 0; border-bottom: 2px solid transparent; color: var(--muted); white-space: nowrap; }
  .dp-tabs button.on { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
  .dp-body { padding: 12px 2px 4px; display: flex; flex-direction: column; gap: 10px; }
  .dp-body h3 { margin: 10px 0 0; font-size: 14px; }
  .dp-body h3 .sub { font-size: 12px; font-weight: 400; color: var(--muted); }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lbl { flex: none; width: 110px; font-size: 13px; color: var(--muted); }
  .row input[type='range'] { flex: 1; min-width: 120px; accent-color: var(--primary); }
  .row .n { width: 76px; }
  .row .unit { width: 24px; font-size: 12px; color: var(--muted); }
  .dp-body input[type='text'], .dp-body input[type='number'] {
    padding: 4px 8px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--surface); width: auto; margin: 0;
  }
  .chk { display: flex; align-items: center; gap: 8px; font-size: 14px; white-space: nowrap; }
  .chk input[type="checkbox"] { width: auto; margin: 0; padding: 0; flex: none; }
  .hint { margin: 0; font-size: 12px; color: var(--muted); }
  .hgrid { display: grid; grid-template-columns: 40px repeat(3, minmax(70px, 1fr)); gap: 6px 8px; align-items: center; }
  .hgrid .lbl { width: auto; }
  .hgrid .gh { font-size: 12px; color: var(--muted); }
  .hgrid input { width: 100%; }
  /* 패널이 세로 flex 라 flex-shrink 로 눌려 잘리던 미리보기 상자들: 줄이지 않는다 */
  .preview { flex: none; border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; background: var(--bg); }
  .preview p { margin: 6px 0; }
  .pv-h { font-weight: 700; }
  .pv-code { flex: none; margin: 0; padding: 8px 12px; border-radius: 6px; background: var(--code-bg, var(--surface)); overflow-x: auto; white-space: pre; }
  .colors { display: flex; flex-direction: column; gap: 6px; }
  .crow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .crow .hex { width: 88px; font-family: var(--font-code); }
  .warn.block { flex-basis: 100%; }
  .warn { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; color: var(--danger); }
  .swatch { flex: none; border: 1px solid; border-radius: 8px; padding: 10px 14px; display: flex; gap: 12px; align-items: center; }
  .chip { border-radius: 6px; padding: 2px 10px; font-size: 13px; }
  .filebtn { position: relative; display: inline-flex; align-items: center; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 8px; padding: 5px 12px; cursor: pointer; }
  .filebtn:hover { background: var(--hover); }
  .filebtn input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
  @media (max-width: 720px) {
    .lbl { width: 100%; }
  }
</style>
