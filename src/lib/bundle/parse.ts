// 번들(zip) 읽기: 항목 경로를 절대 신뢰하지 않고 검증한 뒤, 모든 내용을 파싱해 ParsedBundle 로 돌려준다.
// 이 단계가 끝나기 전에는 보관소에 아무것도 쓰지 않는다(applyBundle 이 부분 적용을 최소화하기 위한 전제).
import { unzipSync, type UnzipFileInfo } from 'fflate';
import { decPart } from './partName';
import type { Snippet, Thread, Version } from '../works/types';
import { cleanSnippet, cleanThread, cleanVersion, ID_RE } from './records';

export class BundleError extends Error {}

/** 압축을 푼 뒤 합계 상한 (zip 폭탄 방어. archive.ts 와 같다) */
export const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
/**
 * zip 항목 수 상한 (글 + 이미지 + 이력·스레드·글감 레코드가 모두 항목 하나씩이다).
 * fflate 는 zip64 를 지원하지 않아 항목 수가 65535 를 넘으면 끝 디렉터리의 16비트 개수가 넘쳐 읽을 수 없다 — 만들 때도 같은 상한을 지킨다.
 */
export const MAX_ENTRIES = 65_535;
/** 글·JSON 항목 하나의 상한 (이미지는 합계 상한만 적용) */
export const MAX_TEXT_ENTRY_BYTES = 100 * 1024 * 1024;

export const WORKS_DIR = '.works';
export const BUNDLE_SCHEMA = 'md-works-bundle';
export const BUNDLE_VERSION = 1;

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
const DOC_EXT_RE = /\.md$/i;
const SKIP_DOC_DIRS = new Set(['assets', 'node_modules']); // 서버 트리·검색이 건너뛰는 폴더(여기 있는 .md 는 글이 아니다)

/**
 * zip 항목 경로를 검증·정규화한다. 위험하면 BundleError.
 * 거부: 빈 값·NUL·제어문자, 역슬래시, 절대경로, 드라이브 문자·`:`, `.`/`..`/빈 구간, 끝이 `.`·공백인 구간(윈도가 바꿔 버린다),
 *       `.works` 이외의 숨김 구간(맨 앞의 `.works` 만 허용).
 */
export function safeEntryPath(raw: string): string {
  const bad = (why: string) => new BundleError(`번들 항목 경로가 안전하지 않습니다 (${why}): ${JSON.stringify(raw.slice(0, 120))}`);
  if (typeof raw !== 'string' || !raw) throw bad('빈 경로');
  if (raw.length > 1024) throw bad('너무 긺');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw bad('제어 문자');
  if (raw.includes('\\')) throw bad('역슬래시');
  if (raw.startsWith('/')) throw bad('절대 경로');
  if (/^[A-Za-z]:/.test(raw)) throw bad('드라이브 문자');
  const segs = raw.split('/');
  segs.forEach((s, i) => {
    if (!s) throw bad('빈 구간');
    if (s === '.' || s === '..') throw bad('상위/현재 폴더 구간');
    if (s.includes(':')) throw bad('콜론');
    if (s.length > 255) throw bad('구간이 너무 긺');
    if (/[. ]$/.test(s)) throw bad('끝이 점 또는 공백');
    if (s.startsWith('.') && !(i === 0 && s === WORKS_DIR)) throw bad('숨김 폴더');
  });
  return raw;
}

/** 글 이름(번들 경로) 검증: 안전한 상대 경로이고 `.md` 로 끝나며 .works 아래가 아니어야 한다 */
export function isDocName(name: string): boolean {
  try { safeEntryPath(name); } catch { return false; }
  const segs = name.split('/');
  return DOC_EXT_RE.test(name) && segs[0] !== WORKS_DIR && !segs.slice(0, -1).some((s) => SKIP_DOC_DIRS.has(s));
}

export interface ParsedBundle {
  manifest: { createdAt: number; mode: 'server' | 'html'; app?: string };
  /** 키 = 번들 안의 글 경로 */
  docs: Map<string, { content: string; updatedAt?: number }>;
  /** 키 = 번들 안의 이미지 경로 */
  assets: Map<string, Uint8Array>;
  /** 키 = 글 이름(번들 경로). 레코드의 docKey 도 이 이름으로 맞춰 둔다 */
  versions: Map<string, Version[]>;
  threads: Map<string, Thread[]>;
  snippets: Snippet[];
  /** serializeDesign() 결과 원문 */
  design?: string;
  tombstones: { docs: Record<string, number> };
}

