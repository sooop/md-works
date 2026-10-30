// 코드 블록을 복사할 때: 순수 코드가 아니라 백틱 세 개 + 언어명의 마크다운 소스(펜스 코드 블록)로 넘긴다.
// 줄 번호·언어 선택 같은 블록 장식은 문서 내용이 아니라서 들어가지 않는다(화면의 장식은 CSS 로 선택 불가).
import type { Slice } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

function fence(lang: string, code: string): string {
  // 코드 안에 백틱 줄이 있어도 닫히지 않도록, 코드에 나온 가장 긴 연속 백틱보다 길게 연다
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((m) => m.length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${lang}\n${code}\n${ticks}`;
}

export function clipboardText(slice: Slice): string {
  const parts: string[] = [];
  slice.content.forEach((n) => {
    parts.push(n.type.name === 'code_block' ? fence(String(n.attrs.language ?? ''), n.textContent) : n.textBetween(0, n.content.size, '\n\n'));
  });
  return parts.join('\n\n');
}

export const codeClipboard = $prose(
  () =>
    new Plugin({
      props: {
        // 코드 블록이 들어 있는 조각만 바꾸고, 나머지는 ProseMirror 기본 직렬화와 같게 둔다
        clipboardTextSerializer(slice) {
          let hasCode = false;
          slice.content.forEach((n) => { if (n.type.name === 'code_block') hasCode = true; });
          return hasCode ? clipboardText(slice) : slice.content.textBetween(0, slice.content.size, '\n\n');
        },
      },
    }),
);
