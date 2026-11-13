// 사이드카 저장소: 노트 루트의 `.works/<컬렉션>/<파티션>/<id>.json` 에 레코드를 한 건당 한 파일로 둔다.
// 파티션은 문서 경로(이력·스레드)이고, 글감처럼 문서에 속하지 않는 컬렉션은 파티션이 '_' 하나뿐이다.
// 숨김 폴더라 트리·검색에서 제외된다. 경로 검사는 호출자가 넘긴 safe()(루트 밖·symlink 거부)에 맡긴다.
import fs from 'node:fs/promises';
import path from 'node:path';

export const WORKS_DIR = '.works';
/** 컬렉션 → 문서별 파티션 여부 */
export const COLLS = { versions: true, snippets: false, threads: true, tombstones: false };
export const GLOBAL_PART = '_';
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_PART = 200;

export class WorksError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---- 원자적 쓰기 ----
// 같은 폴더의 숨김 임시 파일에 쓴 뒤 rename 으로 바꿔치기한다(쓰는 도중 죽어도 원본이 반쯤 잘린 채 남지 않는다).
// 임시 이름이 '.' 로 시작하고 .md/.json 이 아니어서 트리·검색·번들 목록·사이드카 목록에 잡히지 않는다.
// 같은 경로에 대한 쓰기는 프로세스 안에서 Promise 체인으로 직렬화한다(Windows·macOS 는 대소문자 무시 키).
const locks = new Map();
const lockKey = (file) => (process.platform === 'win32' || process.platform === 'darwin' ? file.toLowerCase() : file);
const tmpName = (file) => path.join(path.dirname(file), `.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);

/** 같은 경로에 대한 fn 실행을 한 번에 하나씩 순서대로 돌린다(충돌 검사와 쓰기를 한 덩어리로 묶을 때 쓴다) */
export function withFileLock(file, fn) {
  const key = lockKey(file);
  const run = (locks.get(key) ?? Promise.resolve()).then(fn);
  const tail = run.then(() => {}, () => {});
  locks.set(key, tail);
  void tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return run;
}

/** 락 없이 임시 파일 + rename 으로 쓴다. 실패하면 임시 파일을 지운다. 이미 withFileLock 안에 있을 때 쓴다 */
export async function writeFileAtomicUnlocked(file, data, encoding) {
  const tmp = tmpName(file);
  try {
    await fs.writeFile(tmp, data, encoding);
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

export const writeFileAtomic = (file, data, encoding) => withFileLock(file, () => writeFileAtomicUnlocked(file, data, encoding));

/** 이미 있으면 EEXIST 로 실패하는 원자적 쓰기(백업·이미지 이름 충돌 방지). 완성된 내용만 최종 이름으로 나타난다 */
export function writeFileExclusive(file, data) {
  return withFileLock(file, async () => {
    const tmp = tmpName(file);
    try {
      await fs.writeFile(tmp, data);
      try {
        await fs.link(tmp, file); // 대상이 있으면 EEXIST
      } catch (e) {
        if (e.code === 'EEXIST') throw e;
        // 하드링크를 못 쓰는 파일 시스템: 존재 확인 뒤 rename
        if (await fs.access(file).then(() => true, () => false)) throw Object.assign(new Error('이미 존재함'), { code: 'EEXIST' });
        await fs.rename(tmp, file);
      }
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  });
}

// 파일 시스템에 쓸 수 없는 글자(윈도 기준)와 맨 앞 '.', 끝의 '.'·공백만 %XX 로 바꾼다 (한글 등은 그대로 둔다)
export const encPart = (s) =>
  s.replace(/[\\/:*?"<>|%\x00-\x1f]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
    .replace(/^\./, '%2e').replace(/[. ]$/, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
export const decPart = (s) => s.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

export function createWorksFs(safe) {
  const check = (coll, part) => {
    if (!Object.hasOwn(COLLS, coll)) throw new WorksError(400, '알 수 없는 컬렉션');
    if (!COLLS[coll]) return GLOBAL_PART;
    if (typeof part !== 'string' || !part || part === GLOBAL_PART || part.length > MAX_PART) throw new WorksError(400, '잘못된 파티션');
    return part;
  };
  const checkId = (id) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new WorksError(400, '잘못된 id');
    return id;
  };
  const collDir = (coll) => safe(`${WORKS_DIR}/${coll}`, { mustExist: false });
  // 파티션 폴더는 반드시 컬렉션 폴더 바로 아래 한 단계여야 한다(이스케이프가 어긋나도 밖으로 못 나가게 이중 방어)
  const partDir = async (coll, part) => {
    const d = await safe(`${WORKS_DIR}/${coll}/${encPart(part)}`, { mustExist: false });
    if (path.dirname(d) !== (await collDir(coll))) throw new WorksError(400, '잘못된 파티션');
    return d;
  };
  const readDir = (d) => fs.readdir(d, { withFileTypes: true }).catch(() => []);

  async function list(coll, part) {
    const p = check(coll, part);
    const d = await partDir(coll, p);
    const names = (await readDir(d)).filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name);
    const out = [];
    // 파일이 많으면 하나씩 읽는 왕복이 지연의 대부분이라 16개씩 묶어 읽는다(순서는 유지)
    for (let i = 0; i < names.length; i += 16) {
      const batch = await Promise.all(names.slice(i, i + 16).map(async (n) => {
        try { return JSON.parse(await fs.readFile(`${d}/${n}`, 'utf8')); } catch { return null; /* 깨진 파일은 건너뛴다 */ }
      }));
      for (const r of batch) if (r) out.push(r);
    }
    return out;
  }

  // 단건 조회: 파일 하나만 읽는다(list 후 find 하는 O(n) 을 피한다). 없거나 깨졌으면 null
  async function get(coll, part, id) {
    const p = check(coll, part);
    const file = `${await partDir(coll, p)}/${checkId(id)}.json`;
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
  }

  async function put(coll, part, rec) {
    const p = check(coll, part);
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw new WorksError(400, '레코드 형식 오류');
    checkId(rec.id);
    if (typeof rec.updatedAt !== 'number' || !Number.isFinite(rec.updatedAt)) throw new WorksError(400, 'updatedAt 필요');
    const d = await partDir(coll, p);
    await fs.mkdir(d, { recursive: true });
    await writeFileAtomic(`${d}/${rec.id}.json`, JSON.stringify(rec), 'utf8');
  }

  async function remove(coll, part, id) {
    const p = check(coll, part);
    await fs.rm(`${await partDir(coll, p)}/${checkId(id)}.json`, { force: true });
  }

  // 레코드가 하나라도 있는 파티션 목록
  async function parts(coll) {
    check(coll, 'x');
    if (!COLLS[coll]) return (await list(coll)).length ? [GLOBAL_PART] : [];
    const out = [];
    const base = await collDir(coll);
    for (const e of await readDir(base)) {
      if (!e.isDirectory()) continue;
      if ((await readDir(`${base}/${e.name}`)).some((f) => f.name.endsWith('.json'))) out.push(decPart(e.name));
    }
    return out;
  }

  async function removePart(coll, part) {
    const p = check(coll, part);
    await fs.rm(await partDir(coll, p), { recursive: true, force: true });
  }

  // 레코드의 docKey 를 파티션(문서 경로)에 맞춘다. 이름 변경 뒤 옛 경로가 남으면 이후 저장·삭제가 옛 파티션으로 간다.
  async function rekey(dir, names, docKey) {
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const f = `${dir}/${n}`;
      try {
        const rec = JSON.parse(await fs.readFile(f, 'utf8'));
        if (rec && typeof rec === 'object' && rec.docKey !== docKey) await writeFileAtomic(f, JSON.stringify({ ...rec, docKey }), 'utf8');
      } catch { /* 깨진 파일은 건너뛴다 */ }
    }
  }
  const sameEntry = async (x, y) => {
    const [sx, sy] = await Promise.all([fs.stat(x, { bigint: true }), fs.stat(y, { bigint: true })]).catch(() => []);
    return !!sx && sx.ino !== 0n && sx.ino === sy.ino && sx.dev === sy.dev;
  };

  // from 파티션의 레코드를 to 로 옮긴다. to 에 같은 id 가 있으면 덮어쓴다. threads 는 레코드의 docKey 도 to 로 고친다.
  async function movePart(coll, from, to) {
    const a = await partDir(coll, check(coll, from));
    const b = await partDir(coll, check(coll, to));
    if (a === b) return;
    const files = (await readDir(a)).filter((e) => e.isFile());
    if (!files.length) return;
    // 대소문자만 다른 이름(a.md → A.md)은 대소문자를 구분하지 않는 파일 시스템에서 같은 폴더다 — 파일을 옮기고 a 를 지우면 전부 사라지므로 폴더 이름만 바꾼다
    if (await sameEntry(a, b)) {
      await fs.rename(a, b);
    } else {
      await fs.mkdir(b, { recursive: true });
      for (const e of files) await fs.rename(`${a}/${e.name}`, `${b}/${e.name}`);
      await fs.rm(a, { recursive: true, force: true });
    }
    if (coll === 'threads') await rekey(b, files.map((e) => e.name), to);
  }

  // 문서(또는 폴더)의 이름 변경·삭제에 맞춰 문서별 파티션을 따라 옮기거나 지운다. 폴더는 접두사로 찾는다.
  const docColls = Object.keys(COLLS).filter((c) => COLLS[c]);
  async function matching(coll, relPath, isFile) {
    return (await parts(coll)).filter((p) => (isFile ? p === relPath : p.startsWith(relPath + '/')));
  }
  async function moveDoc(fromRel, toRel, isFile) {
    for (const coll of docColls) {
      for (const p of await matching(coll, fromRel, isFile)) {
        await movePart(coll, p, isFile ? toRel : toRel + p.slice(fromRel.length));
      }
    }
  }
  async function deleteDoc(relPath, isFile) {
    for (const coll of docColls) {
      for (const p of await matching(coll, relPath, isFile)) await removePart(coll, p);
    }
  }

  // 휴지통 이동·복구용: 파티션 폴더의 절대 경로
  const partPath = (coll, part) => partDir(coll, check(coll, part));

  // 바깥(휴지통)에 있는 파티션 폴더 srcDir 를 part 파티션으로 들여온다. 이미 있으면 파일 단위로 덮어쓴다. threads 는 docKey 도 part 로 고친다.
  async function importPart(coll, srcDir, part) {
    const b = await partDir(coll, check(coll, part));
    const files = (await readDir(srcDir)).filter((e) => e.isFile());
    if (!(await fs.access(b).then(() => true, () => false))) {
      await fs.mkdir(path.dirname(b), { recursive: true });
      await fs.rename(srcDir, b);
    } else {
      for (const e of files) await fs.rename(`${srcDir}/${e.name}`, `${b}/${e.name}`);
      await fs.rm(srcDir, { recursive: true, force: true });
    }
    if (coll === 'threads') await rekey(b, files.map((e) => e.name), part);
  }

  return { list, get, put, remove, parts, removePart, movePart, moveDoc, deleteDoc, partPath, importPart };
}
