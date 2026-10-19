// 파일 API: 루트 폴더 안의 .md 문서와 assets 이미지를 다룬다. 외부 의존성 없음.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { buildMatcher } from './searchCore.js';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp']);
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp',
};
const MAX_JSON = 20 * 1024 * 1024;
const MAX_UPLOAD = 50 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', 'assets']);
const COMMENTS_DIR = '.comments'; // 코멘트 사이드카: .comments/<문서 경로>.json (숨김 폴더라 트리·검색에서 제외된다)
const SEARCH = { perFile: 50, total: 500, maxBytes: 2 * 1024 * 1024, timeoutMs: 8000 };
const SEARCH_WORKER = fileURLToPath(new URL('./searchWorker.js', import.meta.url));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const WASM_FILE = fileURLToPath(new URL('../node_modules/pandoc-wasm/src/pandoc.wasm', import.meta.url));

// opts.templatesDir: docx 내보내기 템플릿(.docx)을 모아 둔 폴더. 없으면 기본 템플릿만 쓴다.
export function createApi(rootInput, opts = {}) {
  const root = path.resolve(rootInput);
  const templatesDir = opts.templatesDir ? path.resolve(opts.templatesDir) : null;

  // 루트 기준 상대경로(슬래시)를 절대경로로 변환한다. symlink 를 해석해 루트 밖이면 거부한다.
  async function safe(relPath, { mustExist = true } = {}) {
    if (typeof relPath !== 'string' || relPath.includes('\0')) throw new HttpError(400, '잘못된 경로');
    const abs = path.resolve(root, relPath);
    const realRoot = await fs.realpath(root);
    let real;
    try {
      real = await fs.realpath(abs);
    } catch {
      if (mustExist) throw new HttpError(404, '없는 경로');
      // 아직 없는 대상은 존재하는 가장 가까운 상위 폴더를 해석한 뒤 나머지를 이어 붙여 검사
      let cur = abs;
      const tail = [];
      for (;;) {
        const up = path.dirname(cur);
        tail.unshift(path.basename(cur));
        if (up === cur) break;
        cur = up;
        try { cur = await fs.realpath(cur); break; } catch { /* 계속 위로 */ }
      }
      real = path.join(cur, ...tail.slice(1));
    }
    if (!(real === realRoot || real.startsWith(realRoot + path.sep))) {
      throw new HttpError(403, '루트 밖 경로는 허용되지 않음');
    }
    return abs;
  }

  const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');
  const isMd = (p) => p.toLowerCase().endsWith('.md');
  const docAssetsDir = (docAbs) =>
    path.join(path.dirname(docAbs), 'assets', path.basename(docAbs, path.extname(docAbs)));

  async function readBody(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new HttpError(413, '본문이 너무 큼');
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }
  const readJson = async (req) => {
    const buf = await readBody(req, MAX_JSON);
    try { return JSON.parse(buf.toString('utf8') || '{}'); }
    catch { throw new HttpError(400, 'JSON 형식 오류'); }
  };

  async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

  // 문서의 코멘트 사이드카 파일 경로 (루트 밖으로 나가지 않는지 검사한다)
  async function commentFile(relPath) {
    const docAbs = await safe(relPath, { mustExist: false });
    if (!isMd(docAbs)) throw new HttpError(400, '.md 문서만 가능');
    return safe(`${COMMENTS_DIR}/${rel(docAbs)}.json`, { mustExist: false });
  }
  // 문서·폴더를 옮기거나 지울 때 사이드카도 함께 처리한다 (없으면 무시)
  async function moveComments(fromRel, toRel, isFile) {
    try {
      const sfx = isFile ? '.json' : '';
      const a = await safe(`${COMMENTS_DIR}/${fromRel}${sfx}`);
      const b = await safe(`${COMMENTS_DIR}/${toRel}${sfx}`, { mustExist: false });
      await fs.mkdir(path.dirname(b), { recursive: true });
      await fs.rename(a, b);
    } catch { /* 코멘트가 없으면 그대로 */ }
  }
  async function removeComments(relPath, isFile) {
    try {
      const target = await safe(`${COMMENTS_DIR}/${relPath}${isFile ? '.json' : ''}`, { mustExist: false });
      await fs.rm(target, { recursive: true, force: true });
    } catch { /* 무시 */ }
  }
  const cleanComment = (c) => {
    if (!c || typeof c !== 'object' || typeof c.quote !== 'string' || !c.quote || typeof c.id !== 'string') return null;
    const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    const t = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Date.now());
    return {
      id: s(c.id, 64), quote: s(c.quote, 3000), prefix: s(c.prefix, 200), suffix: s(c.suffix, 200), text: s(c.text, 20000),
      created: t(c.created), updated: t(c.updated), resolved: c.resolved === true,
    };
  };

  async function buildTree(dirAbs) {
    const entries = await fs.readdir(dirAbs, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dirAbs, e.name);
      if (e.isDirectory()) {
        out.push({ name: e.name, path: rel(abs), type: 'dir', children: await buildTree(abs) });
      } else if (e.isFile() && isMd(e.name)) {
        out.push({ name: e.name, path: rel(abs), type: 'file' });
      }
    }
    out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ko') : a.type === 'dir' ? -1 : 1));
    return out;
  }

  // 검색 대상 .md 파일 목록 (트리와 같은 제외 규칙, 심볼릭 링크는 따라가지 않는다)
  async function listMd(dirAbs, out = []) {
    const entries = await fs.readdir(dirAbs, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dirAbs, e.name);
      if (e.isDirectory()) await listMd(abs, out);
      else if (e.isFile() && isMd(e.name)) out.push({ path: rel(abs), abs });
    }
    return out;
  }

  // 정규식이 오래 걸리면 워커를 끊는다
  function runSearch(req, files, query, opts) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(SEARCH_WORKER, {
        workerData: { files, query, opts, perFile: SEARCH.perFile, total: SEARCH.total, maxBytes: SEARCH.maxBytes },
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new HttpError(422, '검색 시간이 초과되었습니다. 검색어(정규식)를 단순하게 바꿔 보세요'));
      }, SEARCH.timeoutMs);
      // 클라이언트가 요청을 취소하면(검색어를 계속 고치는 중) 워커도 바로 끊는다
      req.once('client-abort', () => { clearTimeout(timer); void worker.terminate(); reject(new HttpError(499, '검색이 취소되었습니다')); });
      worker.once('message', (m) => { clearTimeout(timer); resolve(m); });
      worker.once('error', (e) => { clearTimeout(timer); reject(e); });
    });
  }

  const routes = {
    'GET /api/info': async () => ({ root: path.basename(root) || root }),

    'GET /api/templates': async () => {
      if (!templatesDir) return { dir: '', files: [] };
      try {
        const names = (await fs.readdir(templatesDir, { withFileTypes: true }))
          .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.docx') && !e.name.startsWith('~$'))
          .map((e) => e.name)
          .sort((x, y) => x.localeCompare(y, 'ko'));
        return { dir: templatesDir, files: names };
      } catch {
        return { dir: templatesDir, files: [] };
      }
    },

    'GET /api/tree': async () => ({ children: await buildTree(root) }),

    // 본문 검색: q=검색어, cs=1 대소문자 구분, re=1 정규식
    'GET /api/search': async (req, q) => {
      const query = q.get('q') ?? '';
      const opts = { caseSensitive: q.get('cs') === '1', regex: q.get('re') === '1' };
      const { error } = buildMatcher(query, opts);
      if (error) throw new HttpError(400, error);
      const files = (await listMd(root)).sort((a, b) => a.path.localeCompare(b.path, 'ko'));
      return runSearch(req, files, query, opts);
    },

    // 코멘트: 원문(.md)은 건드리지 않고 .comments/<문서 경로>.json 에 따로 둔다. 비면 파일을 지운다.
    'GET /api/comments': async (_req, q) => {
      const file = await commentFile(q.get('path'));
      try {
        const j = JSON.parse(await fs.readFile(file, 'utf8'));
        return { comments: Array.isArray(j.comments) ? j.comments : [] };
      } catch {
        return { comments: [] };
      }
    },

    'PUT /api/comments': async (req, q) => {
      const file = await commentFile(q.get('path'));
      const { comments } = await readJson(req);
      if (!Array.isArray(comments)) throw new HttpError(400, 'comments 필요');
      const clean = comments.map(cleanComment).filter(Boolean);
      if (!clean.length) { await fs.rm(file, { force: true }); return { ok: true }; }
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ version: 1, comments: clean }, null, 2), 'utf8');
      return { ok: true };
    },

    'GET /api/file': async (_req, q) => {
      const abs = await safe(q.get('path'));
      if (!isMd(abs)) throw new HttpError(400, '.md 파일만 허용');
      const [content, st] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)]);
      return { content, mtime: st.mtimeMs };
    },

    'PUT /api/file': async (req, q) => {
      const abs = await safe(q.get('path'), { mustExist: false });
      if (!isMd(abs)) throw new HttpError(400, '.md 파일만 허용');
      const { content } = await readJson(req);
      if (typeof content !== 'string') throw new HttpError(400, 'content 필요');
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
      return { mtime: (await fs.stat(abs)).mtimeMs };
    },

    'POST /api/create': async (req) => {
      const { path: p, type } = await readJson(req);
      const abs = await safe(p, { mustExist: false });
      if (await exists(abs)) throw new HttpError(409, '이미 존재함');
      if (type === 'dir') {
        await fs.mkdir(abs, { recursive: true });
      } else {
        if (!isMd(abs)) throw new HttpError(400, '.md 파일만 허용');
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, '', 'utf8');
      }
      return { path: rel(abs) };
    },

    // 이름 변경/이동. 문서면 assets/<문서명> 폴더를 함께 옮기고 본문 링크를 갱신한다.
    'POST /api/rename': async (req) => {
      const { from, to } = await readJson(req);
      const src = await safe(from);
      const dst = await safe(to, { mustExist: false });
      if (await exists(dst)) throw new HttpError(409, '대상이 이미 존재함');
      const st = await fs.stat(src);
      if (st.isFile() && !(isMd(src) && isMd(dst))) throw new HttpError(400, '.md 파일만 허용');
      await fs.mkdir(path.dirname(dst), { recursive: true });
      const oldAssets = st.isFile() ? docAssetsDir(src) : null;
      await fs.rename(src, dst);
      await moveComments(rel(src), rel(dst), st.isFile());
      if (oldAssets && (await exists(oldAssets))) {
        const newAssets = docAssetsDir(dst);
        await fs.mkdir(path.dirname(newAssets), { recursive: true });
        await fs.rename(oldAssets, newAssets);
        const oldPrefix = `assets/${encodeURIComponent(path.basename(oldAssets))}/`;
        const newPrefix = `assets/${encodeURIComponent(path.basename(newAssets))}/`;
        if (oldPrefix !== newPrefix) {
          const text = await fs.readFile(dst, 'utf8');
          await fs.writeFile(dst, text.split(oldPrefix).join(newPrefix), 'utf8');
        }
      }
      return { path: rel(dst) };
    },

    'DELETE /api/file': async (_req, q) => {
      const abs = await safe(q.get('path'));
      if (abs === root) throw new HttpError(400, '루트는 삭제할 수 없음');
      const st = await fs.stat(abs);
      if (st.isDirectory()) {
        await fs.rm(abs, { recursive: true });
        await removeComments(rel(abs), false);
      } else {
        if (!isMd(abs)) throw new HttpError(400, '.md 파일만 허용');
        await fs.rm(abs);
        await fs.rm(docAssetsDir(abs), { recursive: true, force: true });
        await removeComments(rel(abs), true);
      }
      return { ok: true };
    },

    // 이미지 업로드: 본문은 원본 바이너리, doc=문서경로, ext=확장자
    'POST /api/upload': async (req, q) => {
      const docAbs = await safe(q.get('doc'));
      if (!isMd(docAbs)) throw new HttpError(400, '.md 문서만 가능');
      const ext = '.' + String(q.get('ext') || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (!IMAGE_EXT.has(ext)) throw new HttpError(400, '허용되지 않는 이미지 형식');
      const body = await readBody(req, MAX_UPLOAD);
      const dir = docAssetsDir(docAbs);
      await fs.mkdir(dir, { recursive: true });
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      let name = `${stamp}${ext}`;
      for (let i = 2; await exists(path.join(dir, name)); i++) name = `${stamp}-${i}${ext}`;
      await fs.writeFile(path.join(dir, name), body);
      return { url: `assets/${encodeURIComponent(path.basename(dir))}/${name}` };
    },
  };

  async function raw(res, q) {
    const abs = await safe(q.get('path'));
    const ext = path.extname(abs).toLowerCase();
    if (!IMAGE_EXT.has(ext)) throw new HttpError(400, '이미지만 허용');
    const data = await fs.readFile(abs);
    res.writeHead(200, {
      'Content-Type': MIME[ext],
      'Content-Length': data.length,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    });
    res.end(data);
  }

  async function template(res, q) {
    const name = q.get('name') ?? '';
    if (!templatesDir || name !== path.basename(name) || !name.toLowerCase().endsWith('.docx')) {
      throw new HttpError(400, '잘못된 템플릿 이름');
    }
    let data;
    try { data = await fs.readFile(path.join(templatesDir, name)); }
    catch { throw new HttpError(404, '템플릿을 찾을 수 없음'); }
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  }

  // pandoc-wasm 엔진(58MB)을 로컬에서 직접 제공한다. 외부 다운로드 없음.
  async function wasm(res) {
    const st = await fs.stat(WASM_FILE).catch(() => null);
    if (!st) throw new HttpError(404, 'pandoc.wasm 이 없습니다. npm install 을 실행하세요');
    res.writeHead(200, {
      'Content-Type': 'application/wasm',
      'Content-Length': st.size,
      'Cache-Control': 'public, max-age=86400',
    });
    createReadStream(WASM_FILE).pipe(res);
  }

  // 처리했으면 true, 아니면 false(다음 핸들러로)
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      // 다른 출처 페이지가 보내는 요청 차단
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, '허용되지 않는 출처');
      if (req.method === 'GET' && url.pathname === '/api/raw') { await raw(res, url.searchParams); return true; }
      if (req.method === 'GET' && url.pathname === '/api/template') { await template(res, url.searchParams); return true; }
      if (req.method === 'GET' && url.pathname === '/api/pandoc.wasm') { await wasm(res); return true; }
      res.once('close', () => { if (!res.writableEnded) req.emit('client-abort'); });
      const fn = routes[`${req.method} ${url.pathname}`];
      if (!fn) throw new HttpError(404, '없는 API');
      const data = await fn(req, url.searchParams);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (!(e instanceof HttpError)) console.error(e);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  };
}
