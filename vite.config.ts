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

// mode: 'html' → 단일 HTML 스탠드얼론, 그 외 → 웹서버 버전(dist/ + server.js)
export default defineConfig(({ mode }) => {
  const html = mode === 'html';
  const env = loadEnv(mode, process.cwd(), ''); // 접두사 '' → VITE_ 가 아닌 서버 설정도 읽는다
  return {
    plugins: [svelte(), ...(html ? [viteSingleFile(), renameStandalone()] : [notesApi(env)])],
    resolve: {
      // pandoc-wasm 의 exports 가 하위 경로 import 를 막아, 환경 무관 코어를 직접 가리킨다
      alias: { 'pandoc-wasm-core': fileURLToPath(new URL('./node_modules/pandoc-wasm/src/core.js', import.meta.url)) },
    },
    define: { __MODE__: JSON.stringify(html ? 'html' : 'server') },
    build: {
      outDir: html ? 'dist-html' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
    },
    server: { port: 5273, host: '127.0.0.1' },
    test: { testTimeout: 20000, hookTimeout: 20000, include: ['tests/**/*.test.ts'], exclude: ['node_modules/**', '.claude/**'] }, // 병렬 작업용 worktree 의 사본 테스트는 제외
  };
});
