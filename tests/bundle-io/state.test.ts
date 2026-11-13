// backupState: 모의 번들 API·모의 fetch 로 '키 없음 → 암호화·텔레그램 거부', 변경 감지 연결, 폴더 백업 요청을 확인한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/bundle/api', () => ({
  buildBundle: vi.fn(async () => ({ bytes: new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), summary: { docs: 1, images: 0, versions: 0, snippets: 0, threads: 0, bytes: 6 } })),
  prepareBundle: vi.fn(async () => {}),
  previewBundle: vi.fn(),
  applyBundle: vi.fn(),
}));

import { buildBundle, prepareBundle } from '../../src/lib/bundle/api';
import { backup, markChanged, uploadToTelegram, exportToFile, backupToFolder, makeBundle, hasUnbacked, isStale, telegramStale, pathStatus, backupUi } from '../../src/lib/bundle/backupState.svelte';
import { useWorksStore, worksStore } from '../../src/lib/works/store';
import type { WorksStore } from '../../src/lib/works/store';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv('VITE_BUNDLE_KEY', ''); // 개발자의 .env 에 키가 있어도 '키 없는 빌드'로 시험한다
  backup.lastChange = 0; backup.lastExport = 0; backup.lastTelegram = 0; backup.lastFolder = 0;
  backup.failTelegramAt = 0; backup.failTelegramMsg = ''; backup.failFolderAt = 0; backup.failFolderMsg = ''; backup.failExportAt = 0; backup.failExportMsg = '';
  backup.telegram.auto = false; backup.telegram.token = ''; backup.telegram.chatId = ''; backup.notifyDays = 7;
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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('번들 생성 중 변경', () => {
  const okFetch = () => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ name: 'md-works-20260101-000000.zip' }), { status: 200 })));

  it('준비(열린 글 저장) 단계의 쓰기는 변경이 아니라서 방금 만든 백업이 최신으로 남는다', async () => {
    okFetch();
    vi.mocked(prepareBundle).mockImplementationOnce(async () => { await wait(5); markChanged(); });
    await backupToFolder();
    expect(backup.lastChange).toBe(0);
    expect(hasUnbacked()).toBe(false);
  });

  it('번들을 읽는 동안 생긴 변경은 다음 백업 대상으로 남는다', async () => {
    okFetch();
    vi.mocked(buildBundle).mockImplementationOnce(async () => {
      await wait(5);
      markChanged(); // 사용자가 그 사이에 고쳤다
      return { bytes: new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), summary: { docs: 1, images: 0, versions: 0, snippets: 0, threads: 0, bytes: 6 } };
    });
    await backupToFolder();
    expect(backup.lastFolder).toBeGreaterThan(0);
    expect(backup.lastChange).toBeGreaterThan(backup.lastFolder);
    expect(hasUnbacked()).toBe(true);
  });
});

describe('경로별 성공/실패 기록(상태)', () => {
  it('폴더 백업 실패는 실패 시각·이유를 남기고 마지막 성공은 그대로, 다음 성공이 실패를 지운다', async () => {
    backup.lastFolder = 1000;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '디스크가 가득 찼습니다' }), { status: 500 })));
    await expect(backupToFolder()).rejects.toThrow(/디스크/);
    expect(pathStatus('folder')).toMatchObject({ lastSuccess: 1000, failMsg: '디스크가 가득 찼습니다' });
    expect(backup.failFolderAt).toBeGreaterThan(0);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ name: 'md-works-20260101-000000.zip' }), { status: 200 })));
    await backupToFolder();
    expect(pathStatus('folder')).toMatchObject({ failAt: 0, failMsg: '' });
    expect(pathStatus('folder').lastSuccess).toBeGreaterThan(1000);
  });

  it('텔레그램·폴더·내보내기 기록은 서로 영향을 주지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await expect(backupToFolder()).rejects.toThrow();
    expect(pathStatus('telegram').failAt).toBe(0);
    expect(pathStatus('export').failAt).toBe(0);
  });

  it('텔레그램 자동 올리기가 오래 성공하지 못하면 상단바 오래됨 판정에 반영된다', () => {
    vi.stubEnv('VITE_BUNDLE_KEY', 'test-key');
    backup.telegram.token = '1:abc'; backup.telegram.chatId = '1'; backup.telegram.auto = true; backup.telegram.intervalMin = 30;
    const now = Date.now();
    backup.now = now;
    backup.since = now - 30 * 86_400_000;
    backup.lastTelegram = now - 3 * 86_400_000; // 텔레그램은 3일째 실패
    backup.failTelegramAt = now - 60_000;
    backup.lastChange = now - 1000;
    backup.lastExport = now - 60_000; // 폴더·내보내기 쪽 성공이 합쳐져 '백업됨'으로 보이던 경우
    expect(telegramStale()).toBe(true);
    expect(isStale()).toBe(true);
    backup.notifyDays = 0; // 알림 끔
    expect(isStale()).toBe(false);
  });

  it('자동 올리기를 껐거나 올릴 변경이 없으면 텔레그램은 오래됨이 아니다', () => {
    vi.stubEnv('VITE_BUNDLE_KEY', 'test-key');
    backup.telegram.token = '1:abc'; backup.telegram.chatId = '1'; backup.telegram.auto = false;
    const now = Date.now();
    backup.now = now; backup.lastTelegram = now - 3 * 86_400_000; backup.failTelegramAt = now - 60_000; backup.lastChange = now - 1000;
    expect(telegramStale()).toBe(false);
    backup.telegram.auto = true; backup.lastChange = now - 4 * 86_400_000; // 성공 이후 변경 없음
    expect(telegramStale()).toBe(false);
  });

  it('앱 전체 드롭은 가져오기 탭을 연다', async () => {
    const { divertBundleDrop } = await import('../../src/lib/bundle/backupState.svelte');
    backupUi.tab = 'auto'; backupUi.open = false;
    const f = new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'x.mwb.001');
    await divertBundleDrop([f]);
    expect(backupUi.open).toBe(true);
    expect(backupUi.tab).toBe('transfer');
    backupUi.open = false; backupUi.pending = null;
  });
});
