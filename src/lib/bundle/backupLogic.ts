// 백업 판단·스케줄·파일 판별 순수 함수. 상태(backupState.svelte.ts)와 UI 에서 분리해 단위 테스트한다.
import { unzipSync } from 'fflate';
import { isEncrypted } from './crypto';

export const MIN_MS = 60_000;
export const DAY_MS = 24 * 60 * MIN_MS;

/** 알림 기준일 선택지(0 = 끔) */
export const NOTIFY_DAY_CHOICES = [3, 7, 14, 0] as const;
export const DEFAULT_NOTIFY_DAYS = 7;

/** 마지막 변경이 마지막 백업보다 뒤인가(= 백업하지 않은 변경이 있는가) */
export function needsBackup(lastChange: number, lastBackup: number): boolean {
  return lastChange > 0 && lastChange > lastBackup;
}

/** 자동 간격(분)을 최소값 이상의 정수로 맞춘다 */
export function clampInterval(min: number, floor: number, fallback: number): number {
  if (!Number.isFinite(min)) return fallback;
  return Math.max(floor, Math.floor(min));
}

export interface DueInput {
  now: number;
  lastChange: number;
  /** 마지막 업로드 성공 시각(없으면 0) */
  lastSuccess: number;
  /** 마지막 시도 시각(실패 포함, 없으면 0) — 실패 직후 매 틱마다 재시도하지 않게 한다 */
  lastAttempt: number;
  intervalMin: number;
}

/** 자동 올리기 시점인가: 마지막 업로드 이후 변경이 있고, 마지막 시도 후 간격이 지났을 때만 */
export function isUploadDue({ now, lastChange, lastSuccess, lastAttempt, intervalMin }: DueInput): boolean {
  if (!needsBackup(lastChange, lastSuccess)) return false;
  return now - Math.max(lastSuccess, lastAttempt) >= intervalMin * MIN_MS;
}

export interface NotifyInput {
  now: number;
  lastChange: number;
  /** 내보내기·텔레그램·폴더 백업 중 가장 최근 성공 시각(없으면 0) */
  lastBackup: number;
  /** 기준일(0 이면 끔) */
  days: number;
  /** 백업 기록이 없을 때 기준으로 삼는 시각(이 상태를 처음 만든 시각) */
  since: number;
}

/** 오래 백업하지 않았고 그 뒤 변경이 있는가 — 점 배지·시작 토스트의 조건 */
export function isBackupStale({ now, lastChange, lastBackup, days, since }: NotifyInput): boolean {
  if (days <= 0) return false;
  if (!needsBackup(lastChange, lastBackup)) return false;
  const ref = lastBackup > 0 ? lastBackup : since;
  return now - ref > days * DAY_MS;
}

/** '마지막 백업 3일 전' 같은 사람이 읽는 경과 시간 */
export function formatAgo(ts: number, now: number): string {
  if (!ts) return '없음';
  const d = Math.max(0, now - ts);
  if (d < MIN_MS) return '방금 전';
  if (d < 60 * MIN_MS) return `${Math.floor(d / MIN_MS)}분 전`;
  if (d < DAY_MS) return `${Math.floor(d / (60 * MIN_MS))}시간 전`;
  return `${Math.floor(d / DAY_MS)}일 전`;
}

// ---- 파일 판별: 번들(.mwb / 번들 zip) vs 일반 문서(.md/.docx/문서 묶음 zip) ----
const ZIP_MAGIC = [0x50, 0x4b]; // 'PK'
export const BUNDLE_SCHEMA = 'md-works-bundle';

export const isZipBytes = (b: Uint8Array) => b.length >= 4 && b[0] === ZIP_MAGIC[0] && b[1] === ZIP_MAGIC[1];

/** zip 안의 manifest.json 이 schema 'md-works-bundle' 인가(중앙 디렉터리 + manifest 만 읽는다) */
export function isBundleZip(bytes: Uint8Array): boolean {
  if (!isZipBytes(bytes)) return false;
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === 'manifest.json' });
    const m = files['manifest.json'];
    if (!m) return false;
    return JSON.parse(new TextDecoder().decode(m))?.schema === BUNDLE_SCHEMA;
  } catch {
    return false;
  }
}

export type FileKind = 'bundle-encrypted' | 'bundle-zip' | 'doc-zip' | 'other';

/** 바이트로 판별한다. 암호화 번들은 매직으로, zip 은 manifest 의 schema 로 구분한다. */
export function classifyBytes(name: string, bytes: Uint8Array): FileKind {
  if (isEncrypted(bytes)) return 'bundle-encrypted';
  if (isZipBytes(bytes) || /\.zip$/i.test(name)) return isBundleZip(bytes) ? 'bundle-zip' : 'doc-zip';
  return 'other';
}

/** 앱 전체 드롭에서 이 파일을 번들 가져오기(백업 대화상자)로 보낼지 판정한다 */
export async function isBundleFile(file: File): Promise<boolean> {
  const isMwb = /\.mwb$/i.test(file.name);
  const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip';
  if (!isMwb && !isZip) return false; // .md/.docx 등은 바이트를 읽지 않는다
  const kind = classifyBytes(file.name, new Uint8Array(await file.arrayBuffer()));
  return kind === 'bundle-encrypted' || kind === 'bundle-zip';
}

/** 드롭된 파일을 번들(백업 흐름)과 나머지(문서 가져오기 흐름)로 나눈다 */
export async function splitBundleFiles(files: File[]): Promise<{ bundles: File[]; rest: File[] }> {
  const bundles: File[] = [];
  const rest: File[] = [];
  for (const f of files) (await isBundleFile(f) ? bundles : rest).push(f);
  return { bundles, rest };
}

/** 서버 폴더 백업 파일명 규칙(서버 정규식과 같다) */
export const SERVER_BACKUP_NAME_RE = /^md-works-\d{8}-\d{6}(-\d+)?\.(mwb|zip)$/;
