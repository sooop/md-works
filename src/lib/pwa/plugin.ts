// 정적 빌드(--mode static) 전용 Vite 플러그인: 매니페스트·아이콘·sw.js 를 산출물에 더하고 index.html 에 링크를 주입한다.
import type { Plugin } from 'vite';
import { buildServiceWorker, pickPrecache, versionHash, type OutFile } from './build';
import { ICON_ANY, ICON_MASKABLE, PWA_BG } from './icons';

export const MANIFEST = {
  name: 'md-works',
  short_name: 'md-works',
  start_url: './',
  scope: './',
  display: 'standalone',
  lang: 'ko',
  theme_color: PWA_BG,
  background_color: PWA_BG,
  icons: [
    { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
  ],
};

export function pwaPlugin(): Plugin {
  return {
    name: 'md-works-pwa',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml() {
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'theme-color', content: PWA_BG }, injectTo: 'head' },
      ];
    },
    generateBundle(_o, bundle) {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(MANIFEST, null, 2) + '\n' });
      this.emitFile({ type: 'asset', fileName: 'icon.svg', source: ICON_ANY });
      this.emitFile({ type: 'asset', fileName: 'icon-maskable.svg', source: ICON_MASKABLE });
      const files: OutFile[] = Object.values(bundle).map((o) => ({ fileName: o.fileName, source: o.type === 'chunk' ? o.code : o.source }));
      files.push(
        { fileName: 'manifest.webmanifest', source: JSON.stringify(MANIFEST, null, 2) + '\n' },
        { fileName: 'icon.svg', source: ICON_ANY },
        { fileName: 'icon-maskable.svg', source: ICON_MASKABLE },
      );
      const list = pickPrecache(files).map((f) => f.fileName);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: buildServiceWorker(list, versionHash(files)) });
    },
  };
}
