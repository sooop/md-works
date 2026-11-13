// 백업 상태·설정·동작. 판단 로직은 backupLogic.ts(순수 함수), 암호화는 crypto.ts, 텔레그램은 telegram.ts 에 있다.
// 설정은 localStorage 'works.backup'(변경·백업 시각, 경로별 마지막 실패, 알림, 폴더 백업)과 'works.telegram'(토큰·chat_id·자동 올리기)에 나눠 저장한다.
// 토큰·chat_id 는 번들·내보내기에 절대 포함하지 않는다.
//
// 경로별 기록: 내보내기(lastExport)·텔레그램(lastTelegram)·폴더(lastFolder) 마지막 성공 시각과, 그 뒤로 실패 중이면 마지막 실패(fail*At·fail*Msg).
// 옛 키(lastExport·lastTelegram·lastFolder 등)는 그대로 쓰고 fail* 키만 새로 늘었다(없으면 0/빈 문자열로 읽는다).
import { toast, errMsg } from '../store.svelte';
import { downloadBlob } from '../utils';
import { onWorksWrite } from '../works/store';
import { buildBundle, prepareBundle, type BundleSummary } from './api';
import { encryptBundle, decryptBundle, hasBundleKey } from './crypto';
import { folderJsonToBundle, parseFolderJson } from '../folderExport';
import {
  SERVER_BACKUP_NAME_RE, classifyBytes, concatBytes, isPartName, planImport, splitBundleFiles, clampInterval, formatAgo, isBackupStale, isUploadDue, needsBackup, MIN_MS,
  parsePersisted, recordSuccess, recordFailure, isAnyStale, isTelegramStale, routeNotice,
  type BackupPersisted, type PathStatus, type NoticeKind, type TelegramStaleInput,
} from './backupLogic';
import {
  DEFAULT_AUTO_MINUTES, MIN_AUTO_MINUTES, bundleFileName, loadTelegram, saveTelegram, sendBundle, type TelegramSettings,
} from './telegram';

const KEY = 'works.backup';
const isServer = () => typeof __MODE__ !== 'undefined' && __MODE__ === 'server';

export const FOLDER_DEFAULT_MINUTES = 15;

function loadPersisted(): BackupPersisted {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* 저장소를 못 쓰는 환경 */ }
  return parsePersisted(raw, { now: Date.now(), folderDefaultMin: FOLDER_DEFAULT_MINUTES, minAutoMin: MIN_AUTO_MINUTES });
}

export const backup = $state<BackupPersisted & { telegram: TelegramSettings; now: number }>({
  ...loadPersisted(),
  telegram: loadTelegram(),
  now: Date.now(), // 점 배지·경과 시간이 시간이 지나면 갱신되도록 스케줄러가 틱마다 갱신한다
});

/** 백업 창의 탭: 내보내기·가져오기('transfer') / 자동 백업('auto') */
export type BackupTab = 'transfer' | 'auto';
export interface BackupNotice { kind: NoticeKind; text: string }

/**
 * 백업 창 UI 상태. 가져오기 흐름을 외부(앱 전체 드롭)에서 열기 위한 pending 도 여기 있다.
 * tab 은 이 모듈에 있어 창을 닫았다 열어도(세션 동안) 마지막 탭이 유지된다. notice 는 창 상단 고정 영역에 보일 결과 안내(오류·성공).
 */
export const backupUi = $state<{ open: boolean; pending: File[] | null; busy: string; tgProgress: string; tab: BackupTab; notice: BackupNotice | null }>({
  open: false, pending: null, busy: '', tgProgress: '', tab: 'transfer', notice: null,
});

export const showNotice = (kind: NoticeKind, text: string) => { backupUi.notice = { kind, text }; };
export const clearNotice = () => { backupUi.notice = null; };

function persist() {
  const { telegram: _t, now: _n, ...p } = backup;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 저장소를 못 쓰는 환경 */ }
}
export function persistTelegram() {
  backup.telegram.intervalMin = clampInterval(backup.telegram.intervalMin, MIN_AUTO_MINUTES, DEFAULT_AUTO_MINUTES);
  saveTelegram($state.snapshot(backup.telegram));
}
export function persistBackupSettings() {
  backup.folderIntervalMin = clampInterval(backup.folderIntervalMin, MIN_AUTO_MINUTES, FOLDER_DEFAULT_MINUTES);
  persist();
}

// ---- 경로별 성공/실패 기록 ----
export type BackupPath = 'export' | 'telegram' | 'folder';

