// 글 사이 링크가 쓰는 '지금 모드의 LinkHost'. 모드 파일이 내보내는 linkHost 를 빌드 상수(__MODE__)로 골라 늦게 읽는다 —
// 쓰지 않는 모드의 코드가 번들에 들어가지 않고, 모드 파일이 이 폴더를 import 해도 순환이 생기지 않는다.
import type { LinkHost } from './host';

export const wiki = $state<{ host: LinkHost | null }>({ host: null });

if (typeof __MODE__ !== 'undefined') {
  (__MODE__ === 'server' ? import('../server-mode.svelte') : import('../standalone-mode.svelte'))
    .then((m) => { wiki.host = m.linkHost; })
    .catch(() => { /* 호스트가 없으면 링크 표시·패널은 동작하지 않는다 */ });
}
