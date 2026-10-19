// 웹서버 버전 실행: node server.js [루트폴더] [--port N] [--templates 폴더]
// 루트 기본값은 NOTES_ROOT 환경변수, 없으면 현재 폴더. 127.0.0.1 에만 바인딩한다.
import http from 'node:http';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './server/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// .env 파일 로드. 우선순위: CLI 인자 > 실제 환경변수 > .env.production > .env
// (process.loadEnvFile 은 이미 있는 값을 덮어쓰지 않으므로, 우선순위가 높은 파일부터 읽는다)
for (const name of ['.env.production', '.env']) {
  const file = path.join(here, name);
  if (existsSync(file)) process.loadEnvFile(file);
}

const args = process.argv.slice(2);
let port = Number(process.env.PORT) || 5273;
let rootArg = process.env.NOTES_ROOT;
let templatesArg = process.env.NOTES_TEMPLATES;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') port = Number(args[++i]);
  else if (args[i].startsWith('--port=')) port = Number(args[i].slice(7));
  else if (args[i] === '--templates') templatesArg = args[++i];
  else if (args[i].startsWith('--templates=')) templatesArg = args[i].slice(12);
  else if (!args[i].startsWith('--')) rootArg = args[i];
}
const root = path.resolve(rootArg || process.cwd());
const dist = path.join(here, 'dist');
// 템플릿 폴더 기본값: 앱 폴더의 templates/
const templatesDir = path.resolve(templatesArg || path.join(here, 'templates'));
const api = createApi(root, { templatesDir });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.png': 'image/png', '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  if (await api(req, res)) return;
  const url = new URL(req.url, 'http://localhost');
  let file = path.normalize(path.join(dist, decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
  try {
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(dist, 'index.html');
  }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('dist 가 없습니다. npm run build 를 먼저 실행하세요.');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Notes server: http://127.0.0.1:${port}  (root: ${root})`);
  console.log(`docx templates: ${templatesDir}`);
});