/** 경로의 지금 기록(반응형 — 화면에서 읽으면 갱신된다) */
export function pathStatus(p: BackupPath): PathStatus {
  if (p === 'export') return { lastSuccess: backup.lastExport, failAt: backup.failExportAt, failMsg: backup.failExportMsg };
  if (p === 'telegram') return { lastSuccess: backup.lastTelegram, failAt: backup.failTelegramAt, failMsg: backup.failTelegramMsg };
  return { lastSuccess: backup.lastFolder, failAt: backup.failFolderAt, failMsg: backup.failFolderMsg };
}
function commit(p: BackupPath, s: PathStatus) {
  if (p === 'export') { backup.lastExport = s.lastSuccess; backup.failExportAt = s.failAt; backup.failExportMsg = s.failMsg; }
  else if (p === 'telegram') { backup.lastTelegram = s.lastSuccess; backup.failTelegramAt = s.failAt; backup.failTelegramMsg = s.failMsg; }
  else { backup.lastFolder = s.lastSuccess; backup.failFolderAt = s.failAt; backup.failFolderMsg = s.failMsg; }
  persist();
}
/** startedAt = 번들 만들기를 시작한 시각 */
const noteSuccess = (p: BackupPath, startedAt: number) => commit(p, recordSuccess(pathStatus(p), startedAt));
const noteFailure = (p: BackupPath, e: unknown) => commit(p, recordFailure(pathStatus(p), Date.now(), errMsg(e)));

// ---- 변경 감지 ----
let persistTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * 번들을 만들기 전 준비 단계(열린 글·코멘트 저장)에서만 변경 기록을 건너뛴다 — 그 쓰기는 사용자 변경이 아니라서,
 * 기록하면 방금 만든 백업이 곧바로 '낡음'이 된다. 번들을 읽는 동안과 올리는 동안의 변경은 기록하며,
 * 성공 시각을 '만들기 시작한 시각'으로 두므로 그 변경은 다음 백업 대상으로 남는다(lastChange > 성공 시각).
 */
let preparing = 0;
/** 글 저장·글감/이력/스레드 쓰기에서 호출한다. 입력마다 저장소를 두드리지 않도록 기록은 2초 묶어서 한다. */
export function markChanged() {
  if (preparing > 0) return;
  backup.lastChange = Date.now();
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 2000);
}
onWorksWrite(markChanged);

export const lastBackupAt = () => Math.max(backup.lastExport, backup.lastTelegram, backup.lastFolder);
export const hasUnbacked = () => needsBackup(backup.lastChange, lastBackupAt());
const notifyInput = () => ({ now: backup.now, lastChange: backup.lastChange, lastBackup: lastBackupAt(), days: backup.notifyDays, since: backup.since });
const telegramInput = (): TelegramStaleInput => ({
  enabled: backup.telegram.auto && telegramReady(),
  now: backup.now, lastChange: backup.lastChange, lastSuccess: backup.lastTelegram, failAt: backup.failTelegramAt,
  intervalMin: backup.telegram.intervalMin, since: backup.since,
});
/** 상단바 점 배지·시작 알림: 전체 백업이 오래됐거나, 텔레그램 자동 올리기가 오래 성공하지 못했다 */
export const isStale = () => isAnyStale(notifyInput(), telegramInput());
/** 텔레그램 자동 올리기가 간격의 여러 배(또는 24시간) 넘게 성공하지 못했는가(창의 해당 영역 경고용) */
export const telegramStale = () => isTelegramStale(telegramInput());
export const ago = (ts: number) => formatAgo(ts, backup.now);
export const keyAvailable = () => hasBundleKey();

// ---- 번들 만들기 ----
export async function makeBundle(encrypted: boolean): Promise<{ bytes: Uint8Array; summary: BundleSummary; ext: 'mwb' | 'zip' }> {
  preparing++;
  try {
    await prepareBundle();
  } finally {
    preparing--;
  }
  const { bytes, summary } = await buildBundle();
  if (!encrypted) return { bytes, summary, ext: 'zip' };
  return { bytes: await encryptBundle(bytes), summary, ext: 'mwb' };
}

