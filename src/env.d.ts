declare const __MODE__: 'server' | 'html';
/** 빌드 옵션: false 면 애니메이션 효과와 설정 토글이 없다(단일 HTML 빌드의 ANIMATIONS=off) */
declare const __ANIM__: boolean;
/** 빌드 시점에 계산한 node_modules/pandoc-wasm 의 pandoc.wasm SHA-256(hex). 파일이 없으면 빈 문자열 */
declare const __PANDOC_WASM_SHA256__: string;
/** 정적 빌드(--mode static)에서만 true: 서비스 워커 등록·매니페스트(오프라인 설치) */
declare const __PWA__: boolean;
