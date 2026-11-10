/** 인라인 수식 편집 팝오버: Ctrl/Cmd+Enter 로 적용(Crepe 는 Enter 와 확인 단추만 지원) */
export function attachLatexKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.isComposing) return;
    const t = e.target as HTMLElement | null;
    const pop = t?.closest?.('.milkdown-latex-inline-edit');
    if (!pop) return;
    const btn = pop.querySelector('button');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  };
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}
