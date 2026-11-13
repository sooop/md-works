import { describe, it, expect, vi } from 'vitest';
import { zipSync } from 'fflate';
import {
  needsBackup, isUploadDue, isBackupStale, clampInterval, formatAgo, classifyBytes, isBundleZip, splitBundleFiles, isBundleFile,
  DAY_MS, MIN_MS, SERVER_BACKUP_NAME_RE,
  recordSuccess, recordFailure, isFailing, isTelegramStale, isAnyStale, telegramStaleMs, parsePersisted, routeNotice, folderBackupKind, FAIL_MSG_MAX,
} from '../../src/lib/bundle/backupLogic';
import { encryptBundle } from '../../src/lib/bundle/crypto';
import { trackWrites } from '../../src/lib/works/track';
import type { WorksStore } from '../../src/lib/works/store';

const enc = (s: string) => new TextEncoder().encode(s);
const bundleZip = () => zipSync({ 'manifest.json': enc(JSON.stringify({ schema: 'md-works-bundle', version: 1 })), 'a.md': enc('# a') });
const docZip = () => zipSync({ 'a.md': enc('# a'), 'assets/a/1.png': new Uint8Array([1, 2]) });
const NOW = 10 * DAY_MS;

describe('백업 필요 판단', () => {
  it('마지막 변경이 마지막 백업보다 뒤일 때만', () => {
    expect(needsBackup(0, 0)).toBe(false);
    expect(needsBackup(5, 0)).toBe(true);
    expect(needsBackup(5, 5)).toBe(false);
    expect(needsBackup(5, 9)).toBe(false);
  });
  it('간격 보정', () => {
    expect(clampInterval(2, 5, 30)).toBe(5);
    expect(clampInterval(45.7, 5, 30)).toBe(45);
    expect(clampInterval(NaN, 5, 30)).toBe(30);
  });
});

describe('자동 올리기 스케줄', () => {
  const base = { now: NOW, lastChange: NOW - 1000, lastSuccess: NOW - 40 * MIN_MS, lastAttempt: 0, intervalMin: 30 };
  it('변경이 있고 간격이 지났으면 올린다', () => expect(isUploadDue(base)).toBe(true));
  it('변경이 없으면(마지막 업로드 이후) 올리지 않는다', () => {
    expect(isUploadDue({ ...base, lastChange: NOW - 50 * MIN_MS })).toBe(false);
    expect(isUploadDue({ ...base, lastChange: 0 })).toBe(false);
  });
  it('간격이 안 지났으면 기다린다', () => expect(isUploadDue({ ...base, lastSuccess: NOW - 10 * MIN_MS })).toBe(false));
  it('실패 직후에는 간격만큼 기다린다(매 틱 재시도 금지)', () => {
    expect(isUploadDue({ ...base, lastAttempt: NOW - MIN_MS })).toBe(false);
    expect(isUploadDue({ ...base, lastAttempt: NOW - 31 * MIN_MS })).toBe(true);
  });
  it('한 번도 올린 적 없고 변경이 있으면 바로 대상', () => {
    expect(isUploadDue({ ...base, lastSuccess: 0 })).toBe(true);
  });
});

describe('백업 알림', () => {
  const b = { now: NOW, lastChange: NOW - DAY_MS, lastBackup: NOW - 8 * DAY_MS, days: 7, since: 0 };
  it('N일 넘고 그 뒤 변경이 있으면 알린다', () => expect(isBackupStale(b)).toBe(true));
  it('N일 안이면 알리지 않는다', () => expect(isBackupStale({ ...b, lastBackup: NOW - 6 * DAY_MS, lastChange: NOW - DAY_MS })).toBe(false));
  it('백업 뒤 변경이 없으면 알리지 않는다', () => expect(isBackupStale({ ...b, lastChange: NOW - 9 * DAY_MS })).toBe(false));
  it('끔(0)이면 알리지 않는다', () => expect(isBackupStale({ ...b, days: 0 })).toBe(false));
  it('백업 기록이 없으면 since 를 기준으로 한다', () => {
    expect(isBackupStale({ ...b, lastBackup: 0, since: NOW - 8 * DAY_MS })).toBe(true);
    expect(isBackupStale({ ...b, lastBackup: 0, since: NOW - 2 * DAY_MS })).toBe(false);
  });
  it('3/14일 설정', () => {
    expect(isBackupStale({ ...b, lastBackup: NOW - 4 * DAY_MS, days: 3 })).toBe(true);
    expect(isBackupStale({ ...b, days: 14 })).toBe(false);
  });
  it('경과 표시', () => {
    expect(formatAgo(0, NOW)).toBe('없음');
    expect(formatAgo(NOW - 10_000, NOW)).toBe('방금 전');
    expect(formatAgo(NOW - 5 * MIN_MS, NOW)).toBe('5분 전');
    expect(formatAgo(NOW - 3 * 60 * MIN_MS, NOW)).toBe('3시간 전');
    expect(formatAgo(NOW - 2 * DAY_MS, NOW)).toBe('2일 전');
  });
});

