<script lang="ts">
  // 설정 창 옆에 따로 떠 있는 '섬' 모양의 실시간 미리보기(설정 창 안은 조정에 집중하도록 비워 둔다).
  // 디자인 편집기의 실시간 미리보기: 실제 편집기와 같은 클래스(.milkdown .ProseMirror)로 샘플 글을 그려
  // 서체·간격·제목·인용·코드·표·선택·코멘트 표시가 지금 설정 그대로 보이게 한다.
  // 편집 중인 팔레트(라이트/다크)의 색은 이 상자 안에서만 덮어써서, 앱의 현재 테마와 무관하게 골라 볼 수 있다.
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import { design } from '../design/state.svelte';
  import { derivePalette } from '../design/colors';
  import { tip } from '../tooltip.svelte';

  import { dui } from '../design/ui.svelte';

  const mode = $derived(dui.mode);
  const onmode = (m: 'light' | 'dark') => { dui.mode = m; };

  const vars = $derived.by(() => {
    const v = derivePalette(design.palettes[mode], mode);
    v['--selection-bg'] = `color-mix(in srgb, ${design.palettes[mode].accent} ${mode === 'dark' ? 52 : 38}%, transparent)`;
    if (mode === 'dark') {
      v['--comment'] = '#facc15'; v['--comment-bg'] = 'rgba(250, 204, 21, 0.22)'; v['--comment-bg-strong'] = 'rgba(250, 204, 21, 0.42)';
    } else {
      v['--comment'] = '#ca8a04'; v['--comment-bg'] = 'rgba(250, 204, 21, 0.28)'; v['--comment-bg-strong'] = 'rgba(250, 204, 21, 0.5)';
    }
    return Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';');
  });
</script>

<div class="dpv">
  <div class="dpv-bar">
    <span class="t">미리보기</span>
    <div class="seg" role="group" aria-label="미리볼 모드">
      <button class:active={mode === 'light'} onclick={() => onmode('light')} aria-label="라이트로 보기" use:tip={'라이트 팔레트로 보기'}><Sun size={14} /></button>
      <button class:active={mode === 'dark'} onclick={() => onmode('dark')} aria-label="다크로 보기" use:tip={'다크 팔레트로 보기'}><Moon size={14} /></button>
    </div>
  </div>
  <div class="dpv-body">
    <div class="dpv-frame" style={vars}>
      <div class="milkdown">
        <div class="ProseMirror" aria-hidden="true">
          <h1>글쓰기 미리보기</h1>
          <p>가나다라 마바사 아자차카 — The quick brown fox. 본문에는 <strong>굵은 글씨</strong>와 <code>인라인 코드</code>, <a href="#top" onclick={(e) => e.preventDefault()}>링크</a>가 들어갑니다. <span class="dpv-sel">드래그로 선택한 글자</span>와 <span class="cm-comment">코멘트가 달린 글자</span>도 이렇게 보입니다.</p>
          <h2>둘째 제목</h2>
          <blockquote><p>인용문은 이렇게 보입니다. 왼쪽 선의 굵기와 색을 바꿔 보세요.</p></blockquote>
          <ul><li>목록 항목 하나</li><li>목록 항목 둘</li></ul>
          <pre class="dpv-code"><code>const 인사 = 'Hello, 세계';</code></pre>
          <div class="milkdown-table-block"><table><tbody>
            <tr><th>항목</th><th>값</th></tr>
            <tr><td>첫째</td><td>1</td></tr>
            <tr><td>둘째</td><td>2</td></tr>
            <tr><td>셋째</td><td>3</td></tr>
          </tbody></table></div>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .dpv { height: 100%; display: flex; flex-direction: column; background: var(--surface); }
  .dpv-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); flex: none; }
  .dpv-body { flex: 1; min-height: 0; padding: 12px; display: flex; }
  .dpv-bar .t { font-size: 12.5px; color: var(--muted); font-weight: 600; margin-right: auto; }
  .seg { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); }
  .seg button { display: inline-flex; padding: 3px 8px; border: 0; background: transparent; border-radius: 6px; color: var(--muted); }
  .seg button.active { background: var(--accent-soft); color: var(--text); }
  /* 미리보기 상자: 실제 편집기와 같은 배경·글자색을 쓴다(색은 상자 안에서만 덮어씀) */
  .dpv-frame { flex: 1; min-width: 0; overflow: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); }
  .dpv-frame :global(.milkdown .ProseMirror) { padding: 14px 20px 18px; max-width: none; margin: 0; min-height: 0; outline: none; background: var(--bg); color: var(--text); }
  .dpv-frame :global(.milkdown .ProseMirror > :first-child) { margin-top: 0; }
  .dpv-frame :global(.dpv-sel) { background: var(--selection-bg); }
  .dpv-frame :global(.dpv-code) {
    margin: 12px 0; padding: 8px 12px; border-radius: 6px; background: var(--code-bg); overflow-x: auto; white-space: pre;
    font-family: var(--ed-code-font, var(--font-code)); font-size: calc(1em * var(--ed-code-scale, 0.93));
  }
  .dpv-frame :global(.dpv-code code) { background: transparent; padding: 0; font: inherit; }
</style>
