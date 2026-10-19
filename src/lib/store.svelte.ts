// 두 모드가 공유하는 상태: 설정, 현재 문서, 토스트, 대화상자
export type Theme = 'system' | 'light' | 'dark';
export type ImageMode = 'file' | 'base64';

const SETTINGS_KEY = 'notes.settings';
const SETTINGS_VERSION = 3;

/** 기본값 — 설정 팝오버의 "초기화"와 전체 폭 해제도 이 값을 쓴다 */
export const DEFAULT_FONT_SIZE = 15; // 에디터 기본 글자 크기(px)
export const DEFAULT_CONTENT_WIDTH = 980; // 본문 최대 폭(px), 0 이면 전체 폭
/** 기본값이 바뀌기 전(v2 이하)의 기본값 — 저장돼 있어도 사용자가 고른 값이 아니므로 새 기본값으로 옮긴다 */
const LEGACY_DEFAULTS = { fontSize: 16, contentWidth: 860 };

function loadSettings() {
  const base = {
    theme: 'system' as Theme,
    autosave: true,
    imageMode: 'file' as ImageMode,
    fontSize: DEFAULT_FONT_SIZE,
    contentWidth: DEFAULT_CONTENT_WIDTH,
    template: '', // 서버 버전의 docx 템플릿 파일명, 빈 값이면 기본 템플릿
    version: SETTINGS_VERSION,
  };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    const outdated = stored.version !== SETTINGS_VERSION;
    if (outdated) {
      // 옛 기본값 그대로인 항목만 버리고(직접 바꾼 값은 유지) 새 기본값을 받는다
      if (stored.fontSize === LEGACY_DEFAULTS.fontSize) delete stored.fontSize;
      if (stored.contentWidth === LEGACY_DEFAULTS.contentWidth) delete stored.contentWidth;
    }
    const merged = { ...base, ...stored, version: SETTINGS_VERSION };
    if (outdated) {
      // v2: 자동 저장 기본값이 ON 으로 바뀌었다. 이전 설정을 가진 사용자도 한 번만 ON 으로 전환한다(이후 끄면 존중).
      if ((stored.version ?? 0) < 2) merged.autosave = true;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    }
    return merged;
  } catch {
    return base;
  }
}

export const settings = $state(loadSettings());

export function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* 저장소를 못 쓰는 환경 */ }
}

export function applyTheme() {
  const dark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export const FONT_RANGE = { min: 12, max: 24 };
export const WIDTH_RANGE = { min: 480, max: 1600 };

// 글자 크기와 본문 폭을 CSS 변수로 반영한다
export function applyLayout() {
  const f = Math.min(FONT_RANGE.max, Math.max(FONT_RANGE.min, Number(settings.fontSize) || DEFAULT_FONT_SIZE));
  const w = Number(settings.contentWidth) || 0;
  const root = document.documentElement.style;
  root.setProperty('--editor-font-size', `${f}px`);
  root.setProperty('--editor-width', w > 0 ? `${Math.min(WIDTH_RANGE.max, Math.max(WIDTH_RANGE.min, w))}px` : 'none');
}

export const doc = $state({
  key: 0, // 바뀌면 에디터를 새로 만든다
  path: '', // 서버 모드: 루트 기준 경로, 스탠드얼론: 빈 문자열
  name: '제목 없음',
  content: '',
  dirty: false,
  saving: false,
  edit: true, // 편집 모드 여부. 기본은 편집이고, 문서를 열 때마다 편집으로 초기화한다(읽기 전환은 토글/Ctrl+E)
});

// 마지막 에디터 내용을 외부에서 읽기 위한 훅 (Editor 가 등록)
// preparePrint: 인쇄용 정적 사본(코드 하이라이트 포함)을 만들고 정리 함수를 돌려준다
export const editorBridge: { getMarkdown: () => string; preparePrint: (() => Promise<() => void>) | null } = {
  getMarkdown: () => doc.content,
  preparePrint: null,
};

// ---- 진행 상태 (pandoc 엔진 준비/변환 등 시간이 걸리는 작업) ----
export const status = $state({ text: '' });
export async function withStatus<T>(text: string, fn: (set: (t: string) => void) => Promise<T>): Promise<T> {
  status.text = text;
  try {
    return await fn((t) => { status.text = t; });
  } finally {
    status.text = '';
  }
}

// ---- 토스트 ----
export const toasts = $state<{ id: number; text: string; kind: 'info' | 'error' }[]>([]);
let toastId = 0;
export function toast(text: string, kind: 'info' | 'error' = 'info') {
  const id = ++toastId;
  toasts.push({ id, text, kind });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, kind === 'error' ? 6000 : 3000);
}

// ---- 대화상자 (Promise 기반) ----
export const dialog = $state<{
  open: boolean;
  title: string;
  message: string;
  input: boolean;
  value: string;
  buttons: string[];
  resolve: (r: { button: number; value: string }) => void;
}>({ open: false, title: '', message: '', input: false, value: '', buttons: [], resolve: () => {} });

function ask(opts: { title?: string; message?: string; input?: boolean; value?: string; buttons: string[] }) {
  return new Promise<{ button: number; value: string }>((resolve) => {
    Object.assign(dialog, {
      open: true,
      title: opts.title ?? '',
      message: opts.message ?? '',
      input: opts.input ?? false,
      value: opts.value ?? '',
      buttons: opts.buttons,
      resolve: (r: { button: number; value: string }) => {
        dialog.open = false;
        resolve(r);
      },
    });
  });
}

export async function askPrompt(title: string, value = ''): Promise<string | null> {
  const r = await ask({ title, input: true, value, buttons: ['취소', '확인'] });
  return r.button === 1 ? r.value.trim() : null;
}

export async function askConfirm(message: string, okLabel = '확인'): Promise<boolean> {
  return (await ask({ message, buttons: ['취소', okLabel] })).button === 1;
}

// 버튼 라벨 목록 중 누른 인덱스, 닫으면 -1
export async function askChoose(message: string, buttons: string[]): Promise<number> {
  return (await ask({ message, buttons })).button;
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