describe('번들 / 문서 zip 판별', () => {
  it('manifest.schema 로 번들 zip 과 일반 문서 zip 을 구분한다', () => {
    expect(isBundleZip(bundleZip())).toBe(true);
    expect(isBundleZip(docZip())).toBe(false);
    expect(isBundleZip(zipSync({ 'manifest.json': enc('{"schema":"other"}') }))).toBe(false);
    expect(isBundleZip(zipSync({ 'manifest.json': enc('not json') }))).toBe(false);
    expect(isBundleZip(enc('plain text'))).toBe(false);
  });
  it('classifyBytes', async () => {
    const mwb = await encryptBundle(bundleZip(), 'k');
    expect(classifyBytes('x.mwb', mwb)).toBe('bundle-encrypted');
    expect(classifyBytes('이름바뀜.bin', mwb)).toBe('bundle-encrypted');
    expect(classifyBytes('a.zip', bundleZip())).toBe('bundle-zip');
    expect(classifyBytes('a.zip', docZip())).toBe('doc-zip');
    expect(classifyBytes('a.md', enc('# hi'))).toBe('other');
  });
  it('드롭 분리: 번들은 백업 흐름, 나머지는 문서 가져오기', async () => {
    const mwb = await encryptBundle(bundleZip(), 'k');
    const files = [
      new File([mwb as BlobPart], 'b.mwb'),
      new File([bundleZip() as BlobPart], 'bundle.zip', { type: 'application/zip' }),
      new File([docZip() as BlobPart], 'docs.zip', { type: 'application/zip' }),
      new File(['# hi'], 'a.md'),
    ];
    const { bundles, rest } = await splitBundleFiles(files);
    expect(bundles.map((f) => f.name)).toEqual(['b.mwb', 'bundle.zip']);
    expect(rest.map((f) => f.name)).toEqual(['docs.zip', 'a.md']);
    expect(await isBundleFile(files[3])).toBe(false);
  });
  it('서버 백업 파일명 규칙', () => {
    expect(SERVER_BACKUP_NAME_RE.test('md-works-20260101-093005.mwb')).toBe(true);
    expect(SERVER_BACKUP_NAME_RE.test('md-works-20260101-093005-2.zip')).toBe(true);
    expect(SERVER_BACKUP_NAME_RE.test('../md-works-20260101-093005.mwb')).toBe(false);
    expect(SERVER_BACKUP_NAME_RE.test('md-works-20260101-0930.mwb')).toBe(false);
  });
});

describe('쓰기 감지 래퍼(trackWrites)', () => {
  function fake() {
    const calls: string[] = [];
    const fn = (n: string) => async () => { calls.push(n); };
    const store = {
      list: async () => [], get: async () => undefined, parts: async () => ['p'],
      put: fn('put'), putMany: fn('putMany'), remove: fn('remove'), removePart: fn('removePart'), movePart: fn('movePart'),
    } as unknown as WorksStore;
    return { store, calls };
  }
  it('쓰기 뒤에만 알리고 읽기는 알리지 않는다', async () => {
    const { store, calls } = fake();
    const on = vi.fn();
    const w = trackWrites(store, on);
    await w.list('snippets');
    await w.get('snippets', 'x');
    await w.parts('versions');
    expect(on).not.toHaveBeenCalled();
    await w.put('snippets', { id: 'a' } as never);
    await w.putMany('snippets', []);
    await w.remove('snippets', 'a');
    await w.removePart('versions', 'p');
    await w.movePart('versions', 'a', 'b');
    expect(on).toHaveBeenCalledTimes(5);
    expect(calls).toEqual(['put', 'putMany', 'remove', 'removePart', 'movePart']);
  });
  it('쓰기가 실패하면 알리지 않고, 알림이 던져도 쓰기는 성공한다', async () => {
    const { store } = fake();
    (store as { put: unknown }).put = async () => { throw new Error('fail'); };
    const on = vi.fn();
    await expect(trackWrites(store, on).put('snippets', {} as never)).rejects.toThrow('fail');
    expect(on).not.toHaveBeenCalled();
    const { store: s2 } = fake();
    await expect(trackWrites(s2, () => { throw new Error('x'); }).put('snippets', {} as never)).resolves.toBeUndefined();
  });
});

describe('경로별 성공/실패 기록', () => {
  const none = { lastSuccess: 0, failAt: 0, failMsg: '' };
  it('실패는 마지막 성공을 건드리지 않고, 성공하면 실패 기록이 지워진다', () => {
    const ok = recordSuccess(none, 100);
    const bad = recordFailure(ok, 200, '네트워크 오류');
    expect(bad).toEqual({ lastSuccess: 100, failAt: 200, failMsg: '네트워크 오류' });
    expect(isFailing(bad)).toBe(true);
    const back = recordSuccess(bad, 300);
    expect(back).toEqual({ lastSuccess: 300, failAt: 0, failMsg: '' });
    expect(isFailing(back)).toBe(false);
  });
  it('성공 시각은 뒤로 가지 않고, 긴 이유는 잘린다', () => {
    expect(recordSuccess({ ...none, lastSuccess: 500 }, 100).lastSuccess).toBe(500);
    expect(recordFailure(none, 1, 'x'.repeat(1000)).failMsg.length).toBe(FAIL_MSG_MAX + 1);
  });
  it('성공 기록이 없어도 실패하면 실패 중이다', () => expect(isFailing(recordFailure(none, 5, 'e'))).toBe(true));
});

