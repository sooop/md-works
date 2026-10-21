<script lang="ts">
  // 코드 테마 견본: 모든 색 종류(키워드·문자열·주석 등)가 한 번씩 나오는 짧은 코드를 주어진 팔레트 색으로 그린다.
  import type { HlKey, HlPalette } from '../design/codeThemes';

  interface Props {
    palette: HlPalette;
    bg: string;
    fg: string;
    /** 앞에서부터 보일 줄 수(카드용). 비우면 전부 */
    lines?: number;
  }
  let { palette, bg, fg, lines }: Props = $props();

  type Tok = [text: string, key: HlKey | null];
  const SAMPLE: Tok[][] = [
    [['// 합계를 구한다', 'comment']],
    [['const', 'keyword'], [' items = ', null], ['[', 'punct'], ['1', 'number'], [', ', 'punct'], ['2', 'number'], ['];', 'punct']],
    [['function', 'keyword'], [' ', null], ['sum', 'function'], ['(', 'punct'], ['xs', null], [': ', 'punct'], ['number[]', 'type'], [') {', 'punct']],
    [['  ', null], ['return', 'keyword'], [' xs.', null], ['length', 'property'], [' > ', null], ['0', 'number'], [' ? ', null], ['"있음"', 'string'], [' : ', null], ['"없음"', 'string'], [';', 'punct']],
    [['}', 'punct']],
    [['<section', 'tag'], [' ', null], ['class', 'property'], ['=', 'punct'], ['"a"', 'string'], ['>', 'tag']],
    [['+ 추가된 줄', 'inserted']],
    [['- 지워진 줄', 'deleted']],
  ];
  const shown = $derived(lines ? SAMPLE.slice(0, lines) : SAMPLE);
</script>

<pre class="cs" style:background={bg} style:color={fg}>{#each shown as line}<span class="ln">{#each line as [t, k]}{#if k}<span style:color={palette[k]} class:it={k === 'comment'}>{t}</span>{:else}{t}{/if}{/each}</span>
{/each}</pre>

<style>
  .cs { margin: 0; padding: 8px 10px; border-radius: 6px; font-family: var(--ed-code-font, var(--font-code)); font-size: 12px; line-height: 1.55; overflow: hidden; white-space: pre; }
  .ln { display: block; }
  .it { font-style: italic; }
</style>
