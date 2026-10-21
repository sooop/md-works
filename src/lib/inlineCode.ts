// 인라인 코드 전환 전에 선택 영역의 앞뒤 공백을 뺀다. 더블클릭으로 단어를 고르면 뒤따르는 공백까지 선택되기 때문이다.
import type { EditorView } from '@milkdown/kit/prose/view';
import { TextSelection } from '@milkdown/kit/prose/state';

/** 선택 영역을 공백 없는 범위로 줄인다. 공백뿐이거나 선택이 비어 있으면 그대로 둔다 */
export function trimSelectionSpaces(view: EditorView) {
  const { from, to, empty } = view.state.selection;
  if (empty) return;
  const text = view.state.doc.textBetween(from, to, '\n', '￼');
  const lead = text.length - text.trimStart().length;
  const trail = text.length - text.trimEnd().length;
  if ((!lead && !trail) || lead + trail >= text.length) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from + lead, to - trail)));
}
