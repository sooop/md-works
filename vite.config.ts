/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
import { existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApi } from './server/api.js';

// 개발 서버(vite)에 파일 API 를 얹는다. 루트는 NOTES_ROOT 또는 현재 폴더.
// env 는 .env, .env.development 등과 실제 환경변수를 합친 값(실제 환경변수 우선).
function notesApi(env: Record<string, string>): Plugin {
  return {
    name: 'notes-api',
    configureServer(server) {
      const api = createApi(env.NOTES_ROOT || process.cwd(), {
        templatesDir: env.NOTES_TEMPLATES || fileURLToPath(new URL('./templates', import.meta.url)),
      });
      server.middlewares.use((req, res, next) => {
        api(req, res).then((handled) => { if (!handled) next(); }, next);
      });
    },
  };
}

// 스탠드얼론 결과물의 파일명. 저장소 루트의 개발용 index.html 과 혼동되지 않도록 index.html 로 두지 않는다.
const STANDALONE_FILE = 'md-works.html';

function renameStandalone(): Plugin {
  let out = '';
  return {
    name: 'rename-standalone',
    apply: 'build',
    enforce: 'post',
    configResolved(cfg) { out = resolve(cfg.root, cfg.build.outDir); },
    closeBundle() {
      const from = resolve(out, 'index.html');
      if (existsSync(from)) renameSync(from, resolve(out, STANDALONE_FILE));
    },
  };
}

// mode: 'html' → 단일 HTML 스탠드얼론, 'static' → 여러 파일의 정적 웹앱(스탠드얼론 셸, 정적 호스팅용),
// 그 외 → 웹서버 버전(dist/ + server.js)
export default defineConfig(({ mode }) => {
  const single = mode === 'html';
  const stat = mode === 'static';
  const html = single || stat; // 스탠드얼론 셸(IndexedDB)을 쓰는 모드
  const env = loadEnv(mode, process.cwd(), ''); // 접두사 '' → VITE_ 가 아닌 서버 설정도 읽는다
  // 애니메이션 빌드 옵션: 단일 HTML 만 `ANIMATIONS=off` 로 효과를 끈 채 빌드할 수 있다(결과물에서는 설정 토글도 숨는다).
  // 서버·정적 빌드는 항상 켜 두고 설정 화면의 토글로 끈다.
  const anim = !(single && /^(off|0|false)$/i.test(env.ANIMATIONS ?? ''));
  return {
    base: stat ? './' : '/', // 정적 호스팅은 하위 경로에 올려도 동작하도록 상대 경로로 둔다
    plugins: [svelte(), ...(single ? [viteSingleFile(), renameStandalone()] : stat ? [] : [notesApi(env)])],
    resolve: {
      // pandoc-wasm 의 exports 가 하위 경로 import 를 막아, 환경 무관 코어를 직접 가리킨다
      alias: { 'pandoc-wasm-core': fileURLToPath(new URL('./node_modules/pandoc-wasm/src/core.js', import.meta.url)) },
    },
    define: { __MODE__: JSON.stringify(html ? 'html' : 'server'), __ANIM__: JSON.stringify(anim) },
    build: {
      outDir: single ? 'dist-html' : stat ? 'dist-static' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
    },
    server: { port: 5273, host: '127.0.0.1' },
    test: { testTimeout: 20000, hookTimeout: 20000, include: ['tests/**/*.test.ts'], exclude: ['node_modules/**', '.claude/**'] }, // 병렬 작업용 worktree 의 사본 테스트는 제외
  };
});