type Kind =
  | { k: 'manifest' } | { k: 'docs' } | { k: 'design' } | { k: 'tombstones' }
  | { k: 'doc' } | { k: 'asset' }
  | { k: 'version' | 'thread'; part: string; id: string }
  | { k: 'snippet'; id: string };

function classify(path: string): Kind | null {
  const segs = path.split('/');
  if (segs[0] === WORKS_DIR) {
    const f = segs.slice(1);
    if (f.length === 1 && f[0] === 'docs.json') return { k: 'docs' };
    if (f.length === 1 && f[0] === 'design.json') return { k: 'design' };
    if (f.length === 1 && f[0] === 'tombstones.json') return { k: 'tombstones' };
    if (f.length === 3 && f[2].endsWith('.json')) {
      const id = f[2].slice(0, -5);
      if (!ID_RE.test(id)) return null;
      if (f[0] === 'versions' || f[0] === 'threads') return { k: f[0] === 'versions' ? 'version' : 'thread', part: f[1], id };
      if (f[0] === 'snippets' && f[1] === '_') return { k: 'snippet', id };
    }
    return null;
  }
  if (path === 'manifest.json') return { k: 'manifest' };
  const i = segs.lastIndexOf('assets');
  if (i >= 0 && i === segs.length - 3 && IMAGE_EXT_RE.test(path)) return { k: 'asset' };
  if (isDocName(path)) return { k: 'doc' };
  return null; // 그 밖의 파일은 무시한다
}

