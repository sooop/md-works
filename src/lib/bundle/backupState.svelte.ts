// 백업 상태·설정·동작. 판단 로직은 backupLogic.ts(순수 함수), 암호화는 crypto.ts, 텔레그램은 telegram.ts 에 있다.
// 설정은 localStorage 'works.backup'(변경·백업 시각, 알림, 폴더 백업)과 'works.telegram'(토큰·chat_id·자동 올리기)에 나눠 저장한다.
// 토큰·chat_id 는 번들·내보내기에 절대 포함하지 않는다.
import { toast, errMsg } from '../store.svelte';
import { downloadBlob } from '../utils';
import { onWorksWrite } from '../works/store';
import { buildBundle, type BundleSummary } from './api';
import { encryptBundle, decryptBundle, hasBundleKey } from './crypto';
import { folderJsonToBundle, parseFolderJson } from '../folderExport';
import {
  DEFAULT_NOTIFY_DAYS, SERVER_BACKUP_NAME_RE, classifyBytes, concatBytes, isPartName, planImport, splitBundleFiles, clampInterval, formatAgo, isBackupStale, isUploadDue, needsBackup, MIN_MS,
} from './backupLogic';
import {
  DEFAULT_AUTO_MINUTES, MIN_AUTO_MINUTES, bundleFileName, loadTelegram, saveTelegram, sendBundle, type TelegramSettings,
} from './telegram';

const KEY = 'works.backup';
const isServer = () => typeof __MODE__ !== 'undefined' && __MODE__ === 'server';

export const FOLDER_DEFAULT_MINUTES = 15;

interface Persisted {
  lastChange: number;
  lastExport: number;
  lastTelegram: number;
  lastFolder: number;
  /** 이 상태를 처음 만든 시각 — 백업 기록이 없을 때 알림 기준 */
  since: number;
  notifyDays: number;
  folderAuto: boolean;
  folderIntervalMin: number;
}

function loadPersisted(): Persisted {
  const base: Persisted = {
    lastChange: 0, lastExport: 0, lastTelegram: 0, lastFolder: 0, since: Date.now(),
    notifyDays: DEFAULT_NOTIFY_DAYS, folderAuto: true, folderIntervalMin: FOLDER_DEFAULT_MINUTES,
  };
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    return {
      lastChange: num(j.lastChange, 0),
      lastExport: num(j.lastExport, 0),
      lastTelegram: num(j.lastTelegram, 0),
      lastFolder: num(j.lastFolder, 0),
      since: num(j.since, base.since),
      notifyDays: num(j.notifyDays, base.notifyDays),
      folderAuto: j.folderAuto !== false,
      folderIntervalMin: clampInterval(num(j.folderIntervalMin, base.folderIntervalMin), MIN_AUTO_MINUTES, FOLDER_DEFAULT_MINUTES),
    };
  } catch {
    return base;
  }
}

export const backup = $state<Persisted & { telegram: TelegramSettings; now: number }>({
  ...loadPersisted(),
  telegram: loadTelegram(),
  now: Date.now(), // 점 배지·경과 시간이 시간이 지나면 갱신되도록 스케줄러가 틱마다 갱신한다
});

/** 가져오기 흐름을 외부(앱 전체 드롭)에서 열기 위한 UI 상태 */
export const backupUi = $state<{ open: boolean; pending: File[] | null; busy: string; tgProgress: string }>({ open: false, pending: null, busy: '', tgProgress: '' });

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

// ---- 변경 감지 ----
let persistTimer: ReturnType<typeof setTimeout> | undefined;
/** 글 저장·글감/이력/스레드 쓰기에서 호출한다. 입력마다 저장소를 두드리지 않도록 기록은 2초 묶어서 한다. */
let building = 0; // 번들을 만드는 동안(makeBundle) 그 준비 과정의 글 저장은 '사용자 변경'이 아니다
export function markChanged() {
  if (building > 0) return;
  backup.lastChange = Date.now();
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 2000);
}
onWorksWrite(markChanged);

export const lastBackupAt = () => Math.max(backup.lastExport, backup.lastTelegram, backup.lastFolder);
export const hasUnbacked = () => needsBackup(backup.lastChange, lastBackupAt());
export const isStale = () =>
  isBackupStale({ now: backup.now, lastChange: backup.lastChange, lastBackup: lastBackupAt(), days: backup.notifyDays, since: backup.since });
