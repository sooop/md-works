// 서버 호스트: 서버 API 로 글·에셋을 읽고 쓴다. 이력·글감·스레드는 worksStore(사이드카)가 맡는다.
// - 글 이름 = docKey = 루트 기준 경로. 이미지 링크는 이미 상대 경로라 본문을 바꾸지 않고, 에셋 파일만 옮긴다.
// - 새 라우트: GET /api/bundle/index, PUT /api/bundle/doc, PUT /api/bundle/asset (server/api.js)
import type { WorksStore } from '../../works/store';
import type { Design } from '../../design';
import { dirname, isExternalSrc, joinPath, safeDecode, IMAGE_RE } from '../../utils';
import { BundleError } from '../parse';
import { detachSnippetsFrom } from '../docRemoval';
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

// 서버(server/api.js·worksStore.js)의 규칙과 맞춘 사전 검증 값
// eslint-disable-next-line no-control-regex
const SERVER_BAD_CHARS = /[\u0000-\u001f\u007f*?"<>|]/;
const MAX_PART = 200; // worksStore MAX_PART
const MAX_DOC_JSON_BYTES = 19 * 1024 * 1024; // 서버 MAX_JSON(20MB) 아래 여유
const MAX_DOC_CHARS_UNCHECKED = 3_000_000; // 글자당 최대 6바이트(JSON 이스케이프)여도 19MB 를 넘지 못하는 길이
const MAX_MTIME = 1e13; // 파일 시각으로 쓸 수 있는 상한

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
  let lower = new Map<string, string>(); // 소문자 경로 → 서버에 있는 실제 경로

  return {
    mode: 'server',
    get store() { return opts.store(); },
    convertsImages: false,
    ...(opts.design ? { design: opts.design } : {}),

    foldsCase: true, // 윈도·맥 서버는 대소문자를 구분하지 않는다. 구분하는 서버에서도 대소문자만 다른 글은 충돌로 다룬다(무음 덮어쓰기 방지)
    async prepare() {
      await opts.prepare?.();
      lower = new Map((await index()).docs.map((d) => [d.path.toLowerCase(), d.path]));
    },
    // 번들 이름을 이 서버에 있는 글의 표기에 맞춘다(note.md ↔ Note.md 가 같은 글이어야 덮어쓰기 전에 이력이 남는다)
    normalizeName: (name) => lower.get(name.toLowerCase()) ?? name,
    validateImport({ docs, partitions, assets }) {
      const names = [...docs.map((d) => d.name), ...partitions, ...assets];
      for (const n of names) {
        if (SERVER_BAD_CHARS.test(n)) throw new BundleError(`서버가 받을 수 없는 문자(제어 문자 또는 * ? " < > |)가 이름에 있습니다: ${JSON.stringify(n.slice(0, 120))}`);
      }
      for (const n of [...docs.map((d) => d.name), ...partitions]) {
        if (n.length > MAX_PART) throw new BundleError(`글 경로가 ${MAX_PART}자를 넘어 서버가 이력을 저장할 수 없습니다: ${JSON.stringify(n.slice(0, 120))}…`);
      }
      for (const d of docs) {
        // 서버는 JSON 본문 20MB 까지만 받는다. 줄바꿈·따옴표 이스케이프로 부풀어도 안전하도록 여유를 둔다
        const big = d.content.length > MAX_DOC_CHARS_UNCHECKED && new TextEncoder().encode(JSON.stringify({ content: d.content })).length > MAX_DOC_JSON_BYTES;
        if (big) throw new BundleError(`글이 너무 커서 서버가 받을 수 없습니다(약 19MB 초과): ${d.name}`);
      }
    },
    async listDocs(): Promise<HostDocInfo[]> {
      const idx = await index();
      assetSet = new Set(idx.assets);
      return idx.docs.map((d) => ({ name: d.path, key: d.path, updatedAt: d.mtime }));
    },
    async deleteDoc(name) {
      // 서버의 DELETE 가 파일·에셋·코멘트·이력·스레드를 지운다. 글감 연결은 여기서 끊는다
      const have = (await index()).docs.some((d) => d.path === name);
      if (!have) return;
      await call(`/api/file?path=${q(name)}`, { method: 'DELETE' });
      await detachSnippetsFrom(opts.store(), name);
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
          await call(`/api/bundle/doc?path=${q(name)}&mtime=${Number.isFinite(updatedAt) ? Math.min(MAX_MTIME, Math.max(1, Math.round(updatedAt))) : Date.now()}`, {
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
