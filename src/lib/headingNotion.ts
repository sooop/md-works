// 제목 편집을 Notion 처럼: `## ` 입력은 level 을 더하지 않고 그 개수로 정하고, 블록 맨 앞 Backspace 는 한 번에 일반 문단으로 바꾼다.
// (Milkdown 기본은 `# ` 가 level 을 더하고, Backspace 가 한 단계씩 내린다)
import type { Editor } from '@milkdown/kit/core';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { SchemaReady, inputRulesCtx, commandsCtx } from '@milkdown/kit/core';
import { downgradeHeadingCommand, headingSchema, paragraphSchema } from '@milkdown/kit/preset/commonmark';
import { setBlockType } from '@milkdown/kit/prose/commands';
import { textblockTypeInputRule } from '@milkdown/kit/prose/inputrules';

const headingInput: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SchemaReady);
  const rule = textblockTypeInputRule(/^(#{1,6})\s$/, headingSchema.type(ctx), (m) => ({ level: m[1].length }));
  ctx.update(inputRulesCtx, (rules) => [
    ...rules.filter((r) => {
      const m = (r as unknown as { match?: unknown }).match;
      return !(m instanceof RegExp && m.source.includes('hashes'));
    }),
    rule,
  ]);
};

export function notionHeading(editor: Editor) {
  editor.use(headingInput);
}

/** 에디터가 만들어진 뒤 호출: 제목 맨 앞 Backspace/Delete 명령을 "바로 문단으로"로 바꾼다 */
export function notionHeadingBackspace(editor: Editor) {
  editor.action((ctx) => {
    const paragraph = paragraphSchema.type(ctx);
    ctx.get(commandsCtx).create(downgradeHeadingCommand.key, () => (state, dispatch, view) => {
      const { $from, empty } = state.selection;
      if (!empty || $from.parentOffset !== 0 || $from.parent.type !== headingSchema.type(ctx)) return false;
      return setBlockType(paragraph)(state, dispatch, view);
    });
  });
}
