<script lang="ts">
  // 글감 읽기용 마크다운 보기. snippets/markdown.ts 가 만든 AST 를 Svelte 노드로 그린다 — HTML 을 문자열로 주입하지 않는다.
  import { parseMarkdown, type Block, type Inline } from '../snippets/markdown';

  let { source }: { source: string } = $props();
  const blocks = $derived(parseMarkdown(source));
</script>

{#snippet inl(list: Inline[])}
  {#each list as n}
    {#if n.t === 'text'}{n.v}{:else if n.t === 'br'}<br />
    {:else if n.t === 'strong'}<strong>{@render inl(n.c)}</strong>
    {:else if n.t === 'em'}<em>{@render inl(n.c)}</em>
    {:else if n.t === 'del'}<del>{@render inl(n.c)}</del>
    {:else if n.t === 'code'}<code>{n.v}</code>
    {:else if n.t === 'a'}<a href={n.href} target="_blank" rel="noopener noreferrer">{@render inl(n.c)}</a>
    {:else if n.t === 'img'}<img src={n.src} alt={n.alt} loading="lazy" referrerpolicy="no-referrer" />
    {/if}
  {/each}
{/snippet}

{#snippet blk(list: Block[])}
  {#each list as b}
    {#if b.t === 'h'}
      {#if b.level === 1}<h1>{@render inl(b.c)}</h1>
      {:else if b.level === 2}<h2>{@render inl(b.c)}</h2>
      {:else if b.level === 3}<h3>{@render inl(b.c)}</h3>
      {:else if b.level === 4}<h4>{@render inl(b.c)}</h4>
      {:else if b.level === 5}<h5>{@render inl(b.c)}</h5>
      {:else}<h6>{@render inl(b.c)}</h6>{/if}
    {:else if b.t === 'p'}<p>{@render inl(b.c)}</p>
    {:else if b.t === 'code'}<!-- svelte-ignore a11y_no_noninteractive_tabindex --><pre tabindex="0"><code>{b.text}</code></pre>
    {:else if b.t === 'quote'}<blockquote>{@render blk(b.blocks)}</blockquote>
    {:else if b.t === 'hr'}<hr />
    {:else if b.t === 'list'}
      {#if b.ordered}
        <ol start={b.start}>{@render items(b.items)}</ol>
      {:else}
        <ul>{@render items(b.items)}</ul>
      {/if}
    {:else if b.t === 'table'}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="tbl" tabindex="0" role="region" aria-label="표">
        <table>
          <thead><tr>{#each b.head as c, k}<th style:text-align={b.align[k]}>{@render inl(c)}</th>{/each}</tr></thead>
          <tbody>
            {#each b.rows as r}<tr>{#each r as c, k}<td style:text-align={b.align[k]}>{@render inl(c)}</td>{/each}</tr>{/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/each}
{/snippet}

{#snippet items(list: { blocks: Block[]; checked: boolean | null }[])}
  {#each list as it}
    <li class:task={it.checked !== null}>
      {#if it.checked !== null}<input type="checkbox" checked={it.checked} disabled aria-label={it.checked ? '완료' : '미완료'} />{/if}
      <div class="li-body">{@render blk(it.blocks)}</div>
    </li>
  {/each}
{/snippet}

<div class="sn-md">{@render blk(blocks)}</div>

<style>
  .sn-md { font-size: 14.5px; line-height: 1.7; color: var(--text); overflow-wrap: anywhere; min-width: 0; }
  .sn-md > :global(:first-child) { margin-top: 0; }
  .sn-md > :global(:last-child) { margin-bottom: 0; }
  .sn-md :global(h1), .sn-md :global(h2), .sn-md :global(h3), .sn-md :global(h4), .sn-md :global(h5), .sn-md :global(h6) { margin: 1.1em 0 0.4em; line-height: 1.35; font-weight: 700; }
  .sn-md :global(h1) { font-size: 1.5em; }
  .sn-md :global(h2) { font-size: 1.3em; }
  .sn-md :global(h3) { font-size: 1.15em; }
  .sn-md :global(h4), .sn-md :global(h5), .sn-md :global(h6) { font-size: 1em; }
  .sn-md :global(p) { margin: 0 0 0.7em; }
  .sn-md :global(ul), .sn-md :global(ol) { margin: 0 0 0.7em; padding-left: 1.5em; }
  .sn-md :global(li) { margin: 0.15em 0; }
  .sn-md :global(li.task) { list-style: none; display: flex; gap: 6px; margin-left: -1.3em; }
  .sn-md :global(li.task input) { margin: 0.45em 0 0; flex: none; accent-color: var(--primary); }
  .sn-md :global(.li-body) { min-width: 0; flex: 1; }
  .sn-md :global(.li-body > p), .sn-md :global(.li-body > ul), .sn-md :global(.li-body > ol) { margin-bottom: 0.2em; }
  .sn-md :global(blockquote) { margin: 0 0 0.7em; padding: 0.1em 0 0.1em 12px; border-left: 3px solid var(--border-strong); color: var(--muted); }
  .sn-md :global(code) { font-family: var(--font-code); font-size: 0.9em; padding: 0.1em 0.35em; border-radius: 4px; background: color-mix(in srgb, var(--text) 8%, transparent); }
  .sn-md :global(pre) { margin: 0 0 0.8em; padding: 10px 12px; border-radius: 6px; background: var(--surface-2); border: 1px solid var(--border); overflow: auto; tab-size: 2; }
  .sn-md :global(pre code) { padding: 0; background: none; font-size: 0.88em; line-height: 1.55; white-space: pre; overflow-wrap: normal; }
  .sn-md :global(a) { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
  .sn-md :global(hr) { border: 0; border-top: 1px solid var(--border-strong); margin: 1em 0; }
  .sn-md :global(img) { max-width: 100%; height: auto; border-radius: 4px; vertical-align: middle; }
  .sn-md :global(.tbl) { margin: 0 0 0.8em; overflow-x: auto; max-width: 100%; }
  .sn-md :global(table) { border-collapse: collapse; font-size: 0.95em; }
  .sn-md :global(th), .sn-md :global(td) { border: 1px solid var(--border-strong); padding: 4px 10px; vertical-align: top; }
  .sn-md :global(th) { background: var(--surface-2); font-weight: 600; }
  .sn-md :global(:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
