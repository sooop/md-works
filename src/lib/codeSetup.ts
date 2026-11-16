import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { crosshairCursor, drawSelection, dropCursor, highlightSpecialChars, keymap, rectangularSelection, tooltips } from '@codemirror/view';
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, type CompletionContext } from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import { basicSetup } from 'codemirror';

/** 수식 블록($$)에서 `\\` 를 입력하면 줄바꿈 + 줄 간격 선택지를 띄운다(Tab/Enter 로 선택, Esc 로 닫기).
 *  일반 코드 블록에서는 나타나지 않는다. */
const LINE_BREAKS: [string, string][] = [
  ['\\\\', '줄바꿈'],
  ['\\\\[0.3em]', '줄바꿈 + 약간 띄움 (0.3em)'],
  ['\\\\[0.6em]', '줄바꿈 + 띄움 (0.6em)'],
  ['\\\\[1em]', '줄바꿈 + 넓게 띄움 (1em)'],
  ['\\\\[2em]', '줄바꿈 + 아주 넓게 (2em)'],
];
function latexLineBreak(ctx: CompletionContext) {
  if (!ctx.view?.dom.closest('.mo-latex-block')) return null;
  const m = ctx.matchBefore(/(?<!\\)\\\\$/);
  if (!m) return null;
  return {
    from: m.from,
    filter: false,
    options: LINE_BREAKS.map(([label, detail]) => ({ label, detail, type: 'text' })),
  };
}

/** codemirror 의 basicSetup 에서 줄 번호·접기·자동완성(단어 추천)·현재 줄 강조를 뺀 구성.
 *  코드 블록이 정적 렌더(placeholder)와 편집(CodeMirror)에서 색 외에는 같은 레이아웃이 되도록 한다. */
export const codeSetup: Extension[] = [
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  rectangularSelection(),
  crosshairCursor(),
  highlightSelectionMatches(),
  tooltips({ parent: document.body, position: 'fixed' }), // 편집 상자(overflow: hidden) 밖으로 띄워 잘리지 않게 한다
  autocompletion({ override: [latexLineBreak], icons: false, defaultKeymap: true }),
  keymap.of([{ key: 'Tab', run: acceptCompletion }, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...lintKeymap]),
];

/** Crepe 가 넣은 basicSetup 을 codeSetup 으로 교체한다 */
export function swapBasicSetup(exts: Extension[]): Extension[] {
  return exts.map((e) => (e === basicSetup ? codeSetup : e));
}
