// 스탠드얼론 전체 백업/복원용 zip 변환. IndexedDB 는 건드리지 않는 순수 변환 계층이다.
// 구조는 서버 모드의 노트 폴더와 같다: `이름.md` + `assets/<문서명>/<번호>.<확장자>`.
// 그래서 풀어서 서버 모드의 노트 폴더에 그대로 쓸 수 있고, 서버 모드 폴더를 zip 으로 묶어 가져올 수도 있다.
// 코멘트도 서버 모드와 같이 `.comments/<문서 경로>.json` 사이드카로 담는다.
import { zipSync, unzipSync, type Zippable } from 'fflate';
import { sanitize, type Comment } from './comments/anchor';
import { basename, dirname, imageExt, isExternalSrc, joinPath, replaceImages, safeDecode, stripExt } from './utils';

const MAX_TOTAL_BYTES = 1024 * 1024 * 1024; // 압축 해제 후 합계 상한 (zip 폭탄 방어)
const DOC_RE = /\.(md|markdown|txt)$/i;
const IMG_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
};
const imgMime = (path: string) => IMG_MIME[/\.([a-z0-9]+)$/i.exec(path)?.[1].toLowerCase() ?? ''];

// 마크다운 링크 문법을 깨는 문자만 퍼센트 인코딩한다 (한글·공백은 그대로 둔다)
const encSeg = (s: string) => s.replace(/[()%#?]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export interface ArchiveDoc { name: string; content: string; comments?: Comment[] }
const COMMENTS_DIR = '.comments/';

export interface RelinkedText { text: string; assets: { path: string; data: Uint8Array }[] }

// 본문의 `idb:` 이미지를 `assets/<문서명>/<파일>` 상대 링크로 바꾸고, 그 이미지 데이터를 함께 돌려준다 (zip 내부 경로 기준).
// stable 이면 파일 이름을 본문 순번 대신 이미지 id 로 붙인다 — 같은 문서의 여러 본문(이력 버전 등)이 같은 폴더를 공유해도 충돌하지 않는다.
export async function relinkImages(
  stem: string,
  content: string,
  loadImage: (id: string) => Promise<Blob | null>,
  stable = false,
): Promise<RelinkedText> {
  const assets: RelinkedText['assets'] = [];
  const seen = new Map<string, Promise<string | null>>(); // replaceImages 는 참조를 동시에 처리하므로 Promise 로 캐시한다
  let n = 0;
  const { text } = await replaceImages(content, (src) => {
    const id = /^idb:([0-9a-f-]{36})$/.exec(src)?.[1];
    if (!id) return Promise.resolve(null);
    let link = seen.get(id);
    if (!link) {
      const file = stable ? `${id}.` : `${++n}.`;
      link = loadImage(id).then(async (blob) => {
        if (!blob) return null;
        const name = file + imageExt(blob);
        assets.push({ path: `assets/${stem}/${name}`, data: new Uint8Array(await blob.arrayBuffer()) });
        return `assets/${encSeg(stem)}/${name}`;
      });
      seen.set(id, link);
    }
    return link;
  });
  return { text, assets };
}

// 문서와 `idb:` 이미지를 zip 으로 묶는다. 이미지는 문서별 assets 폴더로 복사하고 링크를 상대 경로로 바꾼다.
export async function buildArchive(
  docs: ArchiveDoc[],
  loadImage: (id: string) => Promise<Blob | null>,
): Promise<Blob> {
  const files: Zippable = {};
  const enc = new TextEncoder();
  for (const d of docs) {
    const { text, assets } = await relinkImages(stripExt(d.name), d.content, loadImage);
    for (const a of assets) files[a.path] = [a.data, { level: 0 }];
    files[d.name] = enc.encode(text);
    if (d.comments?.length) files[`${COMMENTS_DIR}${d.name}.json`] = enc.encode(JSON.stringify({ version: 1, comments: d.comments }, null, 2));
  }
  return new Blob([zipSync(files)], { type: 'application/zip' });
}

export interface ParsedDoc {
  /** 확장자 없는 문서 이름. 하위 폴더 문서는 '폴더 - 이름' 으로 펼친다 */
  stem: string;
  content: string;
  comments: Comment[];
  /** 본문이 참조하는 이미지를 zip 내부 경로 → 데이터로 조회 */
  image: (src: string) => { key: string; data: Uint8Array; mime: string } | null;
}

function readComments(data: Uint8Array | undefined): Comment[] {
  if (!data) return [];
  try { return sanitize(JSON.parse(new TextDecoder().decode(data))); } catch { return []; }
}

// zip 에서 문서(.md/.markdown/.txt)를 읽는다. 숨김 폴더(.git, __MACOSX 등)와 그 밖의 파일은 무시한다.
export function parseArchive(zip: Uint8Array): ParsedDoc[] {
  let total = 0;
  const entries = unzipSync(zip, {
    filter: (f) => {
      if (f.name.endsWith('/')) return false;
      const sidecar = f.name.startsWith(COMMENTS_DIR) && f.name.endsWith('.json');
      if (!sidecar && f.name.split('/').some((s) => s.startsWith('.') || s === '__MACOSX')) return false;
      if (!sidecar && !DOC_RE.test(f.name) && !imgMime(f.name)) return false;
      total += f.originalSize;
      if (total > MAX_TOTAL_BYTES) throw new Error('압축을 풀면 1GB 를 넘어 가져올 수 없습니다');
      return true;
    },
  });
  const dec = new TextDecoder();
  return Object.keys(entries)
    .filter((p) => DOC_RE.test(p))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((path) => {
      const dir = dirname(path);
      const stem = [...dir.split('/').filter(Boolean), stripExt(basename(path))].join(' - ');
      return {
        stem,
        content: dec.decode(entries[path]),
        comments: readComments(entries[`${COMMENTS_DIR}${path}.json`]),
        image(src) {
          if (isExternalSrc(src)) return null;
          const key = joinPath(dir, safeDecode(src.replace(/[?#].*$/, '')));
          const data = entries[key];
          const mime = imgMime(key);
          return data && mime ? { key, data, mime } : null;
        },
      };
    });
}
