// 'PDF로 저장': 브라우저 인쇄 대화상자의 'PDF로 저장'을 쓴다(pandoc-wasm 에는 PDF 엔진이 없다). 인쇄 동작 자체는 printDoc 그대로.
import { printDoc } from '../printCode';
import { toast } from '../store.svelte';

export async function savePdf() {
  toast("인쇄 창에서 대상(프린터)을 'PDF로 저장'으로 고르세요");
  // window.print() 는 화면을 멈추므로, 토스트가 먼저 그려질 틈을 준다
  await new Promise((r) => setTimeout(r, 150));
  await printDoc();
}
