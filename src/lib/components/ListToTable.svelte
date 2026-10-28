<script lang="ts">
  // JSON·YAML·마크다운 목록(과 CSV·TSV·GFM·아스키·HTML 표 글자)을 붙여넣어 표로 바꿔 커서 위치에 넣는 창.
  // 형식은 내용을 보고 자동으로 정한다. 읽을 수 없으면 오류만 보이고 삽입 단추가 꺼진다.
  import { tick, untrack } from 'svelte';
  import Switch from './Switch.svelte';
  import { importToGrid, type InputFormat, type ImportResult } from '../tableList';
  import { listImport } from '../tableListUi.svelte';
  import { editorBridge, toast } from '../store.svelte';

  const MAX_ROWS = 3000;
  const PREVIEW_ROWS = 8;
  const FORMATS: { v: InputFormat; l: string }[] = [
    { v: 'auto', l: '자동' }, { v: 'json', l: 'JSON' }, { v: 'yaml', l: 'YAML' }, { v: 'md', l: '마크다운 목록' }, { v: 'table', l: '표 글자' },
  ];

  let text = $state('');
  let html = $state<string | undefined>(); // 붙여넣기 이벤트의 text/html (엑셀·웹의 서식 있는 표)
  let headerText = $state('');
  let textEl = $state<HTMLTextAreaElement>();
  let replaceOrig = $state(false); // 코드 블록에서 열었을 때: 원본 코드 블록을 표로 교체

  // 입력 중 깨진 JSON 에서 매 글자마다 계산하지 않도록 잠깐 기다린다
  let live = $state('');
  $effect(() => {
    const t = text;
    const id = setTimeout(() => { live = t; }, 200);
    return () => clearTimeout(id);
  });

  // 열 때마다 비우고 입력란에 포커스(형식·옵션은 마지막 선택을 유지)
  $effect(() => {
    if (listImport.open) {
      const s = listImport.src;
      // 여는 순간에만 비운다. text 를 읽는 쓰기가 의존성이 되면 타이핑·붙여넣기마다 다시 비워진다
      untrack(() => {
        text = s?.text ?? ''; live = text; html = undefined; headerText = ''; replaceOrig = s?.replaceDefault ?? false;
        if (s) listImport.format = s.format; // 코드 블록 언어에 맞춘다
      });
      void tick().then(() => textEl?.focus());
    }
  });

  const result = $derived.by((): { ok: ImportResult } | { err: string } | null => {
    if (!live.trim()) return null;
    try {
      const r = importToGrid(live, listImport.format, { infer: true, unflat: true, arr: listImport.arr, headerMode: listImport.headerMode, headerText }, html);
      if (r.grid.length - 1 > MAX_ROWS) return { err: `행이 ${r.grid.length - 1}개로 너무 많습니다(최대 ${MAX_ROWS}행). 배열 펼치기를 '열로' 바꾸거나 입력을 줄이세요.` };
      return { ok: r };
    } catch (e) {
      return { err: e instanceof Error ? e.message : String(e) };
    }
  });
  const grid = $derived(result && 'ok' in result ? result.ok.grid : null);

  function onPaste(e: ClipboardEvent) {
    const h = e.clipboardData?.getData('text/html');
    html = h && /<table[\s>]/i.test(h) ? h : undefined;
  }

  const close = () => { listImport.open = false; };
  function insert() {
    if (!grid) return;
    const src = listImport.src;
    if (src) {
      const done = replaceOrig ? src.replace(grid) : src.insertAfter(grid);
      if (done) { toast(replaceOrig ? `${srcName}을 표로 바꿨습니다` : `${grid.length - 1}행 × ${grid[0].length}열 표를 ${srcName} 뒤에 넣었습니다`); close(); }
      else toast(`${srcName}이 바뀌었거나 사라져 표를 넣지 못했습니다`, 'error');
      return;
    }
    if (!editorBridge.insertTable) { toast('열려 있는 문서가 없어 표를 넣을 수 없습니다', 'error'); return; }
    if (editorBridge.insertTable(grid)) { toast(`${grid.length - 1}행 × ${grid[0].length}열 표를 넣었습니다`); close(); }
  }

  function onKey(e: KeyboardEvent) {
    if (!listImport.open || e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); insert(); }
  }
  const srcName = $derived(listImport.src?.label ?? '코드 블록');
  // 입력란에서 Tab 은 포커스 이동 대신 공백 4칸 들여쓰기(여러 줄 선택이면 줄마다, Shift+Tab 은 내어쓰기) — 중첩 목록을 쓰기 위함
  const INDENT = '    ';
  function onTextKey(e: KeyboardEvent) {
    if (e.key !== 'Tab' || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLTextAreaElement;
    const { selectionStart: a, selectionEnd: b, value: v } = el;
    const put = (t: string) => { if (!document.execCommand('insertText', false, t)) el.setRangeText(t, el.selectionStart, el.selectionEnd, 'end'); }; // execCommand 는 실행 취소(Ctrl+Z)를 살린다
    if (a === b && !e.shiftKey) { put(INDENT); text = el.value; return; }
    const ls = v.lastIndexOf('\n', a - 1) + 1;
    const le = b > a && v[b - 1] === '\n' ? b - 1 : b; // 끝이 줄머리에 걸친 선택은 그 줄을 제외
    const lines = v.slice(ls, le).split('\n');
    const next = lines.map((l) => (e.shiftKey ? l.replace(/^ {1,4}|^\t/, '') : INDENT + l)).join('\n');
    el.setSelectionRange(ls, le);
    put(next);
    el.setSelectionRange(ls, ls + next.length);
    text = el.value;
  }
  const kind = $derived(result && 'ok' in result ? result.ok.kind : null);
  const showArr = $derived(listImport.format === 'json' || listImport.format === 'yaml' || kind === 'json' || kind === 'yaml');
  const showHdr = $derived(listImport.format === 'md' || kind === 'md');
</script>

<svelte:window onkeydowncapture={onKey} />

{#if listImport.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="dialog wide ltt" role="dialog" aria-modal="true" aria-label="목록·표 글자에서 표 만들기">
      <h2>목록·표 글자에서 표 만들기</h2>
      <textarea
        bind:this={textEl}
        bind:value={text}
        onpaste={onPaste}
        onkeydown={onTextKey}
        rows="9"
        spellcheck="false"
        aria-label="변환할 내용 (Tab: 들여쓰기)"
        placeholder={'JSON · YAML · 마크다운 목록 · CSV/TSV · 마크다운 표 · 아스키 표를 붙여넣거나 입력하세요.\n\n[{"이름":"사과","수량":3},{"이름":"배","수량":5}]'}
      ></textarea>

      <div class="opts">
        <div class="seg" role="radiogroup" aria-label="입력 형식">
          {#each FORMATS as f (f.v)}
            <button role="radio" aria-checked={listImport.format === f.v} class:active={listImport.format === f.v} onclick={() => (listImport.format = f.v)}>{f.l}</button>
          {/each}
        </div>
        {#if showArr}
          <label class="inline">배열은
            <select bind:value={listImport.arr}>
              <option value="cols">열로 펼치기 (items[0].sku)</option>
              <option value="rows">행으로 펼치기</option>
            </select>
          </label>
        {/if}
        {#if showHdr}
          <label class="inline">머리글
            <select bind:value={listImport.headerMode}>
              <option value="auto">자동</option>
              <option value="first">첫 항목</option>
              <option value="last">마지막 항목</option>
              <option value="none">없음 (열 1, 열 2…)</option>
            </select>
          </label>
          <label class="inline">열 이름 직접<input class="hdr" bind:value={headerText} placeholder="이름 | 수량" spellcheck="false" /></label>
        {/if}
      </div>

      <div class="preview" aria-live="polite">
        {#if !result}
          <span class="muted">내용을 넣으면 아래에 표 미리보기가 나옵니다.</span>
        {:else if 'err' in result}
          <span class="err">{result.err}</span>
        {:else}
          <div class="meta"><span class="chip">{result.ok.label}</span><span>{result.ok.grid.length - 1}행 × {result.ok.grid[0].length}열</span></div>
          <div class="scroll">
            <table>
              <thead><tr>{#each result.ok.grid[0] as h}<th>{h}</th>{/each}</tr></thead>
              <tbody>
                {#each result.ok.grid.slice(1, 1 + PREVIEW_ROWS) as r}<tr>{#each r as c}<td>{c}</td>{/each}</tr>{/each}
              </tbody>
            </table>
          </div>
          {#if result.ok.grid.length - 1 > PREVIEW_ROWS}<span class="muted">… 외 {result.ok.grid.length - 1 - PREVIEW_ROWS}행</span>{/if}
        {/if}
      </div>

      <div class="actions">
        {#if listImport.src}
          <Switch bind:checked={replaceOrig}>블럭 교체</Switch>
          <span class="hint">Ctrl+Enter · {replaceOrig ? `${srcName}이 표로 바뀝니다` : `${srcName} 바로 뒤에 들어갑니다`}</span>
        {:else}
          <span class="hint">Ctrl+Enter 로 삽입 · 커서 위치(코드·표 안이면 그 뒤)에 들어갑니다</span>
        {/if}
        <button onclick={close}>취소</button>
        <button class="primary" disabled={!grid} onclick={insert}>표 삽입</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .ltt { width: min(760px, calc(100vw - 32px)); }
  .ltt textarea { margin-bottom: 10px; }
  .opts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-bottom: 10px; }
  .seg button { padding: 3px 10px; font-size: 13px; }
  .inline { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
  .inline select, .inline .hdr { margin: 0; width: auto; padding: 3px 6px; font-size: 13px; color: var(--text); background: var(--surface); border: 1px solid var(--border-strong); border-radius: 6px; }
  .inline .hdr { width: 150px; }  .preview { min-height: 56px; margin-bottom: 12px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); font-size: 13px; display: flex; flex-direction: column; gap: 6px; }
  .muted { color: var(--muted); }
  .err { color: var(--danger, #c0392b); white-space: pre-wrap; }
  .meta { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 12.5px; }
  .chip { background: var(--accent-soft); color: var(--text); border-radius: 10px; padding: 1px 8px; }
  .scroll { max-height: 220px; overflow: auto; }
  table { border-collapse: collapse; font-size: 12.5px; width: 100%; }
  th, td { padding: 3px 8px; border: 1px solid var(--border); text-align: left; vertical-align: top; white-space: pre-wrap; }
  th { background: var(--surface-2); position: sticky; top: 0; }
</style>