export const ago = (ts: number) => formatAgo(ts, backup.now);
export const keyAvailable = () => hasBundleKey();

// ---- 번들 만들기 ----
export async function makeBundle(encrypted: boolean): Promise<{ bytes: Uint8Array; summary: BundleSummary; ext: 'mwb' | 'zip' }> {
  building++;
  let built: Awaited<ReturnType<typeof buildBundle>>;
  try {
    built = await buildBundle(); // 내부에서 열린 글을 먼저 저장(flush)하는데, 그 쓰기가 변경으로 기록되면 방금 만든 백업이 곧바로 '낡음'이 된다
  } finally {
    building--;
  }
  const { bytes, summary } = built;
  if (!encrypted) return { bytes, summary, ext: 'zip' };
  return { bytes: await encryptBundle(bytes), summary, ext: 'mwb' };
}

/** 파일로 내려받는다. 암호화(.mwb)는 키가 있어야 한다. */
export async function exportToFile(encrypted: boolean): Promise<void> {
  if (encrypted && !hasBundleKey()) throw new Error('암호화 키가 없어 .mwb 를 만들 수 없습니다. 평문 zip 으로 내보내세요');
  const startedAt = Date.now();
  const { bytes, ext } = await makeBundle(encrypted);
  downloadBlob(bundleFileName(new Date(), ext), new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  backup.lastExport = startedAt;
  persist();
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

/** 지금 올리기. 키가 없으면 거부(평문 업로드 금지). 실패는 예외로 던진다. */
export async function uploadToTelegram(): Promise<string> {
  if (!hasBundleKey()) throw new Error('암호화 키가 없어 텔레그램에 올릴 수 없습니다 (평문 업로드는 하지 않습니다)');
  const startedAt = Date.now();
  tgAttempt = startedAt;
  const { bytes, summary } = await makeBundle(true);
  const t = $state.snapshot(backup.telegram);
  backupUi.tgProgress = '';
  try {
    const r = await sendBundle(t, bytes, {
      caption: `md-works 백업 · 글 ${summary.docs}개`,
      onProgress: (done, total) => { backupUi.tgProgress = total > 1 ? `${Math.min(total, done + 1)}/${total}` : ''; },
    });
    backup.lastTelegram = startedAt;
    persist();
    tgFailToasted = false;
    return r.parts > 1 ? `${r.filenames[0]} 외 ${r.parts - 1}개 (총 ${r.parts}개 조각)` : r.filenames[0];
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

/** 지금 노트 폴더(.works-backup/)에 번들을 저장한다. 키가 있으면 .mwb, 없으면 zip. */
export async function backupToFolder(): Promise<string> {
  const startedAt = Date.now();
  folderAttempt = startedAt;
  const { bytes } = await makeBundle(hasBundleKey());
  const r = await apiJson<{ name: string }>('/api/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes as BodyInit,
  });
  backup.lastFolder = startedAt;
  persist();
  folderFailToasted = false;
  return r.name;
}

// ---- 스케줄러(자동 올리기·폴더 백업) + 시작 알림 ----
let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
let notified = false; // 이 세션에서 시작 알림은 한 번만

async function tick() {
  backup.now = Date.now();
  if (busy) return;
  busy = true;
  try {
    const now = backup.now;
    const t = backup.telegram;
    if (t.auto && telegramReady()
      && isUploadDue({ now, lastChange: backup.lastChange, lastSuccess: backup.lastTelegram, lastAttempt: tgAttempt, intervalMin: t.intervalMin })) {
      try { await uploadToTelegram(); }
      catch (e) {
        if (!tgFailToasted) { tgFailToasted = true; toast(`텔레그램 자동 올리기 실패: ${errMsg(e)}`, 'error'); }
      }
    }
    if (isServer() && backup.folderAuto
      && isUploadDue({ now: Date.now(), lastChange: backup.lastChange, lastSuccess: backup.lastFolder, lastAttempt: folderAttempt, intervalMin: backup.folderIntervalMin })) {
      try { await backupToFolder(); }
      catch (e) {
        if (!folderFailToasted) { folderFailToasted = true; toast(`노트 폴더 백업 실패: ${errMsg(e)}`, 'error'); }
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
      toast(lastBackupAt() ? `마지막 백업 ${ago(lastBackupAt())} — 백업 버튼으로 백업하세요` : '아직 백업한 적이 없습니다 — 백업 버튼으로 백업하세요');
    }
    void tick();
  }, 4000);
}
