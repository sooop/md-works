// 이름 변경 뒤 링크 갱신을 부르고 결과를 토스트로 알린다. 예외를 던지지 않는다 — 이름 변경 자체는 이미 끝났고 되돌리지 않는다.
import { toast, errMsg } from '../store.svelte';
import type { LinkHost } from './host';
import { fixLinksAfterMove, type LinkMove } from './rename';

export async function updateLinksAfterMove(host: LinkHost, moves: LinkMove[]): Promise<void> {
  try {
    const r = await fixLinksAfterMove(host, moves);
    if (r.links) {
      toast(`링크 ${r.links}곳을 새 이름으로 고쳤습니다` + (r.failed ? ` (글 ${r.failed}개는 저장하지 못해 그대로입니다)` : ''), r.failed ? 'error' : 'info');
    } else if (r.failed) {
      toast(`링크를 고치지 못한 글이 ${r.failed}개 있습니다(저장 실패·다른 곳에서 수정됨)`, 'error');
    }
  } catch (e) {
    toast(`링크를 고치지 못했습니다: ${errMsg(e)}`, 'error');
  }
}
