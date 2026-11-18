<script lang="ts">
  // 읽기 모드 '코멘트 보기': 문서 끝(각주 정의 아래)에 붙는 읽기 전용 코멘트 절. 문서 내용·저장되는 마크다운과 무관하다.
  import { cm } from '../comments/store.svelte';
  import { commentRows } from '../comments/numbering';
  import { buildCommentSection } from '../comments/readView';

  let box: HTMLDivElement;
  // 코멘트(해결 여부·답글)·위치가 바뀌면 다시 만든다. 사용자 글은 textContent 로만 들어간다
  $effect(() => {
    const el = cm.loaded ? buildCommentSection(commentRows(cm.items, cm.ranges)) : null;
    box.replaceChildren(...(el ? [el] : []));
  });
</script>

<div bind:this={box} class="cm-readbox"></div>

<style>
  .cm-readbox { display: contents; }
</style>
