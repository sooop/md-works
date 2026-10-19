<script lang="ts">
  // 집필 UI 의 전역 동작(마크업 없음): 집중 모드 단축키/Esc, <html> 클래스, 선택 글자 수, 타자기 스크롤.
  import { doc } from '../store.svelte';
  import { writing, toggleFocus } from '../writing/state.svelte';
  import { countText } from '../writing/countChars';
  import { typewriterDelta, clampScrollTop } from '../writing/typewriter';
  import '../writing/writing.css';

  $effect(() => {
    document.documentElement.classList.toggle('focus-mode', writing.focus);
    return () => document.documentElement.classList.remove('focus-mode');
  });

  function onKey(e: KeyboardEvent) {
    // Ctrl+Alt+Enter: 집중 모드 토글 (F11 은 브라우저가 가로챈다)
    if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      toggleFocus();
      return;
    }
    // Ctrl+E: 읽기 | 편집 전환 (README 에 있으나 코드에 구현이 없어 여기서 처리한다)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'e' && doc.path) {
      e.preventDefault();
      doc.edit = !doc.edit;
      return;
    }
  }

  // Esc: 집중 모드 해제. 에디터(ProseMirror)가 Esc 의 기본 동작을 먼저 막아 버려서 defaultPrevented 로는 판단할 수 없으므로
  // 캡처 단계에서 받고, 대화상자·메뉴가 열려 있거나 IME 조합 중이면 그쪽 Esc 로 넘긴다.
  function onEscCapture(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !writing.focus || e.isComposing) return;
    if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
    toggleFocus(false);
  }

  // ---- 선택 영역 글자 수 ----
  function onSelection() {
    const sel = document.getSelection();
    const node = sel?.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement;
    const inEditor = (n: Node | null | undefined) => {
      const e = n instanceof Element ? n : n?.parentElement;
      return !!e?.closest('.editor-wrap .ProseMirror');
    };
    // Ctrl+A(전체 선택)는 anchor 가 .ProseMirror 바깥(래퍼)이나 비편집 노드뷰에 놓일 수 있다.
    // anchor 가 에디터 밖이어도 선택의 공통 조상이 에디터 안이거나, 포커스가 에디터에 있으면 에디터 선택으로 본다.
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const active = document.activeElement;
    const inside = inEditor(el) || inEditor(range?.commonAncestorContainer)
      || (!!active?.closest?.('.editor-wrap .ProseMirror') && !!range && range.intersectsNode(active as Node));
    if (!sel || sel.isCollapsed || !inside) {
      if (writing.selection) writing.selection = 0;
      return;
    }
    writing.selection = countText(sel.toString(), { spaces: writing.spaces });
  }

  // ---- 타자기 스크롤: 입력·캐럿 이동 직후에만 캐럿 줄을 세로 중앙 근처로 부드럽게 맞춘다.
  // 사용자가 직접 스크롤하는 동안에는 입력 이벤트가 없으므로 간섭하지 않는다.
  let raf = 0;
  function centerCaret(e: Event) {
    if (!writing.focus) return;
    const target = e.target as Element | null;
    if (!target?.closest?.('.editor-wrap .ProseMirror')) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const wrap = (document.activeElement as Element | null)?.closest('.editor-wrap') as HTMLElement | null;
      const sel = document.getSelection();
      if (!wrap || !sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      let r = range.getClientRects()[0] ?? range.getBoundingClientRect();
      if (!r || (r.height === 0 && r.top === 0)) {
        const n = sel.focusNode;
        const el = n instanceof Element ? n : n?.parentElement;
        if (!el) return;
        r = el.getBoundingClientRect();
      }
      const box = wrap.getBoundingClientRect();
      const delta = typewriterDelta({ caretTop: r.top - box.top, caretBottom: r.bottom - box.top, viewHeight: wrap.clientHeight });
      if (!delta) return;
      const top = clampScrollTop(wrap.scrollTop, delta, wrap.scrollHeight, wrap.clientHeight);
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      wrap.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
    });
  }
  function onKeyUp(e: KeyboardEvent) {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) centerCaret(e);
  }
</script>

<svelte:window onkeydowncapture={onEscCapture} onkeydown={onKey} onkeyup={onKeyUp} oninput={centerCaret} />
<svelte:document onselectionchange={onSelection} />
