// 파일 API: 루트 폴더 안의 .md 문서와 assets 이미지를 다룬다. 외부 의존성 없음.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import { buildMatcher } from './searchCore.js';
import { COLLS, createWorksFs, encPart, WorksError, withFileLock, writeFileAtomic, writeFileAtomicUnlocked, writeFileExclusive } from './worksStore.js';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp']);
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp',
};
const MAX_JSON = 20 * 1024 * 1024;
const MAX_UPLOAD = 50 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', 'assets']);
const COMMENTS_DIR = '.comments'; // 코멘트 사이드카: .comments/<문서 경로>.json (숨김 폴더라 트리·검색에서 제외된다)
// 동시에 도는 검색 워커 상한. 넘으면 가장 오래된 검색을 취소한다(클라이언트는 검색어를 고칠 때마다 이전 요청을 버린다)
const MAX_SEARCHES = 2;
const IO_CONCURRENCY = 16; // 트리·검색 목록·번들 목록의 readdir/stat 동시 실행 상한
const SEARCH = { perFile: 50, total: 500, maxBytes: 2 * 1024 * 1024, timeoutMs: 8000 };
// 노트 폴더 백업: 번들(.mwb 암호화 / .zip)을 숨김 폴더에 쌓고 보존 규칙(아래 backupsToDelete)대로 솎아 낸다(트리·검색에서 제외된다)
const BACKUP_DIR = '.works-backup';
const MAX_BACKUP = 200 * 1024 * 1024;
// 보존 규칙: 최근 KEEP_BACKUPS 개는 전부, 그 밖에는 최근 48시간은 시간당 최신 1개, 최근 30일은 하루당 최신 1개, 나머지는 지운다
const KEEP_BACKUPS = 10;
const BACKUP_HOURLY_MS = 48 * 3600_000;
const BACKUP_DAILY_MS = 30 * 24 * 3600_000;
// 문서 휴지통: <루트>/.works-trash/<id>/ (meta.json + 옮겨 온 내용). 이 기간이 지난 항목은 서버 시작·목록 조회 때 지운다
const TRASH_DIR = '.works-trash';
export const TRASH_KEEP_MS = 30 * 24 * 3600_000;
const TRASH_ID_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/;
const BACKUP_NAME_RE = /^md-works-\d{8}-\d{6}(-\d+)?\.(mwb|zip)$/;
// 이름 안의 시각(+같은 초 충돌 번호)으로 만든 정렬 키 — 클수록 최신
const backupKey = (n) => { const m = /^md-works-(\d{8}-\d{6})(?:-(\d+))?\./.exec(n); return m ? m[1] + String(m[2] ?? 1).padStart(6, '0') : ''; };
// 백업 이름의 시각(로컬 시각으로 기록된다)을 ms 로. 못 읽으면 mtime
export function backupTime(name, mtime = 0) {
  const m = /^md-works-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : mtime;
}
// 순수 함수: 백업 목록 {name, time(ms)} → 지울 이름 목록. 같은 초 충돌 번호가 큰 쪽을 더 새것으로 본다.
export function backupsToDelete(items, now, { keepRecent = KEEP_BACKUPS } = {}) {
  const sorted = [...items].sort((a, b) => (b.time - a.time) || (backupKey(a.name) < backupKey(b.name) ? 1 : -1));
  const p2 = (n) => String(n).padStart(2, '0');
  const hourKey = (t) => { const d = new Date(t); return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}`; };
  const dayKey = (t) => hourKey(t).slice(0, 8);
  const hours = new Set();
  const days = new Set();
  const del = [];
  sorted.forEach((it, i) => {
    if (i < keepRecent) return;
    const age = now - it.time;
    if (age <= BACKUP_HOURLY_MS) {
      const k = hourKey(it.time);
      if (hours.has(k)) del.push(it.name); else hours.add(k);
    } else if (age <= BACKUP_DAILY_MS) {
      const k = dayKey(it.time);
      if (days.has(k)) del.push(it.name); else days.add(k);
    } else {
      del.push(it.name);
    }
  });
  return del;
}
// fn 을 동시에 n 개까지만 실행하는 제한기(디렉터리 순회가 파일 핸들을 한꺼번에 소진하지 않게)
function createLimiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
const SEARCH_WORKER = fileURLToPath(new URL('./searchWorker.js', import.meta.url));

// extra: 응답 JSON 에 덧붙일 필드. 기본 응답은 { error: 메시지 } 이고, extra.error 가 있으면 그 값(오류 코드)으로 대체된다
class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

// 외부 수정 충돌 검사에서 baseMtime 과 디스크 mtime 이 이 값(ms) 이하로 다르면 같은 것으로 본다(파일 시스템 시각 정밀도 차이)
const MTIME_TOLERANCE = 2;

// 링크 안의 assets 폴더 이름 인코딩: 원래 링크가 쓰던 형태를 유지한다.
// encodeURIComponent 형태 / 아카이브 형태(한글·공백은 그대로, ()%#? 만 인코딩) / 그 밖의 부분 인코딩(%XX 가 있으면 전체 인코딩으로)
const encArchive = (s) => s.replace(/[()%#?]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
function relinkAssets(text, oldName, newName) {
  return text.replace(/(?<![A-Za-z0-9_])assets\/([^/\r\n)"'<>]+)\//g, (all, seg) => {
    if (safeDecode(seg) !== oldName) return all;
    const next = seg === encodeURIComponent(oldName) ? encodeURIComponent(newName)
      : seg === encArchive(oldName) ? encArchive(newName)
      : /%[0-9a-fA-F]{2}/.test(seg) ? encodeURIComponent(newName)
      : encArchive(newName);
    return `assets/${next}/`;
  });
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
  const now = () => (opts.now ?? Date.now)(); // 테스트에서 시각을 주입할 수 있게
  const io = createLimiter(IO_CONCURRENCY);
  const activeSearches = new Set();

  // 루트 기준 상대경로(슬래시)를 절대경로로 변환한다. symlink 를 해석해 루트 밖이면 거부한다.
  // trash: true 는 휴지통 코드만 쓴다. 그 밖의 모든 API 는 .works-trash 아래(symlink 로 돌아가는 경우 포함)를 403 으로 막는다.
  async function safe(relPath, { mustExist = true, trash = false } = {}) {
    if (typeof relPath !== 'string' || relPath.includes('\0')) throw new HttpError(400, '잘못된 경로');
    // 입력 단계: 어떤 구성요소에도 ':' 불가(`a.md:x` 대체 데이터 스트림, `C:x.md` 드라이브 상대 경로는 resolve 가 ':' 를 지워 버리므로 원문에서 막는다)
    if (relPath.includes(':')) throw new HttpError(400, '경로에 ":" 를 쓸 수 없음');
    const abs = path.resolve(root, relPath);
    // realpath 는 UNC 경로(\\서버\공유)에 네트워크 접속을 시도하므로, 문자열 수준에서 루트 밖이면 먼저 거부한다
    const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
    if (!(fold(abs) === fold(root) || fold(abs).startsWith(fold(root) + path.sep))) throw new HttpError(403, '루트 밖 경로는 허용되지 않음');
    // 모든 구성요소: 대체 데이터 스트림(`a.md:x`)·드라이브 문자(`C:x`)의 ':' 와 Windows 예약 장치 이름·끝 점/공백 거부
    const isTrashSeg = (s) => s.toLowerCase() === TRASH_DIR;
    if (!trash && isTrashSeg(path.relative(root, abs).split(/[\\/]/)[0])) throw new HttpError(403, '휴지통은 직접 접근할 수 없음');
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
    if (!trash && isTrashSeg(path.relative(realRoot, real).split(/[\\/]/)[0])) throw new HttpError(403, '휴지통은 직접 접근할 수 없음');
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
    let v;
    try { v = JSON.parse(buf.toString('utf8') || '{}'); }
    catch { throw new HttpError(400, 'JSON 형식 오류'); }
    // null·배열·원시값은 호출부의 구조분해가 TypeError(500)가 되므로 여기서 거른다
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'JSON 객체가 필요함');
    return v;
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
      return true;
    } catch { /* 코멘트가 없으면 그대로 */ }
    return false;
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

  // 항목 하나의 readdir·stat 실패(삭제 경합, 권한 없는 폴더)는 그 항목만 건너뛴다. 루트(top)가 읽히지 않을 때만 오류로 둔다
  async function buildTree(dirAbs, top = true) {
    let entries;
    try { entries = await io(() => fs.readdir(dirAbs, { withFileTypes: true })); }
    catch (e) { if (top) throw e; return null; }
    // 폴더·파일 상태 조회를 한꺼번에 시작한다(하나씩 기다리면 글이 많을 때 트리를 읽는 데 오래 걸린다)
    const made = await Promise.all(entries.map(async (e) => {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) return null;
      const abs = path.join(dirAbs, e.name);
      if (e.isDirectory()) {
        const children = await buildTree(abs, false);
        return children && { name: e.name, path: rel(abs), type: 'dir', children };
      }
      if (e.isFile() && isMd(e.name)) {
        try { return { name: e.name, path: rel(abs), type: 'file', mtime: Math.round((await io(() => fs.stat(abs))).mtimeMs) }; }
        catch { return null; }
      }
      return null;
    }));
    const out = made.filter(Boolean);
    out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ko') : a.type === 'dir' ? -1 : 1));
    return out;
  }

  // 검색 대상 .md 파일 목록 (트리와 같은 제외 규칙, 심볼릭 링크는 따라가지 않는다). 순서는 호출자가 정렬한다
  async function listMd(dirAbs, out = [], top = true) {
    let entries;
    try { entries = await io(() => fs.readdir(dirAbs, { withFileTypes: true })); }
    catch (e) { if (top) throw e; return out; }
    await Promise.all(entries.map(async (e) => {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) return;
      const abs = path.join(dirAbs, e.name);
      if (e.isDirectory()) await listMd(abs, out, false);
      else if (e.isFile() && isMd(e.name)) out.push({ path: rel(abs), abs });
    }));
    return out;
  }

  // 검색 한 건의 취소 상태. 핸들러 진입 즉시 만들어 'client-abort' 를 듣는다(목록을 읽는 동안 끊긴 요청도 놓치지 않게).
  // 동시 검색이 MAX_SEARCHES 를 넘으면 가장 오래된 것을 취소한다
  function beginSearch(req) {
    const s = { aborted: false, stop: null };
    s.abort = () => { s.aborted = true; s.stop?.(); };
    req.once('client-abort', s.abort);
    while (activeSearches.size >= MAX_SEARCHES) {
      const oldest = activeSearches.values().next().value;
      activeSearches.delete(oldest);
      oldest.abort();
    }
    activeSearches.add(s);
    return s;
  }

  // 정규식이 오래 걸리면 워커를 끊는다
  function runSearch(search, files, query, opts) {
    return new Promise((resolve, reject) => {
      if (search.aborted) { reject(new HttpError(499, '검색이 취소되었습니다')); return; }
      const worker = new Worker(SEARCH_WORKER, {
        workerData: { files, query, opts, perFile: SEARCH.perFile, total: SEARCH.total, maxBytes: SEARCH.maxBytes },
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new HttpError(422, '검색 시간이 초과되었습니다. 검색어(정규식)를 단순하게 바꿔 보세요'));
      }, SEARCH.timeoutMs);
      // 클라이언트가 요청을 취소하면(검색어를 계속 고치는 중) 워커도 바로 끊는다
      search.stop = () => { clearTimeout(timer); void worker.terminate(); reject(new HttpError(499, '검색이 취소되었습니다')); };
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
    // 클라이언트가 끊으면 읽기 스트림도 닫는다(pipe 는 닫지 않는다)
    pipeline(createReadStream(abs), res, () => {});
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
    const walk = async (dirAbs, inAssets, top = false) => {
      let entries;
      try { entries = await io(() => fs.readdir(dirAbs, { withFileTypes: true })); }
      catch (e) { if (top) throw e; return; } // 삭제 경합·권한 없는 폴더는 건너뛴다
      await Promise.all(entries.map(async (e) => {
        if (e.name.startsWith('.') || e.name === 'node_modules') return;
        const abs = path.join(dirAbs, e.name);
        if (docs.length + assets.length > MAX_BUNDLE_ENTRIES) throw new HttpError(413, '파일이 너무 많음');
        if (e.isDirectory()) {
          if (inAssets === 0) await walk(abs, e.name === 'assets' ? 1 : 0);
          else if (inAssets === 1) await walk(abs, 2);
          return;
        }
        if (!e.isFile()) return;
        if (inAssets === 2) { if (IMAGE_EXT.has(path.extname(e.name).toLowerCase())) assets.push(rel(abs)); }
        else if (inAssets === 0 && isMd(e.name)) {
          try { docs.push({ path: rel(abs), mtime: Math.round((await io(() => fs.stat(abs))).mtimeMs) }); } catch { /* 사라진 글은 건너뛴다 */ }
        }
      }));
    };
    await walk(root, 0, true);
    docs.sort((a, b) => (a.path < b.path ? -1 : 1)); // 병렬 순회라 순서가 일정하지 않으므로 정렬한다
    assets.sort();
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
    const d = new Date(now());
    const p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const ext = isMwb ? 'mwb' : 'zip';
    // 같은 초의 기존 파일 중 가장 큰 번호 다음부터 매긴다(회전으로 앞 번호가 지워져도 이름이 되살아나 곧바로 지워지는 일이 없게)
    const used = (await listBackups(dir)).map((b) => b.name).filter((n) => n.startsWith(`md-works-${stamp}`));
    const top = used.reduce((m, n) => Math.max(m, Number(/-(\d+)\.(mwb|zip)$/.exec(n)?.[1] ?? 1)), used.length ? 1 : 0);
    let name = top ? `md-works-${stamp}-${top + 1}.${ext}` : `md-works-${stamp}.${ext}`;
    for (let i = top + 2; ; i++) {
      try { await writeFileExclusive(await safe(`${BACKUP_DIR}/${name}`, { mustExist: false }), body); break; }
      catch (e) { if (e.code !== 'EEXIST') throw e; name = `md-works-${stamp}-${i}.${ext}`; }
    }
    const all = await listBackups(dir);
    const drop = new Set(backupsToDelete(all.map((b) => ({ name: b.name, time: backupTime(b.name, b.mtime) })), now()));
    drop.delete(name); // 방금 쓴 것은 시각이 어긋나(시계 변경 등) 있어도 지우지 않는다
    for (const old of drop) await fs.rm(path.join(dir, old), { force: true });
    return { name, size: body.length, kept: all.length - drop.size };
  }

  // ---- 문서 휴지통 ----
  // <루트>/.works-trash/<id>/meta.json            { version, id, path, name, type, deletedAt, docs, parts:[{coll,part}] }
  //                        item/<원래 이름>        글 파일 또는 폴더 통째(.md 가 아닌 파일 포함)
  //                        assets/                 글의 assets/<글 이름>/ (글 삭제일 때만)
  //                        comments(.json)         이전 방식 코멘트 사이드카
  //                        works/<coll>/<encPart(파티션)>/   이력·스레드 파티션
  // 이 폴더는 safe() 가 trash:true 없이는 막으므로 다른 API 로는 닿지 않는다.
  const present = (p) => fs.lstat(p).then(() => true, () => false);
  const docColls = Object.keys(COLLS).filter((c) => COLLS[c]);
  const trashRoot = () => safe(TRASH_DIR, { mustExist: false, trash: true });
  const trashItem = (id) => {
    if (typeof id !== 'string' || !TRASH_ID_RE.test(id)) throw new HttpError(400, '잘못된 휴지통 id');
    return safe(`${TRASH_DIR}/${id}`, { mustExist: false, trash: true });
  };
  async function readMeta(td) {
    try {
      const m = JSON.parse(await fs.readFile(path.join(td, 'meta.json'), 'utf8'));
      if (m && typeof m.path === 'string' && typeof m.name === 'string' && (m.type === 'file' || m.type === 'dir') && Number.isFinite(m.deletedAt)) return m;
    } catch { /* 깨졌거나 없음 */ }
    return null;
  }
  // 폴더 안의 .md 수(검색과 같은 제외 규칙, symlink 는 따라가지 않는다)
  async function countDocs(dirAbs) {
    let n = 0;
    for (const e of await fs.readdir(dirAbs, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      if (e.isDirectory()) n += await countDocs(path.join(dirAbs, e.name));
      else if (e.isFile() && isMd(e.name)) n++;
    }
    return n;
  }
  // 여러 조각을 rename 으로 옮기다 실패하면 이미 옮긴 것을 되돌린다
  async function moveAll(steps) {
    const done = [];
    try {
      for (const s of steps) {
        await fs.mkdir(path.dirname(s.to), { recursive: true });
        await fs.rename(s.from, s.to);
        done.push(s);
      }
    } catch (e) {
      let stuck = 0;
      for (const s of done.reverse()) await fs.rename(s.to, s.from).catch(() => { stuck++; });
      if (stuck) {
        // 되돌리지 못한 조각이 휴지통 폴더에 남아 있다: 호출자가 폴더를 지우지 않도록 표시한다
        console.error('되돌리기 실패, 원래 오류:', e);
        throw Object.assign(new HttpError(500, `이동 중 오류가 나 ${stuck}개 항목을 되돌리지 못함(휴지통에 보존됨)`), { rollbackFailed: true });
      }
      if (e.code === 'ENOTDIR' || e.code === 'EEXIST') throw new HttpError(409, '대상 위치를 쓸 수 없음');
      throw e;
    }
  }

  async function trashMove(relInput) {
    const abs = await safe(relInput);
    if (abs === root) throw new HttpError(400, '루트는 삭제할 수 없음');
    const relp = rel(abs);
    if (relp.split('/').some((s) => s.startsWith('.'))) throw new HttpError(400, '숨김 항목은 삭제할 수 없음');
    const st = await fs.stat(abs);
    const isFile = !st.isDirectory();
    if (isFile && !isMd(abs)) throw new HttpError(400, '.md 파일만 허용');
    const t = now();
    const iso = new Date(t).toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
    const stamp = `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}`;
    await fs.mkdir(await trashRoot(), { recursive: true });
    let id; let td;
    for (;;) {
      id = `${stamp}-${randomBytes(3).toString('hex')}`;
      td = await trashItem(id);
      try { await fs.mkdir(td); break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    try {
      const steps = [{ from: abs, to: path.join(td, 'item', path.basename(abs)) }];
      const parts = [];
      if (isFile) {
        const a = docAssetsDir(abs);
        if (await present(a)) steps.push({ from: a, to: path.join(td, 'assets') });
      }
      const cm = await safe(`${COMMENTS_DIR}/${relp}${isFile ? '.json' : ''}`, { mustExist: false }).catch(() => null);
      if (cm && (await present(cm))) steps.push({ from: cm, to: path.join(td, isFile ? 'comments.json' : 'comments') });
      for (const coll of docColls) {
        for (const p of await works.parts(coll)) {
          if (!(isFile ? p === relp : p.startsWith(relp + '/'))) continue;
          parts.push({ coll, part: p });
          steps.push({ from: await works.partPath(coll, p), to: path.join(td, 'works', coll, encPart(p)) });
        }
      }
      const meta = { version: 1, id, path: relp, name: path.basename(abs), type: isFile ? 'file' : 'dir', deletedAt: t, docs: isFile ? 1 : await countDocs(abs), parts };
      await fs.writeFile(path.join(td, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
      await moveAll(steps);
    } catch (e) {
      // 되돌리기에 실패했으면 글이 아직 휴지통 폴더(meta.json 있음)에 있으므로 지우지 않고 보존한다
      if (!e.rollbackFailed) await fs.rm(td, { recursive: true, force: true }).catch(() => {});
      throw e;
    }
    return id;
  }

  // 30일이 지난 항목(meta 가 깨졌으면 폴더 mtime 기준)을 지운다
  async function purgeTrash() {
    const base = await trashRoot();
    let n = 0;
    for (const e of await fs.readdir(base, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || !TRASH_ID_RE.test(e.name)) continue;
      const td = path.join(base, e.name);
      const at = (await readMeta(td))?.deletedAt ?? (await fs.stat(td).catch(() => null))?.mtimeMs;
      if (at !== undefined && now() - at > TRASH_KEEP_MS) { await fs.rm(td, { recursive: true, force: true }); n++; }
    }
    return n;
  }

  async function listTrash() {
    await purgeTrash().catch(() => {});
    const base = await trashRoot();
    const items = [];
    for (const e of await fs.readdir(base, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || !TRASH_ID_RE.test(e.name)) continue;
      const m = await readMeta(path.join(base, e.name));
      if (m) items.push({ id: e.name, path: m.path, name: m.name, type: m.type, deletedAt: m.deletedAt, docs: Number.isFinite(m.docs) ? m.docs : 0 });
    }
    return items.sort((a, b) => (b.deletedAt - a.deletedAt) || (a.id < b.id ? 1 : -1));
  }

  async function restoreTrash(id) {
    const td = await trashItem(id);
    return withFileLock(td, async () => {
      const meta = await readMeta(td);
      if (!meta) throw new HttpError(404, '휴지통에 없는 항목');
      const isFile = meta.type === 'file';
      await safe(meta.path, { mustExist: false }); // meta 도 신뢰하지 않는다(경로 탈출·예약어 검사)
      const src = (await fs.readdir(path.join(td, 'item')).catch(() => []))[0];
      if (!src) throw new HttpError(404, '휴지통 항목의 내용이 없음');
      // 같은 이름이 있으면 '이름 (2).md' / '폴더 (2)' 로 비켜 간다(글이면 assets 폴더가 겹치는 경우도)
      const dirPart = meta.path.includes('/') ? meta.path.slice(0, meta.path.lastIndexOf('/') + 1) : '';
      const name = meta.path.slice(dirPart.length);
      const ext = isFile ? name.slice(-3) : '';
      const stem = isFile ? name.slice(0, -3) : name;
      let newRel = meta.path;
      let abs = await safe(newRel, { mustExist: false });
      for (let n = 2; (await present(abs)) || (isFile && (await present(docAssetsDir(abs)))); n++) {
        if (n > 1000) throw new HttpError(409, '같은 이름이 너무 많음');
        newRel = `${dirPart}${stem} (${n})${ext}`;
        abs = await safe(newRel, { mustExist: false });
      }
      const steps = [{ from: path.join(td, 'item', src), to: abs }];
      if (isFile && (await present(path.join(td, 'assets')))) steps.push({ from: path.join(td, 'assets'), to: docAssetsDir(abs) });
      const cmSrc = path.join(td, isFile ? 'comments.json' : 'comments');
      if (await present(cmSrc)) {
        const cmDst = await safe(`${COMMENTS_DIR}/${newRel}${isFile ? '.json' : ''}`, { mustExist: false });
        await fs.rm(cmDst, { recursive: true, force: true });
        steps.push({ from: cmSrc, to: cmDst });
      }
      await moveAll(steps);
      const warnings = [];
      // 이력·스레드 파티션: 이름이 바뀌었으면 파티션 이름(과 스레드 docKey)도 새 경로에 맞춘다
      for (const { coll, part } of Array.isArray(meta.parts) ? meta.parts : []) {
        if (!docColls.includes(coll) || typeof part !== 'string' || !(isFile ? part === meta.path : part.startsWith(meta.path + '/'))) continue;
        const sd = path.join(td, 'works', coll, encPart(part));
        if (!(await present(sd))) continue;
        // 실패해도 글은 이미 복구됐으므로 계속하되, 이력·스레드가 휴지통에 남도록 항목을 지우지 않고 경고를 싣는다
        await works.importPart(coll, sd, isFile ? newRel : newRel + part.slice(meta.path.length))
          .catch((e) => { console.error('휴지통 복구: 사이드카 이식 실패', coll, part, e); warnings.push(`${coll}:${part}`); });
      }
      if (isFile && newRel !== meta.path) {
        const oldName = path.basename(meta.path, path.extname(meta.path));
        const newName = path.basename(newRel, path.extname(newRel));
        if (oldName !== newName) {
          await withFileLock(abs, async () => {
            const text = await fs.readFile(abs, 'utf8');
            const next = relinkAssets(text, oldName, newName);
            if (next !== text) await writeFileAtomicUnlocked(abs, next, 'utf8');
          });
        }
      }
      if (warnings.length) return { ok: true, path: newRel, type: meta.type, warnings };
      await fs.rm(td, { recursive: true, force: true });
      return { ok: true, path: newRel, type: meta.type };
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
      const search = beginSearch(req);
      try {
        const files = (await listMd(root)).sort((a, b) => a.path.localeCompare(b.path, 'ko'));
        return await runSearch(search, files, query, opts);
      } finally { activeSearches.delete(search); }
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
      await writeFileAtomic(file, JSON.stringify({ version: 1, comments: clean }, null, 2), 'utf8');
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
      // mtime 지정(utimes)까지 한 덩어리로 직렬화한다
      return withFileLock(abs, async () => {
        await writeFileAtomicUnlocked(abs, content, 'utf8');
        if (mtime !== null) { const t = new Date(Number(mtime)); await fs.utimes(abs, t, t); }
        return { mtime: Math.round((await fs.stat(abs)).mtimeMs) };
      });
    },

    'PUT /api/bundle/asset': async (req, q) => {
      const p = bundleRel(q.get('path'), 'asset');
      const abs = await safe(p, { mustExist: false });
      const body = await readBody(req, MAX_UPLOAD);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await writeFileAtomic(abs, body);
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
      const { content, baseMtime, force } = await readJson(req);
      if (typeof content !== 'string') throw new HttpError(400, 'content 필요');
      if (baseMtime !== undefined && (typeof baseMtime !== 'number' || !Number.isFinite(baseMtime))) throw new HttpError(400, 'baseMtime 은 숫자여야 함');
      await fs.mkdir(path.dirname(abs), { recursive: true });
      // 충돌 검사와 쓰기를 같은 락 안에서 해 그 사이에 다른 저장이 끼어들지 못하게 한다
      return withFileLock(abs, async () => {
        if (baseMtime !== undefined && force !== true) {
          const st = await fs.stat(abs).catch(() => null);
          if (!st) throw new HttpError(409, '글이 삭제되었거나 이동되었습니다', { error: 'gone', message: '글이 삭제되었거나 이름이 바뀌었습니다' });
          if (Math.abs(st.mtimeMs - baseMtime) > MTIME_TOLERANCE) {
            throw new HttpError(409, '외부에서 수정되었습니다', { error: 'conflict', mtime: st.mtimeMs, message: '열어 둔 뒤 다른 곳에서 글이 수정되었습니다' });
          }
        }
        await writeFileAtomicUnlocked(abs, content, 'utf8');
        return { mtime: (await fs.stat(abs)).mtimeMs };
      });
    },

    'POST /api/create': async (req) => {
      const { path: p, type } = await readJson(req);
      const abs = await safe(p, { mustExist: false });
      if (await exists(abs)) throw new HttpError(409, '이미 존재함');
      // exists 와 생성 사이에 같은 경로를 만든 요청이 있을 수 있으므로 배타 생성(wx / 마지막 단계만 mkdir)하고 EEXIST 는 409 로 바꾼다
      try {
        if (type === 'dir') {
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.mkdir(abs);
        } else {
          if (!isMd(abs)) throw new HttpError(400, '.md 파일만 허용');
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, '', { encoding: 'utf8', flag: 'wx' });
        }
      } catch (e) {
        if (e.code === 'EEXIST') throw new HttpError(409, '이미 존재함');
        throw e;
      }
      return { path: rel(abs) };
    },

    // 이름 변경/이동. 문서면 assets/<문서명> 폴더를 함께 옮기고 본문 링크를 갱신한다.
    'POST /api/rename': async (req) => {
      const { from, to } = await readJson(req);
      const src = await safe(from);
      const dst = await safe(to, { mustExist: false });
      // trashMove 와 같은 규칙: 숨김(.works, .comments …) 항목은 옮기거나 그 이름으로 만들 수 없다
      if ([rel(src), rel(dst)].some((r) => r.split('/').some((s) => s.startsWith('.')))) throw new HttpError(400, '숨김 항목은 이름을 바꿀 수 없음');
      const st = await fs.stat(src);
      const run = async () => {
        // 대소문자만 바꾸는 이름 변경(a.md → A.md)은 대소문자를 구분하지 않는 파일 시스템에서 대상이 '이미 있는' 것처럼 보이지만 같은 파일이다.
        // 경로가 대소문자 무시로 같고 inode 도 같을 때만 허용한다(대소문자를 구분하는 파일 시스템의 별개 파일 A.md 는 inode 가 달라 409)
        if (await exists(dst)) {
          const [ss, ds] = await Promise.all([fs.stat(src, { bigint: true }), fs.stat(dst, { bigint: true })]);
          const sameFile = rel(src).toLowerCase() === rel(dst).toLowerCase() && ss.ino !== 0n && ss.ino === ds.ino && ss.dev === ds.dev;
          if (!sameFile) throw new HttpError(409, '대상이 이미 존재함');
        }
        if (st.isFile() && !(isMd(src) && isMd(dst))) throw new HttpError(400, '.md 파일만 허용');
        const oldAssets = st.isFile() ? docAssetsDir(src) : null;
        const newAssets = oldAssets && docAssetsDir(dst);
        const moveAssets = !!oldAssets && oldAssets !== newAssets && (await exists(oldAssets));
        // 문서를 옮긴 뒤에 assets 이동이 막혀 문서만 옮겨지지 않도록 미리 검사한다(같은 항목의 대소문자 변경은 허용)
        if (moveAssets && (await present(newAssets))) {
          const [a, b] = await Promise.all([fs.stat(oldAssets, { bigint: true }), fs.stat(newAssets, { bigint: true })]);
          if (!(rel(oldAssets).toLowerCase() === rel(newAssets).toLowerCase() && a.ino !== 0n && a.ino === b.ino && a.dev === b.dev)) {
            throw new HttpError(409, '대상 assets 폴더가 이미 존재함');
          }
        }
        await fs.mkdir(path.dirname(dst), { recursive: true });
        // 단계마다 되돌리기를 쌓아 두고, 중간에 실패하면 거꾸로 실행한다
        const undo = [];
        try {
          await fs.rename(src, dst);
          undo.push(() => fs.rename(dst, src));
          if (await moveComments(rel(src), rel(dst), st.isFile())) undo.push(() => moveComments(rel(dst), rel(src), st.isFile()));
          await works.moveDoc(rel(src), rel(dst), st.isFile()).catch(() => { /* 사이드카는 부가 데이터 */ });
          undo.push(() => works.moveDoc(rel(dst), rel(src), st.isFile()));
          if (moveAssets) {
            await fs.mkdir(path.dirname(newAssets), { recursive: true });
            await fs.rename(oldAssets, newAssets);
            undo.push(() => fs.rename(newAssets, oldAssets));
            const oldName = path.basename(oldAssets);
            const newName = path.basename(newAssets);
            if (oldName !== newName) {
              // 읽기-쓰기를 같은 락(바깥에서 이미 잡았다) 안에서 해 그 사이 저장이 덮어써지지 않게 한다. 링크는 디코딩해 비교하고 원래 인코딩 형태를 유지한다
              const text = await fs.readFile(dst, 'utf8');
              const next = relinkAssets(text, oldName, newName);
              if (next !== text) await writeFileAtomicUnlocked(dst, next, 'utf8');
            }
          }
        } catch (e) {
          for (const u of undo.reverse()) await u().catch(() => {});
          throw e;
        }
        return { path: rel(dst) };
      };
      if (!st.isFile()) return run();
      // 진행 중인 PUT /api/file 과 직렬화한다. 락을 두 개 잡으므로 항상 같은 순서(키 정렬)로 잡아 교착을 피하고, 같은 키(대소문자만 다른 이름)는 한 번만 잡는다
      const key = (f) => (process.platform === 'win32' || process.platform === 'darwin' ? f.toLowerCase() : f);
      const files = [...new Map([src, dst].map((f) => [key(f), f])).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, f]) => f);
      return files.reduceRight((inner, f) => () => withFileLock(f, inner), run)();
    },

    // 삭제는 휴지통으로 옮긴다(글의 assets·코멘트·이력·스레드, 폴더면 안의 모든 파일 포함). 복구는 POST /api/trash/restore
    'DELETE /api/file': async (_req, q) => ({ ok: true, trashId: await trashMove(q.get('path')) }),

    'GET /api/trash': async () => ({ items: await listTrash() }),

    'POST /api/trash/restore': async (req) => {
      const { id } = await readJson(req);
      return restoreTrash(id);
    },

    // id 가 있으면 그 항목만, 없으면 휴지통 비우기
    'DELETE /api/trash': async (_req, q) => {
      if (q.has('id')) {
        const td = await trashItem(q.get('id'));
        return withFileLock(td, async () => {
          if (!(await present(td))) throw new HttpError(404, '휴지통에 없는 항목');
          await fs.rm(td, { recursive: true, force: true });
          return { ok: true, removed: 1 };
        });
      }
      const base = await trashRoot();
      let removed = 0;
      for (const e of await fs.readdir(base, { withFileTypes: true }).catch(() => [])) {
        if (!e.isDirectory() || !TRASH_ID_RE.test(e.name)) continue;
        await fs.rm(path.join(base, e.name), { recursive: true, force: true });
        removed++;
      }
      return { ok: true, removed };
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
      // 이름이 겹치면(동시 업로드) 다음 번호로 넘어가고, 완성된 파일만 최종 이름으로 나타난다
      for (let i = 2; ; i++) {
        try { await writeFileExclusive(path.join(dir, name), body); break; }
        catch (e) { if (e.code !== 'EEXIST') throw e; name = `${stamp}-${i}${ext}`; }
      }
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
    pipeline(createReadStream(WASM_FILE), res, () => {});
  }

  void purgeTrash().catch(() => {}); // 서버 시작 때 30일 지난 휴지통 항목 정리

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
      // 예상 못 한 오류의 message 는 경로 등 내부 정보를 담을 수 있어 응답에 싣지 않는다(상세는 위 로그)
      const message = status === 500 && !(e instanceof HttpError) ? '서버 내부 오류' : e.message;
      res.end(JSON.stringify({ error: message, ...(e instanceof HttpError ? e.extra : null) }));
    }
    return true;
  };
}
