// 폴더 내보내기: 호스트(listDocs/readDoc)만으로 폴더 하나를 백업 JSON · MD zip · 연결된 MD 로 만든다. 두 모드가 같은 코드로 동작한다.
// 에셋 경로는 폴더 접두어를 떼어 쓴다. 글 본문의 이미지 링크는 글 기준 상대 경로라 글·에셋에서 같은 접두어를 떼면 링크가 그대로 유효하다.
import { zipSync, type Zippable } from 'fflate';
import type { BundleHost, HostDocInfo } from './bundle/host';
import { BUNDLE_SCHEMA, BUNDLE_VERSION, BundleError } from './bundle/parse';
import { encPart } from './bundle/partName';
import type { Thread } from './works/types';
import { IMAGE_RE, basename, dirname, joinPath, safeDecode, isExternalSrc } from './utils';

export const FOLDER_SCHEMA = 'md-works-folder';
export const FOLDER_VERSION = 1;

export interface FolderJsonDoc { path: string; content: string; updatedAt: number; threads: Thread[] }
export interface FolderJson {
  schema: typeof FOLDER_SCHEMA;
  version: number;
  folder: string;
  exportedAt: number;
  docs: FolderJsonDoc[];
  assets: Record<string, string>;
}

export interface FolderDoc { rel: string; info: HostDocInfo; content: string }
export interface FolderData { folder: string; docs: FolderDoc[]; assets: Map<string, Uint8Array> }

const IMG_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
};
const mimeOf = (p: string) => IMG_MIME[/\.([a-z0-9]+)$/i.exec(p)?.[1].toLowerCase() ?? ''];
const trimDir = (f: string) => f.replace(/^\/+|\/+$/g, '');
const stripMd = (n: string) => n.replace(/\.md$/i, '');
const byName = (a: string, b: string) => a.localeCompare(b, 'ko', { numeric: true });

