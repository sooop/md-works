// Firefox + 한글 IME: 글자 없이 시작된 조합(compositionstart 뒤에 beforeinput 이 없다)이 compositionend 없이 열려 있으면
// 이후 키가 입력기로만 가고 에디터에는 반영되지 않는다(글자·방향키 불가, 포커스를 잃어야 풀림).
// 실제 조합 중에는 keydown.key 가 'Process' 이므로, 글자 없는 조합에서 실제 키 이름이 오면 유령 조합으로 보고 포커스를 껐다 켜 끝낸다.
import type { EditorView } from '@milkdown/kit/prose/view';

export function attachImeGuard(view: EditorView): () => void {
  const dom = view.dom;
  let composing = false;
  let gotText = false;
  const start = () => { composing = true; gotText = false; };
  const text = () => { gotText = true; };
  const end = () => { composing = false; };
  const key = (e: KeyboardEvent) => {
    if (!composing || gotText || e.key === 'Process' || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    composing = false;
    dom.blur();
    view.focus();
  };
  dom.addEventListener('compositionstart', start, true);
  dom.addEventListener('beforeinput', text, true);
  dom.addEventListener('compositionend', end, true);
  dom.addEventListener('keydown', key, true);
  return () => {
    dom.removeEventListener('compositionstart', start, true);
    dom.removeEventListener('beforeinput', text, true);
    dom.removeEventListener('compositionend', end, true);
    dom.removeEventListener('keydown', key, true);
  };
}
