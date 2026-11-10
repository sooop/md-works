import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { crosshairCursor, drawSelection, dropCursor, highlightSpecialChars, keymap, rectangularSelection } from '@codemirror/view';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import { basicSetup } from 'codemirror';

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
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...lintKeymap]),
];

/** Crepe 가 넣은 basicSetup 을 codeSetup 으로 교체한다 */
export function swapBasicSetup(exts: Extension[]): Extension[] {
  return exts.map((e) => (e === basicSetup ? codeSetup : e));
}
