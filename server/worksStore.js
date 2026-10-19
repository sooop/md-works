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
    const out = [];
    for (const e of await readDir(d)) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      try { out.push(JSON.parse(await fs.readFile(`${d}/${e.name}`, 'utf8'))); } catch { /* 깨진 파일은 건너뛴다 */ }
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
    const file = `${d}/${rec.id}.json`;
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(rec), 'utf8');
    await fs.rename(tmp, file);
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

  // from 파티션의 레코드를 to 로 옮긴다. to 에 같은 id 가 있으면 덮어쓴다.
  async function movePart(coll, from, to) {
    const a = await partDir(coll, check(coll, from));
    const b = await partDir(coll, check(coll, to));
    if (a === b) return;
    const files = (await readDir(a)).filter((e) => e.isFile());
    if (!files.length) return;
    await fs.mkdir(b, { recursive: true });
    for (const e of files) await fs.rename(`${a}/${e.name}`, `${b}/${e.name}`);
    await fs.rm(a, { recursive: true, force: true });
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

  return { list, get, put, remove, parts, removePart, movePart, moveDoc, deleteDoc };
}
