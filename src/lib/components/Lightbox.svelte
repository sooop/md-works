<script lang="ts">
  // 본문 이미지를 팝오버로 띄워 확대·이동해 본다. 읽기 모드는 클릭, 편집 모드는 더블클릭(단일 클릭은 이미지 선택용)으로 연다.
  import { tick } from 'svelte';

  interface Props {
    /** 이미지 클릭을 들을 영역(.editor-wrap) */
    root: HTMLElement | null;
    /** 읽기 모드면 true — 클릭으로 열고, 아니면 더블클릭으로 연다 */
    readMode: boolean;
  }
  let { root, readMode }: Props = $props();

  const MIN = 0.25;
  const MAX = 8;

  let src = $state<string | null>(null);
  let scale = $state(1);
  let tx = $state(0);
  let ty = $state(0);
  let drag: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
  let closeBtn = $state<HTMLButtonElement | null>(null);
  let opener: HTMLElement | null = null;

  async function open(img: HTMLImageElement): Promise<void> {
    const url = img.currentSrc || img.src;
    if (!url) return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    reset();
    src = url;
    await tick();
    closeBtn?.focus();
  }
  function reset(): void { scale = 1; tx = 0; ty = 0; }
  function zoom(factor: number): void {
    scale = Math.max(MIN, Math.min(MAX, scale * factor));
    if (scale === 1) { tx = 0; ty = 0; }
  }
  function close(): void {
    if (src === null) return;
    src = null;
    opener?.focus?.();
    opener = null;
  }

  /**
   * 이벤트 대상에서 이미지를 찾는다. 이미지가 선택되면 Milkdown 이 이미지를 감싸는 요소(.image-wrapper)를 위에 올려서
   * 두 번째 클릭(더블클릭)의 대상이 <img> 가 아니라 감싸는 요소가 되므로, 거기서 안쪽 <img> 를 찾아야 한다.
   */
  function imageAt(t: EventTarget | null): HTMLImageElement | null {
    const el = t as Element | null;
    const img = el?.closest?.('img') ?? el?.closest?.('.milkdown-image-block, .milkdown-image-inline, .image-wrapper')?.querySelector('img') ?? null;
    return img && img.closest('.milkdown .ProseMirror') ? (img as HTMLImageElement) : null;
  }

  $effect(() => {
    if (!root) { src = null; return; }
    const el = root;
    const type = readMode ? 'click' : 'dblclick';
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.defaultPrevented) return;
      const img = imageAt(e.target);
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      void open(img);
    };
    el.addEventListener(type, onClick, true);
    return () => { el.removeEventListener(type, onClick, true); src = null; };
  });

  $effect(() => {
    if (src === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Tab') { e.preventDefault(); closeBtn?.focus(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1.25); }
      else if (e.key === '-') { e.preventDefault(); zoom(0.8); }
      else if (e.key === '0') { e.preventDefault(); reset(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    zoom(Math.exp(-e.deltaY * 0.0015));
  }
  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, tx, ty, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent): void {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    tx = drag.tx + dx;
    ty = drag.ty + dy;
  }
  function onPointerUp(): void { drag = null; }
  function onImgDblClick(e: MouseEvent): void {
    e.stopPropagation();
    if (scale === 1) zoom(2); else reset();
  }
</script>

{#if src !== null}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="lb-backdrop" role="dialog" aria-modal="true" aria-label="이미지 확대 보기" tabindex="-1" onclick={close} onwheel={onWheel}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
    <img
      class="lb-img"
      {src}
      alt="확대 이미지"
      draggable="false"
      style:transform="translate({tx}px, {ty}px) scale({scale})"
      onclick={(e) => e.stopPropagation()}
      ondblclick={onImgDblClick}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
    />
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="lb-bar" onclick={(e) => e.stopPropagation()}>
      <button type="button" aria-label="축소" title="축소 (-)" onclick={() => zoom(0.8)}>−</button>
      <button type="button" class="pct" aria-label="원래 크기" title="맞춤 (0)" onclick={reset}>{Math.round(scale * 100)}%</button>
      <button type="button" aria-label="확대" title="확대 (+)" onclick={() => zoom(1.25)}>+</button>
    </div>
    <button bind:this={closeBtn} type="button" class="lb-close" aria-label="닫기" onclick={close}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
    </button>
  </div>
{/if}

<style>
  .lb-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 1000);
    /* 테마와 무관하게 뒤 콘텐츠를 완전히 가리는 진한 스크림 */
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: zoom-out;
  }
  .lb-img {
    max-width: 90vw;
    max-height: 90vh;
    object-fit: contain;
    border-radius: 4px;
    transform-origin: center;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .lb-img:active { cursor: grabbing; }
  .lb-bar {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 2px;
    padding: 4px;
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.15);
  }
  .lb-bar button {
    min-width: 36px;
    height: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: 16px;
    background: transparent;
    color: rgba(255, 255, 255, 0.92);
    font-size: 16px;
    cursor: pointer;
  }
  .lb-bar button.pct { min-width: 60px; font-size: 13px; }
  .lb-bar button:hover { background: rgba(255, 255, 255, 0.25); }
  .lb-close {
    position: fixed;
    top: 16px;
    right: 20px;
    width: 36px;
    height: 36px;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 0;
    background: rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.92);
    cursor: pointer;
  }
  .lb-close:hover { background: rgba(255, 255, 255, 0.3); }
  .lb-close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