/** 바이트 → base64. 큰 파일에서 문자열 폭발을 피하려 3의 배수 청크로 나눠 변환한다 */
export function bytesToBase64(data: Uint8Array): string {
  const CHUNK = 0x6000; // 3 의 배수여야 청크별 base64 를 이어 붙일 수 있다
  const parts: string[] = [];
  for (let i = 0; i < data.length; i += CHUNK) {
    parts.push(btoa(String.fromCharCode.apply(null, data.subarray(i, i + CHUNK) as unknown as number[])));
  }
  return parts.join('');
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 폴더 안의 글(하위 폴더 포함)과 그 에셋을 읽는다. 대기 중인 편집은 먼저 저장한다 */
export async function collectFolder(host: BundleHost, folderPath: string): Promise<FolderData> {
  const folder = trimDir(folderPath);
  await host.prepare();
  const prefix = folder + '/';
  const infos = (await host.listDocs()).filter((d) => d.name.startsWith(prefix) && /\.md$/i.test(d.name)).sort((a, b) => byName(a.name, b.name));
  const docs: FolderDoc[] = [];
  const assets = new Map<string, Uint8Array>();
  for (const info of infos) {
    const body = await host.readDoc(info);
    docs.push({ rel: info.name.slice(prefix.length), info, content: body.content });
    // 폴더 밖을 가리키는 에셋은 폴더 기준 경로로 만들 수 없어 담지 않는다
    for (const a of body.assets) if (a.path.startsWith(prefix)) assets.set(a.path.slice(prefix.length), a.data);
  }
  return { folder, docs, assets };
}

export const folderLeaf = (folder: string) => basename(trimDir(folder));

/** 백업 JSON: 글 + 이미지 + 코멘트(이력·글감 제외) */
export async function exportFolderJson(host: BundleHost, folderPath: string, now = Date.now()): Promise<{ text: string; count: number }> {
  const data = await collectFolder(host, folderPath);
  const docs: FolderJsonDoc[] = [];
  for (const d of data.docs) {
    const threads = (await host.store.list<Thread>('threads', d.info.key)).map((t) => ({ ...t, docKey: d.rel }));
    docs.push({ path: d.rel, content: d.content, updatedAt: d.info.updatedAt, threads });
  }
  const assets: Record<string, string> = {};
  for (const [p, bytes] of data.assets) assets[p] = bytesToBase64(bytes);
  const json: FolderJson = { schema: FOLDER_SCHEMA, version: FOLDER_VERSION, folder: data.folder, exportedAt: now, docs, assets };
  return { text: JSON.stringify(json), count: docs.length };
}

/** MD 압축: `이름.md` + `assets/<문서명>/<번호>.<확장자>` (기존 zip 가져오기가 받는 구조). 코멘트는 담지 않는다 */
export async function exportFolderZip(host: BundleHost, folderPath: string): Promise<{ bytes: Uint8Array; count: number }> {
  const data = await collectFolder(host, folderPath);
  const enc = new TextEncoder();
  const files: Zippable = {};
  for (const d of data.docs) files[d.rel] = enc.encode(d.content);
  for (const [p, bytes] of data.assets) files[p] = [bytes, { level: 0 }];
  return { bytes: zipSync(files), count: data.docs.length };
}

/** order(host 글 이름 순서)대로 글을 잇는다. 목록에 없는 글은 뒤에 이름순. 이미지는 data URI 로 인라인 */
export function linkDocs(data: FolderData, order: string[]): string {
  const rank = new Map(order.map((n, i) => [n, i]));
  const docs = [...data.docs].sort((a, b) => {
    const ra = rank.get(a.info.name);
    const rb = rank.get(b.info.name);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return byName(a.info.name, b.info.name);
  });
  const uris = new Map<string, string>();
  const dataUri = (path: string): string | null => {
    const hit = uris.get(path);
    if (hit) return hit;
    const bytes = data.assets.get(path);
    const mime = mimeOf(path);
    if (!bytes || !mime) return null;
    const uri = `data:${mime};base64,${bytesToBase64(bytes)}`;
    uris.set(path, uri);
    return uri;
  };
  const sections = docs.map((d) => {
    const dir = dirname(d.rel);
    const body = d.content.replace(/\r\n/g, '\n').replace(/^\n+|\s+$/g, '');
    return `# ${stripMd(d.rel)}\n\n${inlineSync(body, (src) => (isExternalSrc(src) ? null : dataUri(joinPath(dir, safeDecode(src.replace(/[?#].*$/, ''))))))}`;
  });
  return sections.join('\n\n---\n\n') + '\n';
}

// replaceImages 의 동기 버전(치환 규칙 동일). 비동기 호출을 쓰지 않아도 되도록 분리했다
function inlineSync(md: string, fn: (src: string) => string | null): string {
  return md.replace(IMAGE_RE, (all, alt: string, raw: string, title: string) => {
    const src = raw.startsWith('<') ? raw.slice(1, -1) : raw;
    const next = fn(src);
    return next === null ? all : `![${alt}](${next}${title})`;
  });
}

export async function exportFolderLinked(host: BundleHost, folderPath: string, order: string[]): Promise<{ text: string; count: number }> {
  const data = await collectFolder(host, folderPath);
  return { text: data.docs.length ? linkDocs(data, order) : '', count: data.docs.length };
}

// ---- 가져오기: 백업 JSON → 기존 번들(zip) 바이트 ----
/** 바이트가 폴더 백업 JSON 이면 파싱해 돌려주고, 아니면 null */
export function parseFolderJson(bytes: Uint8Array): FolderJson | null {
  if (bytes.length < 2 || bytes[0] === 0x50) return null; // zip 은 건너뛴다
  let j: unknown;
  try { j = JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
  if (!j || typeof j !== 'object' || (j as { schema?: unknown }).schema !== FOLDER_SCHEMA) return null;
  const o = j as Partial<FolderJson>;
  if (typeof o.version === 'number' && o.version > FOLDER_VERSION) throw new BundleError(`더 새로운 버전(v${o.version})의 폴더 백업입니다. 앱을 업데이트하세요`);
  if (!Array.isArray(o.docs)) throw new BundleError('폴더 백업 JSON 형식이 올바르지 않습니다 (docs)');
  return o as FolderJson;
}

/**
 * 폴더 백업 JSON → 번들 zip. 글 이름 앞에 JSON 의 folder(없으면 fallbackName)를 붙여 원래 폴더 아래로 복원한다.
 * 이후는 기존 previewBundle/applyBundle 이 처리한다.
 */
export function folderJsonToBundle(json: FolderJson, fallbackName: string, now = Date.now()): Uint8Array {
  const folder = trimDir(typeof json.folder === 'string' ? json.folder : '') || trimDir(fallbackName);
  const at = (rel: string) => (folder ? `${folder}/${rel}` : rel);
  const enc = new TextEncoder();
  const files: Zippable = {};
  const docMeta: Record<string, { updatedAt: number }> = {};
  for (const d of json.docs) {
    if (!d || typeof d.path !== 'string' || typeof d.content !== 'string') continue;
    const name = at(d.path);
    files[name] = enc.encode(d.content);
    if (typeof d.updatedAt === 'number' && Number.isFinite(d.updatedAt)) docMeta[name] = { updatedAt: d.updatedAt };
    for (const t of Array.isArray(d.threads) ? d.threads : []) {
      if (t && typeof t.id === 'string') files[`.works/threads/${encPart(name)}/${t.id}.json`] = enc.encode(JSON.stringify({ ...t, docKey: name }));
    }
  }
  for (const [p, b64] of Object.entries(json.assets && typeof json.assets === 'object' ? json.assets : {})) {
    if (typeof b64 === 'string') files[at(p)] = [base64ToBytes(b64), { level: 0 }];
  }
  files['.works/docs.json'] = enc.encode(JSON.stringify(docMeta));
  files['manifest.json'] = enc.encode(JSON.stringify({ schema: BUNDLE_SCHEMA, version: BUNDLE_VERSION, createdAt: now, mode: 'html', app: 'md-works' }));
  return zipSync(files);
}
