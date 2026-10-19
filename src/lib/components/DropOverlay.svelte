<script lang="ts">
  // 창 전체에서 문서 파일(.md/.txt/.docx) 드롭을 받는다.
  // 이미지 파일은 에디터의 자체 드롭 처리(이미지 삽입)에 맡긴다.
  export interface DropItem {
    file: File;
    // 드롭 이벤트 안에서 동기적으로 요청해 둔 File System Access 핸들 (미지원이면 null)
    handle: Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  let { onDrop }: { onDrop: (items: DropItem[]) => void } = $props();

  let dragging = $state(false);
  let depth = 0;

  const hasDocDrag = (dt: DataTransfer | null) =>
    !!dt && [...dt.items].some((i) => i.kind === 'file' && !i.type.startsWith('image/'));

  function enter(e: DragEvent) {
    if (!hasDocDrag(e.dataTransfer)) return;
    depth++;
    dragging = true;
  }
  function leave() {
    if (--depth <= 0) { depth = 0; dragging = false; }
  }
  function over(e: DragEvent) {
    if (!hasDocDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  }
  function drop(e: DragEvent) {
    depth = 0;
    dragging = false;
    const dt = e.dataTransfer;
    if (!hasDocDrag(dt)) return;
    e.preventDefault();
    const items: DropItem[] = [];
    for (const it of dt!.items) {
      if (it.kind !== 'file' || it.type.startsWith('image/')) continue;
      const file = it.getAsFile();
      if (!file) continue;
      const getter = (it as DataTransferItem & { getAsFileSystemHandle?: () => Promise<unknown> }).getAsFileSystemHandle;
      let handle: Promise<any> = Promise.resolve(null); // eslint-disable-line @typescript-eslint/no-explicit-any
      try { if (getter) handle = getter.call(it).catch(() => null); } catch { /* 보안 컨텍스트가 아니면 동기 예외 — 핸들 없이 진행 */ }
      items.push({ file, handle });
    }
    // items 로 못 얻었으면(브라우저별 차이) files 로 대신 읽는다
    if (!items.length) {
      for (const file of dt!.files) if (!file.type.startsWith('image/')) items.push({ file, handle: Promise.resolve(null) });
    }
    if (items.length) onDrop(items);
  }
</script>

<svelte:window ondragentercapture={enter} ondragleavecapture={leave} ondragovercapture={over} ondropcapture={drop} />

{#if dragging}
  <div class="drop-overlay">.md · .txt · .docx · .zip 파일을 여기에 놓아 새 문서 만들기</div>
{/if}
