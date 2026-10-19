// backupState: 모의 번들 API·모의 fetch 로 '키 없음 → 암호화·텔레그램 거부', 변경 감지 연결, 폴더 백업 요청을 확인한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/bundle/api', () => ({
  buildBundle: vi.fn(async () => ({ bytes: new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), summary: { docs: 1, images: 0, versions: 0, snippets: 0, threads: 0, bytes: 6 } })),
  previewBundle: vi.fn(),
  applyBundle: vi.fn(),
}));

import { buildBundle } from '../../src/lib/bundle/api';
import { backup, markChanged, uploadToTelegram, exportToFile, backupToFolder, makeBundle, hasUnbacked } from '../../src/lib/bundle/backupState.svelte';
import { useWorksStore, worksStore } from '../../src/lib/works/store';
import type { WorksStore } from '../../src/lib/works/store';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv('VITE_BUNDLE_KEY', ''); // 개발자의 .env 에 키가 있어도 '키 없는 빌드'로 시험한다
  backup.lastChange = 0; backup.lastExport = 0; backup.lastTelegram = 0; backup.lastFolder = 0;
});

describe('backupState (키 없는 빌드)', () => {
  it('텔레그램 올리기는 거부하고 fetch 도 부르지 않는다(평문 업로드 금지)', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    backup.telegram.token = '1:abc'; backup.telegram.chatId = '1';
    await expect(uploadToTelegram()).rejects.toThrow(/키가 없어/);
    expect(f).not.toHaveBeenCalled();
    expect(backup.lastTelegram).toBe(0);
  });

  it('암호화 내보내기는 거부하고 평문 zip 번들은 만들 수 있다', async () => {
    await expect(exportToFile(true)).rejects.toThrow(/키가 없어/);
    await expect(makeBundle(true)).rejects.toMatchObject({ code: 'no-key' });
    const r = await makeBundle(false);
    expect(r.ext).toBe('zip');
    expect(buildBundle).toHaveBeenCalled();
  });

  it('폴더 백업: 번들을 POST /api/backup 으로 올리고 성공 시각을 기록한다', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ name: 'md-works-20260101-000000.zip' }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    markChanged();
    expect(hasUnbacked()).toBe(true);
    const name = await backupToFolder();
    expect(name).toBe('md-works-20260101-000000.zip');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/backup');
    expect(init.method).toBe('POST');
    expect(backup.lastFolder).toBeGreaterThan(0);
    expect(hasUnbacked()).toBe(false);
  });

  it('worksStore 쓰기가 마지막 변경 시각을 갱신한다', async () => {
    const noop = async () => {};
    useWorksStore({ list: async () => [], get: async () => undefined, parts: async () => [], put: noop, putMany: noop, remove: noop, removePart: noop, movePart: noop } as unknown as WorksStore);
    expect(backup.lastChange).toBe(0);
    await worksStore().put('snippets', { id: 'a' } as never);
    expect(backup.lastChange).toBeGreaterThan(0);
  });
});