describe('텔레그램 오래됨 판정', () => {
  const base = { enabled: true, now: NOW, lastChange: NOW - MIN_MS, lastSuccess: NOW - 4 * DAY_MS, failAt: NOW - MIN_MS, intervalMin: 30, since: NOW - 9 * DAY_MS };
  it('기준은 간격의 3배와 24시간 중 큰 값', () => {
    expect(telegramStaleMs(30)).toBe(DAY_MS);
    expect(telegramStaleMs(24 * 60)).toBe(3 * DAY_MS);
  });
  it('마지막 성공이 기준을 넘고 올릴 변경이 있으면 오래됨', () => expect(isTelegramStale(base)).toBe(true));
  it('기준 안이면 아니다', () => expect(isTelegramStale({ ...base, lastSuccess: NOW - 20 * 60 * MIN_MS })).toBe(false));
  it('자동 올리기가 꺼져 있으면 아니다', () => expect(isTelegramStale({ ...base, enabled: false })).toBe(false));
  it('올릴 변경이 없으면(성공 이후 변경 없음) 아니다', () => expect(isTelegramStale({ ...base, lastChange: NOW - 5 * DAY_MS })).toBe(false));
  it('성공 기록이 없고 실패한 적도 없으면 아니다(막 켠 직후), 실패한 적이 있으면 since 기준', () => {
    expect(isTelegramStale({ ...base, lastSuccess: 0, failAt: 0 })).toBe(false);
    expect(isTelegramStale({ ...base, lastSuccess: 0 })).toBe(true);
    expect(isTelegramStale({ ...base, lastSuccess: 0, since: NOW - 2 * MIN_MS })).toBe(false);
  });
  it('isAnyStale: 텔레그램만 오래돼도 배지, 알림 끔이면 둘 다 아니다', () => {
    const n = { now: NOW, lastChange: NOW - MIN_MS, lastBackup: NOW - MIN_MS, days: 7, since: 0 }; // 다른 경로로 방금 백업함
    expect(isAnyStale(n, base)).toBe(true);
    expect(isAnyStale(n, { ...base, enabled: false })).toBe(false);
    expect(isAnyStale({ ...n, days: 0 }, base)).toBe(false);
  });
});

describe('저장값 읽기(옛 localStorage 호환)', () => {
  const o = { now: 1234, folderDefaultMin: 15, minAutoMin: 5 };
  it('옛 형식(실패 기록 없음)을 그대로 읽고 새 필드는 기본값', () => {
    const old = JSON.stringify({ lastChange: 5, lastExport: 1, lastTelegram: 2, lastFolder: 3, since: 9, notifyDays: 3, folderAuto: false, folderIntervalMin: 40 });
    expect(parsePersisted(old, o)).toEqual({
      lastChange: 5, lastExport: 1, lastTelegram: 2, lastFolder: 3, since: 9, notifyDays: 3, folderAuto: false, folderIntervalMin: 40,
      failExportAt: 0, failExportMsg: '', failTelegramAt: 0, failTelegramMsg: '', failFolderAt: 0, failFolderMsg: '',
    });
  });
  it('없거나 깨진 값은 기본값', () => {
    for (const raw of [null, undefined, '', '{', 'null', '[1]', '"x"']) {
      const p = parsePersisted(raw as string | null, o);
      expect(p.since).toBe(1234);
      expect(p.lastTelegram).toBe(0);
      expect(p.folderAuto).toBe(true);
      expect(p.notifyDays).toBe(7);
    }
  });
  it('타입이 틀린 필드는 기본값, 간격은 최소값 보정, 새 필드는 읽는다', () => {
    const p = parsePersisted(JSON.stringify({ lastTelegram: 'x', folderIntervalMin: 1, failTelegramAt: 77, failTelegramMsg: '실패', failFolderMsg: 3 }), o);
    expect(p.lastTelegram).toBe(0);
    expect(p.folderIntervalMin).toBe(5);
    expect(p.failTelegramAt).toBe(77);
    expect(p.failTelegramMsg).toBe('실패');
    expect(p.failFolderMsg).toBe('');
  });
});

describe('결과 안내 경로', () => {
  it('창이 열려 있으면 안내 영역, 닫혀 있으면 실패만 토스트(성공은 조용히)', () => {
    expect(routeNotice(true, 'success')).toBe('notice');
    expect(routeNotice(true, 'error')).toBe('notice');
    expect(routeNotice(false, 'error')).toBe('toast');
    expect(routeNotice(false, 'success')).toBe('none');
  });
  it('폴더 백업 형식 라벨', () => {
    expect(folderBackupKind('md-works-20260101-000000.mwb')).toBe('mwb');
    expect(folderBackupKind('md-works-20260101-000000-2.zip')).toBe('zip');
  });
});
