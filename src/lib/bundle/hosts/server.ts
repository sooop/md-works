// 서버 호스트: 서버 API 로 글·에셋을 읽고 쓴다. 이력·글감·스레드는 worksStore(사이드카)가 맡는다.
// - 글 이름 = docKey = 루트 기준 경로. 이미지 링크는 이미 상대 경로라 본문을 바꾸지 않고, 에셋 파일만 옮긴다.
// - 새 라우트: GET /api/bundle/index, PUT /api/bundle/doc, PUT /api/bundle/asset (server/api.js)
import type { WorksStore } from '../../works/store';
import type { Design } from '../../design';
import { dirname, isExternalSrc, joinPath, safeDecode, IMAGE_RE } from '../../utils';
import type { BundleAsset, BundleHost, HostDocBody, HostDocInfo, ImportSession } from '../host';

export interface ServerHostOptions {
  store: () => WorksStore;
  /** 테스트에서 서버 주소를 지정할 때만 쓴다(브라우저에서는 같은 출처의 빈 문자열) */
  base?: string;
  prepare?: () => Promise<void>;
  /** 가져오기 뒤 파일 트리와 열린 글을 다시 읽는다(앱이 넘긴다) */
  afterApply?: () => Promise<void>;
  design?: { current(): string; apply(d: Design): void };
}

interface Index { docs: { path: string; mtime: number }[]; assets: string[] }

/** 본문이 참조하는 상대 경로 이미지의 서버 경로(글 기준으로 해석) */
export function linkedAssetPaths(docPath: string, content: string): string[] {
  const dir = dirname(docPath);
  const out = new Set<string>();
  for (const m of content.matchAll(IMAGE_RE)) {
    const raw = m[2].startsWith('<') ? m[2].slice(1, -1) : m[2];
    if (isExternalSrc(raw)) continue;
    out.add(joinPath(dir, safeDecode(raw.replace(/[?#].*$/, ''))));
  }
  return [...out];
}

export function createServerHost(opts: ServerHostOptions): BundleHost {
  const base = opts.base ?? '';
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(base + path, init);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as { error?: string }).error ?? `요청 실패 (${res.status})`);
    return j as T;
  }
  const q = encodeURIComponent;
  const index = () => call<Index>('/api/bundle/index');
  let assetSet = new Set<string>();

  return {
    mode: 'server',
    get store() { return opts.store(); },
    convertsImages: false,
    ...(opts.design ? { design: opts.design } : {}),

    async prepare() { await opts.prepare?.(); },
    normalizeName: (name) => name,
    async listDocs(): Promise<HostDocInfo[]> {
      const idx = await index();
      assetSet = new Set(idx.assets);
      return idx.docs.map((d) => ({ name: d.path, key: d.path, updatedAt: d.mtime }));
    },
    async readDoc(info): Promise<HostDocBody> {
      const { content } = await call<{ content: string }>(`/api/file?path=${q(info.name)}`);
      const assets: BundleAsset[] = [];
      for (const p of linkedAssetPaths(info.name, content)) {
        if (!assetSet.has(p)) continue; // 없는 이미지 링크는 건너뛴다
        const res = await fetch(`${base}/api/raw?path=${q(p)}`);
        if (res.ok) assets.push({ path: p, data: new Uint8Array(await res.arrayBuffer()) });
      }
      return { content, assets, raw: content };
    },
    async textToBundle(_stem, text) { return { text, assets: [] }; },
    beginImport(bundleAssets): ImportSession {
      const written = new Set<string>();
      const putAsset = async (p: string) => {
        const data = bundleAssets.get(p);
        if (!data || written.has(p)) return;
        written.add(p);
        await call(`/api/bundle/asset?path=${q(p)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: data as BodyInit });
      };
      return {
        async text(_src, text) { return text; },
        async putDoc(src, name, content, updatedAt) {
          // 글이 참조하는 에셋은 덮어쓴다(번들의 글 본문이 그 이미지를 전제한다)
          for (const p of linkedAssetPaths(src, content)) await putAsset(p);
          await call(`/api/bundle/doc?path=${q(name)}&mtime=${Math.max(1, Math.round(updatedAt))}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
          });
          return name;
        },
        async close() {
          // 글이 직접 참조하지 않는 에셋(이력 버전이 쓰는 이미지 등)은 서버에 없을 때만 채운다
          const have = new Set((await index()).assets);
          for (const p of bundleAssets.keys()) if (!have.has(p)) await putAsset(p);
        },
      };
    },
    afterApply: opts.afterApply,
  };
}
