// 사이드카 파티션(글 이름) ↔ 폴더 이름. server/worksStore.js 의 encPart/decPart 와 같아야 한다(tests/bundle 이 대조한다).
// 서버 모듈을 직접 import 하면 node:fs 가 브라우저 빌드에 끌려오므로 복사해 둔다.
// 파일 시스템에 쓸 수 없는 글자(윈도 기준)와 맨 앞 '.', 끝의 '.'·공백만 %XX 로 바꾼다 (한글 등은 그대로 둔다)
export const encPart = (s: string): string =>
  s.replace(/[\/:*?"<>|%\x00-\x1f]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
    .replace(/^\./, '%2e').replace(/[. ]$/, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
export const decPart = (s: string): string => s.replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
