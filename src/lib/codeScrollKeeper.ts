// Crepe 코드 블록은 화면 근처에서 placeholder -> CodeMirror 로 바뀌고, 벗어나면 다시 placeholder 로 돌아간다.
// 그때마다 블록 높이가 달라지는데, iOS Safari 는 overflow-anchor(스크롤 앵커링)를 지원하지 않아
// 뷰포트 위쪽 블록의 높이 변화가 보던 위치를 그대로 밀어 버린다. 높이 변화량만큼 scrollTop 을 직접 보정한다.
export function keepScrollOnCodeResize(host: HTMLElement): () => void {
  const wrap = host.closest<HTMLElement>('.editor-wrap');
  if (!wrap) return () => {};
  const heights = new WeakMap<Element, number>();
  const ro = new ResizeObserver((entries) => {
    let delta = 0;
    const top = wrap.getBoundingClientRect().top;
    for (const e of entries) {
      const h = e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height;
      const prev = heights.get(e.target);
      heights.set(e.target, h);
      if (prev === undefined || prev === h) continue;
      if (e.target.contains(document.activeElement)) continue; // 편집 중인 블록은 건드리지 않는다
      if (e.target.getBoundingClientRect().top < top) delta += h - prev; // 뷰포트 위쪽에서 시작하는 블록만
    }
    if (delta) wrap.scrollTop += delta;
  });
  const watch = (root: ParentNode) => root.querySelectorAll('.milkdown-code-block').forEach((el) => ro.observe(el));
  watch(host);
  const mo = new MutationObserver(() => watch(host)); // observe 는 중복 호출해도 안전하다
  mo.observe(host, { childList: true, subtree: true });
  return () => { mo.disconnect(); ro.disconnect(); };
}
