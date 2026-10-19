// 물결표(~) 처리: GFM 기본 동작은 `~A~`(물결 1개)도 취소선으로 읽고, 저장할 때 `~~A~~` 로 바꾸며 글자 그대로의 `~` 는 `\~` 로 이스케이프한다.
// `10~20 … 30~40` 처럼 범위를 뜻하는 `~` 가 섞이면 의도치 않게 취소선이 되고, 편집하면 파일의 모든 `~` 가 바뀌는 문제가 있다.
// 여기서는 취소선을 `~~A~~`(물결 2개)로만 인식하고, 글자 그대로의 `~` 는 저장할 때도 건드리지 않는다.
import type { Editor } from '@milkdown/kit/core';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { SchemaReady, inputRulesCtx } from '@milkdown/kit/core';
import { remarkGFMPlugin, strikethroughSchema } from '@milkdown/kit/preset/gfm';
import { markRule } from '@milkdown/kit/prose';
import { $remark } from '@milkdown/kit/utils';

interface ToMarkdownExt { unsafe?: { character?: string; after?: string }[]; extensions?: ToMarkdownExt[] }

// remark-gfm 의 to-markdown 확장은 하위 확장(extensions)을 품고 있어 재귀로 훑는다
function dropTildeEscapes(e: ToMarkdownExt) {
  if (e.unsafe) e.unsafe = e.unsafe.filter((u) => u.character !== '~');
  e.extensions?.forEach(dropTildeEscapes);
}

// remark-gfm 이 등록한 to-markdown 확장에서 `~` 이스케이프 규칙을 빼고, `~~` 만 이스케이프하게 한다(글자 그대로의 `~~` 가 취소선으로 되살아나지 않도록)
const literalTilde = $remark('literalTilde', () => function (this: { data(): object }) {
  const data = this.data() as Record<string, unknown>;
  const exts = (data.toMarkdownExtensions ??= []) as ToMarkdownExt[];
  exts.forEach(dropTildeEscapes);
  exts.push({ unsafe: [{ character: '~', after: '~' }] });
});

// 편집 중 `~A~ ` 입력으로 취소선이 되는 입력 규칙을 `~~A~~` 전용으로 바꾼다
const doubleTildeInput: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SchemaReady);
  const rule = markRule(/(?<![\w:/])(~~)(.+?)\1(?!\w|\/)$/, strikethroughSchema.type(ctx));
  ctx.update(inputRulesCtx, (rules) => [
    ...rules.filter((r) => {
      const m = (r as unknown as { match?: unknown }).match;
      return !(m instanceof RegExp && m.source.includes('~{1,2}'));
    }),
    rule,
  ]);
};

export function onlyDoubleTilde(editor: Editor) {
  editor
    .config((ctx) => { ctx.set(remarkGFMPlugin.options.key, { singleTilde: false }); })
    .use(literalTilde)
    .use(doubleTildeInput);
}
