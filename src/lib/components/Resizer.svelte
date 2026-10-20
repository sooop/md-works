<script lang="ts">
  // 사이드바 가장자리를 끌어 폭을 조절하는 손잡이. 방향키·Home/End·더블클릭 초기화도 지원한다.
  interface Props {
    side: 'left' | 'right'; // 손잡이가 놓인 쪽(왼쪽 패널은 오른쪽 가장자리에 둔다)
    value: number; min: number; max: number; def: number; label: string;
    onchange: (w: number, save: boolean) => void;
  }
  let { side, value, min, max, def, label, onchange }: Props = $props();
  let drag: { x: number; w: number } | null = null;
  const dir = $derived(side === 'left' ? 1 : -1); // 왼쪽 패널은 오른쪽으로 끌면 넓어진다

  function down(e: PointerEvent) {
    drag = { x: e.clientX, w: value };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
  }
  function move(e: PointerEvent) { if (drag) onchange(drag.w + dir * (e.clientX - drag.x), false); }
  function up() {
    if (!drag) return;
    drag = null;
    document.body.style.userSelect = '';
    onchange(value, true);
  }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowRight') { e.preventDefault(); onchange(value + dir * step, true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); onchange(value - dir * step, true); }
    else if (e.key === 'Home') { e.preventDefault(); onchange(min, true); }
    else if (e.key === 'End') { e.preventDefault(); onchange(max, true); }
  }
</script>

<!-- 포커스 가능한 separator(값이 있는 위젯)라 방향키로 조절한다 -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="sb-resizer {side}"
  role="separator"
  aria-orientation="vertical"
  aria-label="{label} (방향키, 더블클릭으로 초기화)"
  aria-valuenow={value}
  aria-valuemin={min}
  aria-valuemax={max}
  tabindex="0"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  ondblclick={() => onchange(def, true)}
  onkeydown={key}
></div>
