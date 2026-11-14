// backupState: 텔레그램 이어 올리기 흐름(보관·재개·폐기)과 서버 폴더 백업 크기 상한.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 조각 한도를 줄여 작은 번들로 분할 업로드를 시험한다(telegram.ts 가 이 상수를 읽는다)
vi.mock('../../src/lib/bundle/backupLogic', async (orig) => ({ ...(await orig<typeof import('../../src/lib/bundle/backupLogic')>()), CHUNK_LIMIT: 1000 }));
vi.mock('../../src/lib/bundle/api', () => ({
  buildBundle: vi.fn(async () => ({ bytes: new Uint8Array([0x50, 0x4b, 3, 4, ...new Array(2500).fill(7)]), summary: { docs: 2, images: 0, versions: 0, snippets: 0, threads: 0, bytes: 2504 } })),
  prepareBundle: vi.fn(async () => {}),
  previewBundle: vi.fn(),
  applyBundle: vi.fn(),
}));

import { buildBundle } from '../../src/lib/bundle/api';
import { FOLDER_BACKUP_LIMIT } from '../../src/lib/bundle/backupLogic';
import {
  backup, backupUi, backupToFolder, canResumeTelegram, markChanged, resumeMissesChange, resumeTelegramUpload, uploadToTelegram,
} from '../../src/lib/bundle/backupState.svelte';

const ok = () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
const fail = (status: number) => new Response(JSON.stringify({ ok: false, description: `e${status}` }), { status });
const nameOf = (call: unknown[]) => (((call[1] as RequestInit).body as FormData).get('document') as File).name;
const captionOf = (call: unknown[]) => ((call[1] as RequestInit).body as FormData).get('caption') as string;

beforeEach(() => {
  vi.stubEnv('VITE_BUNDLE_KEY', 'test-key');
  vi.mocked(buildBundle).mockClear();
  backupUi.tgResume = null;
  backup.lastChange = 0; backup.lastTelegram = 0; backup.lastFolder = 0;
  backup.failTelegramAt = 0; backup.failTelegramMsg = ''; backup.failFolderAt = 0; backup.failFolderMsg = '';
  backup.telegram.token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'; backup.telegram.chatId = '1'; backup.telegram.auto = false;
});

/** n 번째(.00n) 조각은 실패시키는 fetch */
const failingAt = (n: number, status = 403) => vi.fn(async (...a: unknown[]) => (nameOf([a[0], a[1]]).endsWith(`.00${n}`) ? fail(status) : ok()));

