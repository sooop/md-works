// 파일 API: 루트 폴더 안의 .md 문서와 assets 이미지를 다룬다. 외부 의존성 없음.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { buildMatcher } from './searchCore.js';
import { createWorksFs, WorksError } from './worksStore.js';

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
// 노트 폴더 백업: 번들(.mwb 암호화 / .zip)을 숨김 폴더에 쌓고 최근 KEEP_BACKUPS 개만 남긴다(트리·검색에서 제외된다)
const BACKUP_DIR = '.works-backup';
const MAX_BACKUP = 200 * 1024 * 1024;
const KEEP_BACKUPS = 10;
const BACKUP_NAME_RE = /^md-works-\d{8}-\d{6}(-\d+)?\.(mwb|zip)$/;
// 이름 안의 시각(+같은 초 충돌 번호)으로 만든 정렬 키 — 클수록 최신
const backupKey = (n) => { const m = /^md-works-(\d{8}-\d{6})(?:-(\d+))?\./.exec(n); return m ? m[1] + String(m[2] ?? 1).padStart(6, '0') : ''; };
const SEARCH_WORKER = fileURLToPath(new URL('./searchWorker.js', import.meta.url));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Windows 예약 장치 이름(CON, NUL, COM1 …)이거나 끝이 점·공백인 경로 구성요소인가.
// 확장자가 붙어도(CON.md, con.txt.md) 장치로 해석되므로 첫 '.' 앞부분으로 판정한다.
// 번들을 다른 OS 로 옮길 수 있으므로 플랫폼과 무관하게 거부한다.
const RESERVED_RE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
export function isWindowsReserved(segment) {
  if (typeof segment !== 'string') return true;
  if (/[. ]$/.test(segment)) return true;
  return RESERVED_RE.test(segment.split('.')[0].replace(/ +$/, ''));
}

// 요청 본문 상한(바이트). 글 쓰기(PUT /api/file·/api/bundle/doc·/api/comments)와 모든 JSON 요청은 MAX_JSON 하나를 쓴다.
// 클라이언트 번들 파서의 글 한 편 상한(MAX_TEXT_ENTRY_BYTES 100MB, 레코드 문자열 20M자)과는 독립이며,
// 서버가 더 작으므로 그보다 큰 글은 가져오기 때 413 으로 거절된다(의도된 동작).
// mtime 상한: 1e13 ms (서기 2286년) 이하만 받는다. Date 범위(8.64e15)까지 허용하면 유틸이 이상한 값을 쓴다.
const MAX_MTIME = 1e13;

const WASM_FILE = fileURLToPath(new URL('../node_modules/pandoc-wasm/src/pandoc.wasm', import.meta.url));

