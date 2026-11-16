// PWA 아이콘 자원. 원본은 src/lib/pwa/assets (icon-forge 로 만든 Claude 오렌지 문서 아이콘).
// maskable 은 OS 가 모서리를 잘라내므로 안전 영역에 그림을 모은 별도 PNG 를 쓴다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 크림 테마 배경색(presets.ts 의 cream light.bg) */
export const PWA_BG = '#faf9f5';

/** 산출물에 그대로 복사하는 아이콘 파일(파일 이름 = 산출물 경로) */
export const ICON_FILES = [
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-192.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'favicon.ico',
  'favicon-16x16.png',
  'favicon-32x32.png',
] as const;

export function readIcon(name: (typeof ICON_FILES)[number]): Uint8Array {
  return readFileSync(fileURLToPath(new URL(`./assets/${name}`, import.meta.url)));
}