/** 파일로 내려받고 파일 이름을 돌려준다. 암호화(.mwb)는 키가 있어야 한다. */
export async function exportToFile(encrypted: boolean): Promise<string> {
  if (encrypted && !hasBundleKey()) throw new Error('암호화 키가 없어 .mwb 를 만들 수 없습니다. 평문 zip 으로 내보내세요');
  const startedAt = Date.now();
  try {
    const { bytes, ext } = await makeBundle(encrypted);
    const name = bundleFileName(new Date(), ext);
    downloadBlob(name, new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    noteSuccess('export', startedAt);
    return name;
  } catch (e) {
    noteFailure('export', e);
    throw e;
  }
}

/** 선택·드롭한 파일을 읽어 번들 zip 바이트로 만든다(.mwb 면 복호화). 번들이 아니면 오류. */
export async function readBundleFile(file: File): Promise<Uint8Array> {
  return readBundleFiles([file]);
}

/** 여러 파일(.mwb.001… 조각 포함)을 받아 단일 파일 또는 번호순으로 이어 붙인 바이트를 번들 zip 으로 만든다. */
export async function readBundleFiles(files: File[]): Promise<Uint8Array> {
  const plan = planImport(files);
  if (!plan.ok) throw new Error(plan.error);
  const bytes = plan.kind === 'single'
    ? new Uint8Array(await plan.file.arrayBuffer())
    : concatBytes(await Promise.all(plan.parts.map(async (p) => new Uint8Array(await p.arrayBuffer()))));
  const name = plan.kind === 'single' ? plan.file.name : plan.stem;
  const kind = classifyBytes(name, bytes);
  if (kind === 'bundle-encrypted') return decryptBundle(bytes);
  if (kind === 'bundle-zip') return bytes;
  if (kind === 'folder-json') return folderJsonToBundle(parseFolderJson(bytes)!, name.replace(/\.json$/i, '')); // 기존 번들 흐름(미리보기·병합)으로 보낸다
  throw new Error(kind === 'doc-zip' ? '번들이 아닌 일반 문서 zip 입니다 (문서 가져오기를 사용하세요)' : '.mwb, 번들 zip 또는 폴더 백업 JSON 파일이 아닙니다');
}

// ---- 텔레그램 ----
let tgAttempt = 0;
let tgFailToasted = false;

export function telegramReady(): boolean {
  const t = backup.telegram;
  return hasBundleKey() && !!t.token.trim() && !!t.chatId.trim();
}

/** 지금 올리기. 키가 없으면 거부(평문 업로드 금지). 실패는 기록한 뒤 예외로 던진다. */
export async function uploadToTelegram(): Promise<string> {
  if (!hasBundleKey()) throw new Error('암호화 키가 없어 텔레그램에 올릴 수 없습니다 (평문 업로드는 하지 않습니다)');
  const startedAt = Date.now();
  tgAttempt = startedAt;
  backupUi.tgProgress = '';
  try {
    const { bytes, summary } = await makeBundle(true);
    const t = $state.snapshot(backup.telegram);
    const r = await sendBundle(t, bytes, {
      caption: `md-works 백업 · 글 ${summary.docs}개`,
      onProgress: (done, total) => { backupUi.tgProgress = total > 1 ? `${Math.min(total, done + 1)}/${total}` : ''; },
    });
    noteSuccess('telegram', startedAt);
    tgFailToasted = false;
    return r.parts > 1 ? `${r.filenames[0]} 외 ${r.parts - 1}개 (총 ${r.parts}개 조각)` : r.filenames[0];
  } catch (e) {
    noteFailure('telegram', e);
    throw e;
  } finally {
    backupUi.tgProgress = '';
  }
}

// ---- 서버 노트 폴더 백업(.works-backup/) ----
export interface FolderBackup { name: string; size: number; mtime: number }
let folderAttempt = 0;
let folderFailToasted = false;

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `요청 실패 (${res.status})`);
  return data as T;
}

export async function listFolderBackups(): Promise<FolderBackup[]> {
  return (await apiJson<{ backups: FolderBackup[] }>('/api/backups')).backups;
}
export const folderBackupUrl = (name: string) => `/api/backup/file?name=${encodeURIComponent(name)}`;
export const isFolderBackupName = (n: string) => SERVER_BACKUP_NAME_RE.test(n);

/** 폴더 백업 하나를 서버에서 받아 File 로 돌려준다(복원 = 이 파일을 기존 가져오기 흐름에 넘긴다) */
export async function fetchFolderBackup(name: string): Promise<File> {
  if (!isFolderBackupName(name)) throw new Error('올바른 백업 파일 이름이 아닙니다');
  const res = await fetch(folderBackupUrl(name));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `요청 실패 (${res.status})`);
  }
  return new File([await res.arrayBuffer()], name, { type: 'application/octet-stream' });
}