const dec = new TextDecoder('utf-8', { fatal: false });
function jsonOf(data: Uint8Array): unknown {
  try { return JSON.parse(dec.decode(data)); } catch { return undefined; }
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * 중앙 디렉터리가 선언한 압축 해제 크기와 각 항목 앞의 로컬 헤더가 선언한 크기를 대조한다.
 * 다르면 한쪽이 조작·손상된 것이다(fflate 는 중앙 디렉터리의 크기만큼만 풀어, 작게 선언되면 조용히 잘린 글이 나온다).
 * 로컬 헤더에 크기가 없는(데이터 설명자, 플래그 bit 3) 항목은 대조할 수 없어 건너뛴다.
 */
function checkDeclaredSizes(bytes: Uint8Array): void {
  if (bytes.length < 22) return;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return; // zip 이 아니면 unzipSync 가 오류를 낸다
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) return;
    const flags = dv.getUint16(p + 8, true);
    const usize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    if (!(flags & 8) && local + 30 <= bytes.length && dv.getUint32(local, true) === 0x04034b50 && dv.getUint32(local + 22, true) !== usize) {
      throw new BundleError('번들 항목의 크기 정보가 서로 달라 손상된 것으로 보입니다');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
}

/** 번들 zip 을 검증하고 파싱한다. 형식·경로·크기에 문제가 있으면 BundleError 를 던진다. */
export function parseBundle(bytes: Uint8Array, limits: { maxEntries?: number } = {}): ParsedBundle {
  const maxEntries = limits.maxEntries ?? MAX_ENTRIES;
  const kinds = new Map<string, Kind>();
  const declared = new Map<string, number>(); // zip 헤더가 선언한 압축 해제 크기
  let total = 0;
  let count = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (f: UnzipFileInfo) => {
        if (++count > maxEntries) throw new BundleError(`번들 항목이 너무 많습니다 (${maxEntries}개 초과)`);
        const isDir = f.name.endsWith('/');
        const path = safeEntryPath(isDir ? f.name.slice(0, -1) : f.name); // 폴더 항목도 경로 검사는 한다
        if (isDir) return false;
        const kind = classify(path);
        if (!kind) return false;
        total += f.originalSize;
        if (total > MAX_TOTAL_BYTES) throw new BundleError('압축을 풀면 1GB 를 넘어 가져올 수 없습니다');
        if (kind.k !== 'asset' && f.originalSize > MAX_TEXT_ENTRY_BYTES) throw new BundleError(`번들 항목이 너무 큽니다: ${path}`);
        kinds.set(f.name, kind);
        declared.set(f.name, f.originalSize);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof BundleError) throw e;
    throw new BundleError('번들(zip)을 읽지 못했습니다: 손상되었거나 zip 형식이 아닙니다');
  }
  checkDeclaredSizes(bytes); // 선언보다 적게 풀려 조용히 잘린 글을 막는다
  // 헤더가 크기를 속여도(선언보다 많이 풀림) 실제 크기로 한 번 더 상한을 검사한다
  let real = 0;
  for (const [name, data] of Object.entries(entries)) {
    real += data.length;
    if (real > MAX_TOTAL_BYTES) throw new BundleError('압축을 풀면 1GB 를 넘어 가져올 수 없습니다');
    const kind = kinds.get(name);
    // 선언과 실제 크기가 다르면 조용히 잘린(또는 부풀려진) 내용일 수 있으니 가져오지 않는다
    if (kind && declared.get(name) !== data.length) throw new BundleError(`번들 항목의 크기가 헤더와 달라 손상된 것으로 보입니다: ${name}`);
    if (kind && kind.k !== 'asset' && data.length > MAX_TEXT_ENTRY_BYTES) throw new BundleError(`번들 항목이 너무 큽니다: ${name}`);
  }

  const manifestEntry = Object.keys(entries).find((n) => kinds.get(n)?.k === 'manifest');
  const m = manifestEntry ? jsonOf(entries[manifestEntry]) : undefined;
  if (!isObj(m) || m.schema !== BUNDLE_SCHEMA) throw new BundleError('md-works 번들이 아닙니다 (manifest.json 이 없거나 형식이 다릅니다)');
  if (typeof m.version !== 'number' || !Number.isInteger(m.version) || m.version < 1) throw new BundleError('번들 버전 정보가 올바르지 않습니다');
  if (m.version > BUNDLE_VERSION) throw new BundleError(`더 새로운 버전(v${m.version})의 번들입니다. 앱을 업데이트하세요`);

  const out: ParsedBundle = {
    manifest: {
      createdAt: typeof m.createdAt === 'number' && Number.isFinite(m.createdAt) ? m.createdAt : 0,
      mode: m.mode === 'server' ? 'server' : 'html',
      ...(typeof m.app === 'string' ? { app: m.app.slice(0, 100) } : {}),
    },
    docs: new Map(), assets: new Map(), versions: new Map(), threads: new Map(), snippets: [], tombstones: { docs: {} },
  };

  let docMeta: Record<string, unknown> = {};
  const sidecars: { kind: Extract<Kind, { part: string }>; data: Uint8Array }[] = [];
  const snippetData: { id: string; data: Uint8Array }[] = [];
  for (const [name, data] of Object.entries(entries)) {
    const kind = kinds.get(name);
    if (!kind) continue;
    switch (kind.k) {
      case 'doc': out.docs.set(name, { content: dec.decode(data) }); break;
      case 'asset': out.assets.set(name, data); break;
      case 'docs': { const j = jsonOf(data); if (isObj(j)) docMeta = j; break; }
      case 'design': out.design = dec.decode(data); break;
      case 'tombstones': {
        const j = jsonOf(data);
        if (isObj(j) && isObj(j.docs)) {
          for (const [n, t] of Object.entries(j.docs)) if (typeof t === 'number' && Number.isFinite(t) && n.length <= 1024) out.tombstones.docs[n] = t;
        }
        break;
      }
      case 'version': case 'thread': sidecars.push({ kind, data }); break;
      case 'snippet': snippetData.push({ id: kind.id, data }); break;
      default: break;
    }
  }

  for (const [n, doc] of out.docs) {
    const meta = docMeta[n];
    const t = isObj(meta) && typeof meta.updatedAt === 'number' && Number.isFinite(meta.updatedAt) ? meta.updatedAt : undefined;
    if (t !== undefined) doc.updatedAt = t;
  }

  for (const { kind, data } of sidecars) {
    const docName = decPart(kind.part);
    if (!isDocName(docName)) continue; // 글 이름으로 풀리지 않는 파티션은 버린다
    const j = jsonOf(data);
    const rec = kind.k === 'version' ? cleanVersion(j, docName) : cleanThread(j, docName);
    if (!rec || rec.id !== kind.id) continue;
    const bucket = (kind.k === 'version' ? out.versions : out.threads) as Map<string, unknown[]>;
    const list = bucket.get(docName) ?? [];
    list.push(rec);
    bucket.set(docName, list);
  }
  for (const { id, data } of snippetData) {
    const s = cleanSnippet(jsonOf(data));
    if (s && s.id === id) out.snippets.push(s);
  }
  return out;
}
