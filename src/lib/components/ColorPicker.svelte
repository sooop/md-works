<script lang="ts">
  // 색 선택기: 채도·명도 면 + 색상환(색조) 슬라이더 + 16진수 + '배경에 섞기'(투명도 대신 불투명한 색으로 저장) + 대비 표시
  import { untrack } from 'svelte';
  import Pop from './Pop.svelte';
  import { tip } from '../tooltip.svelte';
  import { hexToHsv, hsvToHex, blendOver } from '../design/generate';
  import { normalizeHex, contrastRatio } from '../design/colors';

  interface Props {
    value: string;
    /** 섞기의 바탕이 되는 색(보통 팔레트의 배경) */
    bg: string;
    label: string;
    /** 이 색과의 대비비를 보여 준다(글자색이면 배경, 배경이면 글자색). 비우면 표시하지 않음 */
    against?: string;
    /** false 면 섞기 슬라이더를 숨긴다(배경색 자신 등) */
    mixable?: boolean;
    /** 색을 적용한다. 적용하지 못했으면(대비 보호) false */
    onpick: (hex: string) => boolean;
  }
  let { value, bg, label, against = '', mixable = true, onpick }: Props = $props();

  let open = $state(false);
  let h = $state(0), s = $state(0), v = $state(0);
  let mix = $state(100);
  let hexText = $state('');
  let sv: HTMLDivElement | undefined = $state();

  // 열 때만 현재 값에서 시작한다(고르는 동안 value 가 바뀌어도 슬라이더가 되돌려지지 않게)
  $effect(() => {
    if (!open) return;
    untrack(() => {
      [h, s, v] = hexToHsv(value);
      mix = 100;
      hexText = value;
    });
  });

  const base = $derived(hsvToHex([h, s, v]));
  const result = $derived(mixable && mix < 100 ? blendOver(bg, base, mix) : base);
  const ratio = $derived(against ? contrastRatio(result, against) : 0);

  function apply() {
    const ok = onpick(result);
    if (ok) hexText = result;
  }
  function svAt(e: PointerEvent) {
    if (!sv) return;
    const r = sv.getBoundingClientRect();
    s = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    v = Math.max(0, Math.min(100, (1 - (e.clientY - r.top) / r.height) * 100));
    apply();
  }
  let dragging = false;
  const down = (e: PointerEvent) => { dragging = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); svAt(e); };
  const move = (e: PointerEvent) => { if (dragging) svAt(e); };
  const up = () => { dragging = false; };
  function onSvKey(e: KeyboardEvent) {
    const d = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') s = Math.max(0, s - d);
    else if (e.key === 'ArrowRight') s = Math.min(100, s + d);
    else if (e.key === 'ArrowUp') v = Math.min(100, v + d);
    else if (e.key === 'ArrowDown') v = Math.max(0, v - d);
    else return;
    e.preventDefault();
    apply();
  }
  function onHex() {
    const hex = normalizeHex(hexText);
    if (!hex) { hexText = result; return; }
    [h, s, v] = hexToHsv(hex);
    mix = 100;
    if (!onpick(hex)) return;
    hexText = hex;
  }
</script>

<Pop bind:open label={`${label} 색 선택`} width={268}>
  {#snippet trigger({ toggle, open: o })}
    <button class="cp-swatch" class:on={o} style:background={value} aria-haspopup="dialog" aria-expanded={o} aria-label={`${label} 색 선택: ${value}`} use:tip={{ title: label, lines: [value] }} onclick={toggle}></button>
  {/snippet}
  {#snippet children()}
    <div class="cp">
      <div
        class="cp-sv" bind:this={sv} style:--hue={h} role="slider" tabindex="0" aria-label="채도와 명도"
        aria-valuetext={`채도 ${Math.round(s)}%, 명도 ${Math.round(v)}%`} aria-valuenow={Math.round(s)}
        onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={onSvKey}
      >
        <span class="cp-thumb" style:left="{s}%" style:top="{100 - v}%" style:background={base}></span>
      </div>
      <label class="cp-row"><span>색조</span><input class="cp-hue" type="range" min="0" max="360" step="1" bind:value={h} oninput={apply} aria-label="색조" /></label>
      {#if mixable}
        <label class="cp-row" use:tip={{ title: '배경에 섞기', lines: ['값이 작을수록 배경에 가까운 연한 색(투명도 대신 불투명한 색으로 저장)'] }}>
          <span>섞기</span>
          <input type="range" min="5" max="100" step="1" bind:value={mix} oninput={apply} style:--from={bg} style:--to={base} class="cp-mix" aria-label="배경에 섞기 정도" />
          <output>{mix}%</output>
        </label>
      {/if}
      <div class="cp-foot">
        <span class="cp-prev" style:background={result}></span>
        <input class="cp-hex" type="text" bind:value={hexText} maxlength="7" spellcheck="false" aria-label="16진수 색" onchange={onHex} onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) onHex(); }} />
        {#if against}
          <span class="cp-ratio" class:bad={ratio < 4.5} use:tip={'WCAG 대비비. 본문 글자는 4.5 이상을 권장합니다'}>{ratio.toFixed(1)}:1 {ratio >= 7 ? '매우 좋음' : ratio >= 4.5 ? '좋음' : ratio >= 3 ? '낮음' : '나쁨'}</span>
        {/if}
      </div>
    </div>
  {/snippet}
</Pop>

<style>
  .cp-swatch { width: 34px; height: 28px; padding: 0; border-radius: 6px; border: 1px solid var(--border-strong); flex: none; }
  .cp-swatch.on { outline: 2px solid var(--accent); outline-offset: 1px; }
  .cp { display: flex; flex-direction: column; gap: 10px; padding: 6px; }
  .cp-sv {
    position: relative; height: 150px; border-radius: 8px; cursor: crosshair; touch-action: none; border: 1px solid var(--border-strong);
    background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(calc(var(--hue) * 1deg) 100% 50%));
  }
  .cp-sv:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .cp-thumb { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5); pointer-events: none; }
  .cp-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); }
  .cp-row > span { width: 34px; flex: none; }
  .cp-row input[type='range'] { flex: 1; min-width: 0; height: 12px; border-radius: 6px; -webkit-appearance: none; appearance: none; }
  .cp-hue { background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
  .cp-mix { background: linear-gradient(to right, var(--from), var(--to)); border: 1px solid var(--border-strong); }
  .cp-row input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 2px solid #666; }
  .cp-row input[type='range']::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 2px solid #666; }
  .cp-row output { width: 36px; text-align: right; font-variant-numeric: tabular-nums; }
  .cp-foot { display: flex; align-items: center; gap: 8px; }
  .cp-prev { width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border-strong); flex: none; }
  .cp-hex { width: 84px; font-family: var(--font-code); padding: 4px 6px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--surface); }
  .cp-ratio { font-size: 12px; color: var(--muted); margin-left: auto; white-space: nowrap; }
  .cp-ratio.bad { color: var(--danger); }
</style>