/** 지금 노트 폴더(.works-backup/)에 번들을 저장한다. 키가 있으면 .mwb, 없으면 zip. */
export async function backupToFolder(): Promise<string> {
  const startedAt = Date.now();
  folderAttempt = startedAt;
  try {
    const { bytes } = await makeBundle(hasBundleKey());
    const r = await apiJson<{ name: string }>('/api/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes as BodyInit,
    });
    noteSuccess('folder', startedAt);
    folderFailToasted = false;
    return r.name;
  } catch (e) {
    noteFailure('folder', e);
    throw e;
  }
}

// ---- 스케줄러(자동 올리기·폴더 백업) + 시작 알림 ----
let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
let notified = false; // 이 세션에서 시작 알림은 한 번만

/** 창 밖에서 일어난 자동 동작의 결과: 창이 열려 있으면 창 안 안내, 닫혀 있으면 실패만 토스트(같은 실패는 성공 전까지 한 번) */
function reportAuto(kind: NoticeKind, text: string, alreadyToasted: boolean): boolean {
  const route = routeNotice(backupUi.open, kind);
  if (route === 'notice') { showNotice(kind, text); return alreadyToasted; }
  if (route === 'toast' && !alreadyToasted) { toast(text, 'error'); return true; }
  return alreadyToasted;
}

async function tick() {
  backup.now = Date.now();
  if (busy) return;
  busy = true;
  try {
    const now = backup.now;
    const t = backup.telegram;
    if (t.auto && telegramReady()
      && isUploadDue({ now, lastChange: backup.lastChange, lastSuccess: backup.lastTelegram, lastAttempt: tgAttempt, intervalMin: t.intervalMin })) {
      try {
        const name = await uploadToTelegram();
        reportAuto('success', `텔레그램에 자동으로 올렸습니다: ${name}`, false);
      } catch (e) {
        tgFailToasted = reportAuto('error', `텔레그램 자동 올리기를 하지 못했습니다: ${errMsg(e)}`, tgFailToasted);
      }
    }
    if (isServer() && backup.folderAuto
      && isUploadDue({ now: Date.now(), lastChange: backup.lastChange, lastSuccess: backup.lastFolder, lastAttempt: folderAttempt, intervalMin: backup.folderIntervalMin })) {
      try {
        const name = await backupToFolder();
        reportAuto('success', `노트 폴더에 자동으로 백업했습니다: ${name}`, false);
      } catch (e) {
        folderFailToasted = reportAuto('error', `노트 폴더 자동 백업을 하지 못했습니다: ${errMsg(e)}`, folderFailToasted);
      }
    }
  } finally {
    busy = false;
  }
}

/**
 * 앱 전체 드롭에서 번들(.mwb · 번들 zip)을 골라 백업 대화상자의 가져오기 흐름으로 보내고,
 * 나머지(일반 .md/.docx/문서 zip)는 돌려줘 기존 문서 가져오기 흐름이 처리하게 한다.
 */
export async function divertBundleDrop(files: File[]): Promise<File[]> {
  const { bundles, rest } = await splitBundleFiles(files);
  if (bundles.length) {
    // 조각(.mwb.001…)은 모두 넘겨 대화상자가 묶는다. 조각이 아닌 번들이 여럿이면 기존처럼 첫 파일만 연다.
    if (bundles.length > 1 && !bundles.some((f) => isPartName(f.name))) {
      toast('번들은 한 번에 하나만 가져옵니다. 첫 파일만 엽니다');
      backupUi.pending = [bundles[0]];
    } else {
      backupUi.pending = bundles;
    }
    backupUi.tab = 'transfer'; // 가져오기는 이 탭에서 이어진다
    backupUi.open = true;
  }
  return rest;
}

/** 셸이 마운트될 때 한 번 호출한다(중복 호출은 무시). 1분마다 스케줄을 점검하고, 시작 후 한 번 백업 알림을 띄운다. */
export function startBackupScheduler() {
  if (timer) return;
  timer = setInterval(() => void tick(), MIN_MS);
  setTimeout(() => {
    backup.now = Date.now();
    if (!notified && isStale()) {
      notified = true;
      if (isBackupStale(notifyInput())) {
        toast(lastBackupAt() ? `마지막 백업 ${ago(lastBackupAt())} — 백업 버튼으로 백업하세요` : '아직 백업한 적이 없습니다 — 백업 버튼으로 백업하세요');
      } else {
        toast(backup.lastTelegram
          ? `텔레그램 자동 올리기가 마지막 성공(${ago(backup.lastTelegram)}) 뒤로 이어지지 않았습니다 — 백업 창에서 확인하세요`
          : '텔레그램 자동 올리기가 한 번도 성공하지 못했습니다 — 백업 창에서 확인하세요', 'error');
      }
    }
    void tick();
  }, 4000);
}
