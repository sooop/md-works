// 정적 빌드의 서비스 워커(sw.js)를 만드는 순수 함수들. 브라우저 번들에는 들어가지 않고 vite.config 와 테스트만 쓴다.
import { createHash } from 'node:crypto';

export interface OutFile { fileName: string; source: string | Uint8Array }

/** 서비스 워커가 직접 캐시를 만들지 않는 산출물(자기 자신·소스맵) */
const SKIP = /(^|\/)sw\.js$|\.map$/;
/** 글꼴 중 woff2 는 프리캐시, 같은 글꼴의 ttf/woff 는 요청될 때만 캐시한다(대부분의 브라우저가 woff2 만 받는다) */
const LAZY_FONT = /\.(ttf|woff)$/i;

export function isLazyFont(fileName: string): boolean { return LAZY_FONT.test(fileName); }

/** 산출 파일 중 프리캐시할 것. 정렬해 두어 같은 입력이 항상 같은 목록이 되게 한다 */
export function pickPrecache(files: OutFile[]): OutFile[] {
  return files
    .filter((f) => !SKIP.test(f.fileName) && !isLazyFont(f.fileName))
    .sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
}

/** 파일 이름과 내용에서 계산한 버전 해시(12자). 한 글자라도 바뀌면 달라진다 */
export function versionHash(files: OutFile[]): string {
  const h = createHash('sha256');
  for (const f of pickPrecache(files)) {
    h.update(f.fileName).update('\0');
    h.update(typeof f.source === 'string' ? Buffer.from(f.source, 'utf8') : f.source).update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

/** sw.js 본문. 목록은 sw.js 위치(출력 루트) 기준 상대 경로 */
export function buildServiceWorker(precache: string[], version: string): string {
  return `// md-works 서비스 워커 (빌드 자동 생성, 버전 ${version})
'use strict';
const CACHE = ${JSON.stringify('md-works-' + version)};
const PRECACHE = ${JSON.stringify(precache)};
const LAZY_FONT = ${LAZY_FONT.toString()};
const scope = self.registration.scope;
const abs = (p) => new URL(p, scope).href;
const PRECACHED = new Set(PRECACHE.map(abs));

// 하나라도 못 받으면 install 이 실패해, 반쪽짜리 캐시가 활성화되지 않는다. 새 워커는 사용자가 허락할 때까지 대기한다
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((p) => new Request(abs(p), { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('md-works-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // unpkg(pandoc 엔진)·telegram 등 다른 출처는 건드리지 않는다
  if (req.mode === 'navigate') {
    event.respondWith(caches.match(abs('index.html')).then((hit) => hit || fetch(req)));
    return;
  }
  if (PRECACHED.has(url.origin + url.pathname)) {
    event.respondWith(caches.match(url.origin + url.pathname).then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.status === 200 && LAZY_FONT.test(url.pathname)) {
        const copy = res.clone();
        event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || Response.error())),
  );
});
`;
}