describe('텔레그램 이어 올리기 (상태)', () => {
  it('중간 조각 실패 → 바이트·진행을 보관하고, 이어 올리기는 번들을 다시 만들지 않고 남은 조각만 올린다', async () => {
    const f1 = failingAt(3);
    vi.stubGlobal('fetch', f1);
    await expect(uploadToTelegram()).rejects.toThrow(/조각 3\/3/);
    expect(canResumeTelegram()).toBe(true);
    expect(backupUi.tgResume).toMatchObject({ done: 2, total: 3 });
    expect(backup.failTelegramAt).toBeGreaterThan(0);
    expect(backup.lastTelegram).toBe(0);
    const firstSha = captionOf(f1.mock.calls[0] as unknown[]).split('SHA-256 ')[1];

    const f2 = vi.fn(async () => ok());
    vi.stubGlobal('fetch', f2);
    await resumeTelegramUpload();
    expect(buildBundle).toHaveBeenCalledTimes(1); // 다시 만들지(= 다시 암호화하지) 않았다
    expect(f2.mock.calls.map((c) => nameOf(c as unknown[]))).toEqual([expect.stringMatching(/\.mwb\.003$/)]);
    expect(captionOf(f2.mock.calls[0] as unknown[])).toMatch(/^md-works 백업 · 글 2개 · 3\/3 · 전체 /);
    expect(captionOf(f2.mock.calls[0] as unknown[])).toContain(`SHA-256 ${firstSha}`); // 같은 번들
    expect(canResumeTelegram()).toBe(false);
    expect(backupUi.tgResume).toBeNull();
    expect(backup.lastTelegram).toBeGreaterThan(0);
    expect(backup.failTelegramAt).toBe(0);
  });

  it('보관분이 없으면 이어 올리기는 거부한다(요청 0건)', async () => {
    const f = vi.fn(async () => ok());
    vi.stubGlobal('fetch', f);
    await expect(resumeTelegramUpload()).rejects.toThrow(/이어 올릴 번들이 없습니다/);
    expect(f).not.toHaveBeenCalled();
  });

  it('새 백업을 시작하면 보관분을 버린다', async () => {
    vi.stubGlobal('fetch', failingAt(2));
    await expect(uploadToTelegram()).rejects.toThrow();
    expect(canResumeTelegram()).toBe(true);
    const f = vi.fn(async () => ok());
    vi.stubGlobal('fetch', f);
    await uploadToTelegram(); // 처음부터 새 번들
    expect(buildBundle).toHaveBeenCalledTimes(2);
    expect(f).toHaveBeenCalledTimes(3);
    expect(canResumeTelegram()).toBe(false);
  });

  it('새 백업이 첫 조각에서 실패하면 이전 보관분은 이미 버려진 상태다', async () => {
    vi.stubGlobal('fetch', failingAt(2));
    await expect(uploadToTelegram()).rejects.toThrow();
    vi.stubGlobal('fetch', failingAt(1));
    await expect(uploadToTelegram()).rejects.toThrow(/첫 조각부터/);
    expect(canResumeTelegram()).toBe(false);
  });

  it('이어 올리다 다시 실패해도 보관분은 유지되고 진행이 갱신된다', async () => {
    vi.stubGlobal('fetch', failingAt(2));
    await expect(uploadToTelegram()).rejects.toThrow();
    expect(backupUi.tgResume?.done).toBe(1);
    vi.stubGlobal('fetch', failingAt(3));
    await expect(resumeTelegramUpload()).rejects.toThrow(/조각 3\/3/);
    expect(backupUi.tgResume?.done).toBe(2);
    expect(canResumeTelegram()).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => ok()));
    await resumeTelegramUpload();
    expect(canResumeTelegram()).toBe(false);
  });

  it('첫 조각부터 실패하면(토큰 오류 등) 보관하지 않는다', async () => {
    vi.stubGlobal('fetch', failingAt(1, 401));
    await expect(uploadToTelegram()).rejects.toThrow();
    expect(canResumeTelegram()).toBe(false);
  });

  it('실패 뒤 글이 바뀌면 안내 조건이 켜진다', async () => {
    vi.stubGlobal('fetch', failingAt(3));
    await expect(uploadToTelegram()).rejects.toThrow();
    expect(resumeMissesChange()).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    markChanged();
    expect(resumeMissesChange()).toBe(true);
  });
});

describe('서버 폴더 백업 크기 상한', () => {
  it('상한(200MB)을 넘으면 올리지 않고 실패로 기록한다', async () => {
    vi.stubEnv('VITE_BUNDLE_KEY', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    vi.mocked(buildBundle).mockImplementationOnce(async () => ({
      bytes: new Uint8Array(FOLDER_BACKUP_LIMIT + 1),
      summary: { docs: 1, images: 0, versions: 0, snippets: 0, threads: 0, bytes: FOLDER_BACKUP_LIMIT + 1 },
    }));
    await expect(backupToFolder()).rejects.toThrow(/200MB 를 넘어 폴더 백업을 할 수 없습니다/);
    expect(f).not.toHaveBeenCalled();
    expect(backup.failFolderMsg).toMatch(/200MB/);
    expect(backup.lastFolder).toBe(0);
  });

  it('상한 이하는 그대로 올린다', async () => {
    vi.stubEnv('VITE_BUNDLE_KEY', '');
    const f = vi.fn(async () => new Response(JSON.stringify({ name: 'md-works-20260101-000000.zip' }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await backupToFolder();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('상수는 서버(server/api.js MAX_BACKUP)와 같다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('server/api.js', 'utf8');
    expect(/const MAX_BACKUP = (\d+) \* 1024 \* 1024;/.exec(src)?.[1]).toBe(String(FOLDER_BACKUP_LIMIT / 1024 / 1024));
  });
});