// opts.templatesDir: docx 내보내기 템플릿(.docx)을 모아 둔 폴더. 없으면 기본 템플릿만 쓴다.
export function createApi(rootInput, opts = {}) {
  const root = path.resolve(rootInput);
  // 접속을 허용할 Host 이름(포트 제외). 기본은 로컬 주소만, 역프록시 등은 opts.allowedHosts 또는 WORKS_ALLOWED_HOSTS(쉼표)로 추가
  const allowedHosts = new Set([
    '127.0.0.1', 'localhost', '[::1]',
    ...(opts.allowedHosts ?? (process.env.WORKS_ALLOWED_HOSTS ?? '').split(',')).map((h) => h.trim().toLowerCase()).filter(Boolean),
  ]);
  const hostAllowed = (h) => {
    const m = /^(\[[^\]]+\]|[^:\[\]]+)(?::\d+)?$/.exec(h ?? '');
    return !!m && allowedHosts.has(m[1].toLowerCase());
  };
  const templatesDir = opts.templatesDir ? path.resolve(opts.templatesDir) : null;

  // 루트 기준 상대경로(슬래시)를 절대경로로 변환한다. symlink 를 해석해 루트 밖이면 거부한다.
  async function safe(relPath, { mustExist = true } = {}) {
    if (typeof relPath !== 'string' || relPath.includes('\0')) throw new HttpError(400, '잘못된 경로');
    // 입력 단계: 어떤 구성요소에도 ':' 불가(`a.md:x` 대체 데이터 스트림, `C:x.md` 드라이브 상대 경로는 resolve 가 ':' 를 지워 버리므로 원문에서 막는다)
    if (relPath.includes(':')) throw new HttpError(400, '경로에 ":" 를 쓸 수 없음');
    const abs = path.resolve(root, relPath);
    // realpath 는 UNC 경로(\\서버\공유)에 네트워크 접속을 시도하므로, 문자열 수준에서 루트 밖이면 먼저 거부한다
    const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
    if (!(fold(abs) === fold(root) || fold(abs).startsWith(fold(root) + path.sep))) throw new HttpError(403, '루트 밖 경로는 허용되지 않음');
    // 모든 구성요소: 대체 데이터 스트림(`a.md:x`)·드라이브 문자(`C:x`)의 ':' 와 Windows 예약 장치 이름·끝 점/공백 거부
    for (const s of path.relative(root, abs).split(/[\\/]/)) {
      if (!s) continue;
      if (s.includes(':')) throw new HttpError(400, '경로에 ":" 를 쓸 수 없음');
      if (isWindowsReserved(s)) throw new HttpError(400, '사용할 수 없는 이름(예약어 또는 끝의 점·공백)');
    }
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
        // realpath 가 실패했는데 lstat 은 되는 구성요소 = 끊어진(댕글링) symlink/junction.
        // 쓰기가 링크를 따라가 루트 밖에 파일을 만들 수 있으므로 거부한다.
        if (await fs.lstat(cur).then(() => true, () => false)) throw new HttpError(403, '끊어진 링크는 허용되지 않음');
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

  const works = createWorksFs(safe); // 이력·글감·스레드 사이드카(.works)
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

  // 백업 폴더의 번들 목록(최신순). 이름 규칙에 맞는 파일만 보인다.
  async function listBackups(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
    const out = [];
    for (const e of entries) {
      if (!e.isFile() || !BACKUP_NAME_RE.test(e.name)) continue;
      const st = await fs.stat(path.join(dir, e.name));
      out.push({ name: e.name, size: st.size, mtime: st.mtimeMs });
    }
    return out.sort((a, b) => (backupKey(a.name) < backupKey(b.name) ? 1 : -1));
  }

  async function backupFile(res, q) {
    const name = q.get('name') ?? '';
    if (!BACKUP_NAME_RE.test(name)) throw new HttpError(400, '잘못된 백업 파일 이름');
    const abs = await safe(`${BACKUP_DIR}/${name}`);
    const st = await fs.stat(abs);
    if (!st.isFile()) throw new HttpError(404, '없는 백업');
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': st.size,
      'Content-Disposition': `attachment; filename="${name}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    createReadStream(abs).on('error', () => res.destroy()).pipe(res);
  }

  // ---- 번들(백업·동기화) 일괄 라우트용 ----
  // 번들 가져오기가 쓰는 경로는 zip 항목과 같이 신뢰하지 않는다: 상대 경로만, `..`·절대경로·드라이브 문자·숨김 구간 거부.
  // 글은 .md(assets·node_modules 폴더 밖), 이미지는 `…/assets/<폴더>/<파일>` 형태의 허용 확장자만 쓸 수 있다.
  const MAX_BUNDLE_ENTRIES = 100_000;
  function bundleRel(p, kind) {
    const bad = () => new HttpError(400, '허용되지 않는 번들 경로');
    if (typeof p !== 'string' || !p || p.length > 1024 || p.includes('\0') || p.includes('\\') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) throw bad();
    const segs = p.split('/');
    for (const s of segs) {
      if (!s || s === '.' || s === '..' || s.includes(':') || s.startsWith('.') || isWindowsReserved(s) || s.length > 255) throw bad();
    }
    if (kind === 'doc') {
      if (!isMd(p) || segs.slice(0, -1).some((s) => SKIP_DIRS.has(s))) throw bad();
    } else if (segs.length < 3 || segs[segs.length - 3] !== 'assets' || !IMAGE_EXT.has(path.extname(p).toLowerCase())) {
      throw bad();
    }
    return p;
  }
  // 모든 글(.md)과 이미지 에셋 목록. 심볼릭 링크는 따라가지 않는다.
  async function bundleIndex() {
    const docs = [];
    const assets = [];
    // inAssets: 0 = 일반 폴더, 1 = assets 폴더 바로 아래, 2 = assets/<폴더> 안
    const walk = async (dirAbs, inAssets) => {
      for (const e of await fs.readdir(dirAbs, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const abs = path.join(dirAbs, e.name);
        if (docs.length + assets.length > MAX_BUNDLE_ENTRIES) throw new HttpError(413, '파일이 너무 많음');
        if (e.isDirectory()) {
          if (inAssets === 0) await walk(abs, e.name === 'assets' ? 1 : 0);
          else if (inAssets === 1) await walk(abs, 2);
          continue;
        }
        if (!e.isFile()) continue;
        if (inAssets === 2) { if (IMAGE_EXT.has(path.extname(e.name).toLowerCase())) assets.push(rel(abs)); }
        else if (inAssets === 0 && isMd(e.name)) docs.push({ path: rel(abs), mtime: Math.round((await fs.stat(abs)).mtimeMs) });
      }
    };
    await walk(root, 0);
    return { docs, assets };
  }

  let backupBusy = false;
  async function storeBackup(req) {
    const body = await readBody(req, MAX_BACKUP);
    const isMwb = body.length > 4 && body.subarray(0, 4).toString('latin1') === 'MWB1';
    const isZip = body.length > 4 && body[0] === 0x50 && body[1] === 0x4b;
    if (!isMwb && !isZip) throw new HttpError(400, '번들(.mwb 또는 zip) 형식이 아님');
    const dir = await safe(BACKUP_DIR, { mustExist: false });
    await fs.mkdir(dir, { recursive: true });
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const ext = isMwb ? 'mwb' : 'zip';
    // 같은 초의 기존 파일 중 가장 큰 번호 다음부터 매긴다(회전으로 앞 번호가 지워져도 이름이 되살아나 곧바로 지워지는 일이 없게)
    const used = (await listBackups(dir)).map((b) => b.name).filter((n) => n.startsWith(`md-works-${stamp}`));
    const top = used.reduce((m, n) => Math.max(m, Number(/-(\d+)\.(mwb|zip)$/.exec(n)?.[1] ?? 1)), used.length ? 1 : 0);
    let name = top ? `md-works-${stamp}-${top + 1}.${ext}` : `md-works-${stamp}.${ext}`;
    for (let i = top + 2; ; i++) {
      try { await fs.writeFile(await safe(`${BACKUP_DIR}/${name}`, { mustExist: false }), body, { flag: 'wx' }); break; }
      catch (e) { if (e.code !== 'EEXIST') throw e; name = `md-works-${stamp}-${i}.${ext}`; }
    }
    const all = await listBackups(dir);
    for (const old of all.slice(KEEP_BACKUPS)) await fs.rm(path.join(dir, old.name), { force: true });
    return { name, size: body.length, kept: Math.min(all.length, KEEP_BACKUPS) };
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

    // 글감·이력·스레드 사이드카. coll=versions|snippets|threads, part=문서 경로(글감은 생략)
    'GET /api/works': async (_req, q) => ({ records: await works.list(q.get('coll'), q.get('part') ?? undefined) }),
    // 단건 조회: coll, part(글감은 생략), id. 없으면 record: null
    'GET /api/works/one': async (_req, q) => ({ record: await works.get(q.get('coll'), q.get('part') ?? undefined, q.get('id')) }),
    'GET /api/works/parts': async (_req, q) => ({ parts: await works.parts(q.get('coll')) }),
    'PUT /api/works': async (req) => {
      const { coll, part, recs } = await readJson(req);
      if (!Array.isArray(recs)) throw new HttpError(400, 'recs 필요');
      for (const r of recs) await works.put(coll, part, r);
      return { ok: true };
    },
    'DELETE /api/works': async (_req, q) => {
      await works.remove(q.get('coll'), q.get('part') ?? undefined, q.get('id'));
      return { ok: true };
    },
    'DELETE /api/works/part': async (_req, q) => {
      await works.removePart(q.get('coll'), q.get('part'));
      return { ok: true };
    },
    'POST /api/works/move-part': async (req) => {
      const { coll, from, to } = await readJson(req);
      await works.movePart(coll, from, to);
      return { ok: true };
    },

    // 노트 폴더 백업: 본문은 번들 바이너리('MWB1' 암호화 또는 zip). .works-backup/md-works-YYYYMMDD-HHmmss.<mwb|zip>
    // 요청당 최대 200MB 를 메모리에 올리므로 동시 업로드는 1건만 받고(진행 중이면 429), 선언된 크기가 상한을 넘으면 본문을 읽기 전에 413 으로 거절한다.
    'POST /api/backup': async (req) => {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > MAX_BACKUP) throw new HttpError(413, '본문이 너무 큼');
      if (backupBusy) throw new HttpError(429, '다른 백업이 진행 중입니다. 잠시 후 다시 시도하세요');
      backupBusy = true;
      try { return await storeBackup(req); } finally { backupBusy = false; }
    },

    'GET /api/backups': async () => {
      const dir = await safe(BACKUP_DIR, { mustExist: false });
      return { backups: await listBackups(dir) };
    },

    // 번들: 모든 글·에셋 목록 / 글 쓰기(수정 시각 지정) / 이미지 에셋 쓰기. 읽기는 /api/file, /api/raw 를 쓴다.
    'GET /api/bundle/index': async () => bundleIndex(),

    'PUT /api/bundle/doc': async (req, q) => {
      const p = bundleRel(q.get('path'), 'doc');
      const abs = await safe(p, { mustExist: false });
      const { content } = await readJson(req);
      if (typeof content !== 'string') throw new HttpError(400, 'content 필요');
      const mtime = q.get('mtime');
      if (mtime !== null && !(Number.isFinite(Number(mtime)) && Number(mtime) > 0 && Number(mtime) <= MAX_MTIME)) throw new HttpError(400, '잘못된 mtime');
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
      if (mtime !== null) { const t = new Date(Number(mtime)); await fs.utimes(abs, t, t); }
      return { mtime: Math.round((await fs.stat(abs)).mtimeMs) };
    },

    'PUT /api/bundle/asset': async (req, q) => {
      const p = bundleRel(q.get('path'), 'asset');
      const abs = await safe(p, { mustExist: false });
      const body = await readBody(req, MAX_UPLOAD);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, body);
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
      await works.moveDoc(rel(src), rel(dst), st.isFile()).catch(() => { /* 사이드카는 부가 데이터 */ });
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
        await works.deleteDoc(rel(abs), false).catch(() => {});
      } else {
        if (!isMd(abs)) throw new HttpError(400, '.md 파일만 허용');
        await fs.rm(abs);
        await fs.rm(docAssetsDir(abs), { recursive: true, force: true });
        await removeComments(rel(abs), true);
        await works.deleteDoc(rel(abs), true).catch(() => {});
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
    createReadStream(WASM_FILE).on('error', () => res.destroy()).pipe(res);
  }

  // 처리했으면 true, 아니면 false(다음 핸들러로)
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      // DNS rebinding 방어: Host 가 로컬 주소가 아니면 Origin 이 같아 보여도 거부한다
      if (!hostAllowed(req.headers.host)) throw new HttpError(403, '허용되지 않는 호스트');
      // 다른 출처 페이지가 보내는 요청 차단 (Origin: null 같은 해석 불가 값도 거부)
      const origin = req.headers.origin;
      if (origin) {
        let originHost = '';
        try { originHost = new URL(origin).host; } catch { /* 아래에서 거부 */ }
        if (originHost !== req.headers.host) throw new HttpError(403, '허용되지 않는 출처');
      }
      if (req.method === 'GET' && url.pathname === '/api/raw') { await raw(res, url.searchParams); return true; }
      if (req.method === 'GET' && url.pathname === '/api/template') { await template(res, url.searchParams); return true; }
      if (req.method === 'GET' && url.pathname === '/api/pandoc.wasm') { await wasm(res); return true; }
      if (req.method === 'GET' && url.pathname === '/api/backup/file') { await backupFile(res, url.searchParams); return true; }
      res.once('close', () => { if (!res.writableEnded) req.emit('client-abort'); });
      const fn = routes[`${req.method} ${url.pathname}`];
      if (!fn) throw new HttpError(404, '없는 API');
      const data = await fn(req, url.searchParams);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch (e) {
      const status = e instanceof HttpError || e instanceof WorksError ? e.status : 500;
      if (status === 500) console.error(e);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  };
}
