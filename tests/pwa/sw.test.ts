import { describe, it, expect } from 'vitest';
import { buildServiceWorker, pickPrecache, versionHash, isLazyFont, type OutFile } from '../../src/lib/pwa/build';
import { classifyInstall, shouldReload } from '../../src/lib/pwa/state';
import { MANIFEST } from '../../src/lib/pwa/plugin';

const files: OutFile[] = [
  { fileName: 'index.html', source: '<html></html>' },
  { fileName: 'assets/index-abc.js', source: 'console.log(1)' },
  { fileName: 'assets/index-abc.js.map', source: '{}' },
  { fileName: 'assets/KaTeX_Main-Regular-1.woff2', source: new Uint8Array([1, 2, 3]) },
  { fileName: 'assets/KaTeX_Main-Regular-1.woff', source: new Uint8Array([1, 2]) },
  { fileName: 'assets/KaTeX_Main-Regular-1.ttf', source: new Uint8Array([1]) },
  { fileName: 'sw.js', source: 'x' },
];

describe('프리캐시 선별', () => {
  it('woff2 만 남기고 ttf/woff·소스맵·sw.js 는 뺀다', () => {
    expect(pickPrecache(files).map((f) => f.fileName)).toEqual(['assets/KaTeX_Main-Regular-1.woff2', 'assets/index-abc.js', 'index.html']);
    expect(isLazyFont('a/b.TTF')).toBe(true);
    expect(isLazyFont('a/b.woff2')).toBe(false);
  });
  it('입력 순서와 무관하게 같은 목록', () => {
    expect(pickPrecache([...files].reverse())).toEqual(pickPrecache(files));
  });
});

describe('버전 해시', () => {
  it('같은 입력은 같고 순서와 무관하다', () => {
    expect(versionHash(files)).toBe(versionHash([...files].reverse()));
    expect(versionHash(files)).toMatch(/^[0-9a-f]{12}$/);
  });
  it('한 글자만 바뀌어도 달라진다', () => {
    const changed = files.map((f) => (f.fileName === 'assets/index-abc.js' ? { ...f, source: 'console.log(2)' } : f));
    expect(versionHash(changed)).not.toBe(versionHash(files));
  });
  it('파일 이름이 달라져도 달라진다', () => {
    const renamed = files.map((f) => (f.fileName === 'index.html' ? { ...f, fileName: 'main.html' } : f));
    expect(versionHash(renamed)).not.toBe(versionHash(files));
  });
  it('프리캐시 대상이 아닌 파일(소스맵)은 영향이 없다', () => {
    expect(versionHash([...files, { fileName: 'x.map', source: 'zzz' }])).toBe(versionHash(files));
  });
});

describe('sw.js 생성', () => {
  const sw = buildServiceWorker(['index.html', 'assets/a.js'], 'abc123');
  it('버전이 캐시 이름과 목록에 들어간다', () => {
    expect(sw).toContain('"md-works-abc123"');
    expect(sw).toContain('["index.html","assets/a.js"]');
  });
  it('문법이 올바르다', () => { expect(() => new Function(sw)).not.toThrow(); });
  it('install 에서 skipWaiting 을 부르지 않고 message 에서만 부른다', () => {
    const install = sw.slice(sw.indexOf("'install'"), sw.indexOf("'activate'"));
    expect(install).not.toContain('skipWaiting');
    expect(sw.match(/skipWaiting\(\)/g)).toHaveLength(1);
    expect(sw).toMatch(/SKIP_WAITING'\) self\.skipWaiting\(\)/);
  });
  it('같은 출처만 가로채고 activate 에서 claim 한다', () => {
    expect(sw).toContain('url.origin !== self.location.origin');
    expect(sw).toContain('clients.claim()');
  });
});

describe('갱신 알림 상태', () => {
  it('컨트롤러가 없으면 첫 설치, 있으면 갱신', () => {
    expect(classifyInstall(false)).toBe('first');
    expect(classifyInstall(true)).toBe('update');
  });
  it('사용자가 요청했을 때 한 번만 새로 고친다', () => {
    expect(shouldReload(false, false)).toBe(false);
    expect(shouldReload(true, false)).toBe(true);
    expect(shouldReload(true, true)).toBe(false);
  });
});

describe('매니페스트', () => {
  it('상대 경로와 크림 색', () => {
    expect(MANIFEST.start_url).toBe('./');
    expect(MANIFEST.scope).toBe('./');
    expect(MANIFEST.theme_color).toBe('#faf9f5');
    expect(MANIFEST.icons.map((i) => i.purpose)).toEqual(['any', 'maskable']);
  });
});
