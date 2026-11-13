// 두 모드가 공유하는 상태: 설정, 현재 문서, 토스트, 대화상자
export type Theme = 'system' | 'light' | 'dark';
export type ImageMode = 'file' | 'base64';
import type { CopyKind } from './tableTools';

const SETTINGS_KEY = 'notes.settings';
const SETTINGS_VERSION = 3;

// 글자 크기·본문 폭은 디자인 설정(src/lib/design, 'works.design')으로 옮겨졌다. 옛 값은 design/io.ts 가 이관한다.
/** 기본값이 바뀌기 전(v2 이하)의 기본값 — 저장돼 있어도 사용자가 고른 값이 아니므로 새 기본값으로 옮긴다 */
const LEGACY_DEFAULTS = { fontSize: 16, contentWidth: 860 };

function loadSettings() {
  const base = {
    theme: 'system' as Theme,
    autosave: true,
    imageMode: 'file' as ImageMode,
    template: '', // 서버 버전의 docx 템플릿 파일명, 빈 값이면 기본 템플릿
    tableLastCopy: '' as '' | CopyKind, // 표 확대 보기에서 가장 최근에 고른 복사 형식(비어 있으면 tableCopyFormat)
    tableCopyFormat: 'tsv' as 'tsv' | 'csv', // 표 '복사' 단추의 기본 형식(다른 형식은 메뉴에서)
    animations: true, // 패널·툴팁·모달·팝오버의 나타남/사라짐과 flash(빌드 옵션 __ANIM__ 이 꺼져 있으면 무시)
    snippetColors: false, // 글감 색 지정·색 필터 같은 '고급' 기능을 쓸지(기본 꺼짐: 화면을 어지럽히지 않는다)
    rightHover: false, // 오른쪽 가장자리에 마우스를 대면 글감·목차·코멘트 패널을 팝오버로 띄울지(기본 꺼짐: 옆에 자료 창을 두고 쓸 때 거슬린다)
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

let settingsWarned = false;
export function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 저장소를 못 쓰는 환경: 세션당 한 번만 알린다(설정을 바꿀 때마다 띄우면 거슬린다)
    if (!settingsWarned) {
      settingsWarned = true;
      toast('설정을 저장하지 못했습니다(저장 공간 부족 또는 비공개 모드)', 'error');
    }
  }
}

export function applyTheme() {
  const dark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export const doc = $state({
  key: 0, // 바뀌면 에디터를 새로 만든다
  path: '', // 서버 모드: 루트 기준 경로, 스탠드얼론: 빈 문자열
  name: '제목 없음',
  content: '',
  dirty: false,
  saving: false,
  saveFailed: false, // 저장하지 못한 상태(상단바 '저장하지 못함' 표시, 성공하면 해제)
  saveError: '', // 마지막 저장 실패 이유
  edit: true, // 편집 모드 여부. 기본은 편집이고, 문서를 열 때마다 편집으로 초기화한다(읽기 전환은 토글/Ctrl+Alt+E)
});

/** 문서를 열 때의 시작 모드: 좁은 화면(모바일)은 읽기, 그 밖에는 편집 */
export const defaultEdit = (): boolean => !(typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches);

// 마지막 에디터 내용을 외부에서 읽기 위한 훅 (Editor 가 등록)
// preparePrint: 인쇄용 정적 사본(코드 하이라이트 포함)을 만들고 정리 함수를 돌려준다
/** 명령 팔레트가 부르는 편집기 서식 명령 이름 */
export type EditorCommand =
  | 'bold' | 'italic' | 'code' | 'strike' | 'h1' | 'h2' | 'h3' | 'paragraph'
  | 'quote' | 'bullet' | 'ordered' | 'codeblock' | 'hr' | 'table' | 'footnote';

export const editorBridge: {
  getMarkdown: () => string;
  preparePrint: (() => Promise<() => void>) | null;
  focus: (() => void) | null;
  command: ((name: EditorCommand) => void) | null;
  /** 변환기가 만든 표(첫 행이 머리글)·코드 블록을 커서 위치에 넣는다. 읽기 모드이거나 에디터가 없으면 false */
  insertTable: ((rows: string[][]) => boolean) | null;
  insertCode: ((language: string, text: string) => boolean) | null;
  /** 커서가 있는 코드 블록의 변환 정보(JSON·YAML·마크다운·언어 없음만). 없으면 null */
  codeSource: (() => import('./tableTools').CodeSource | null) | null;
  /** 본문에서 선택한 블록들의 변환 정보(선택이 없거나 코드·표를 포함하면 null) */
  selectionSource: (() => import('./tableTools').CodeSource | null) | null;
} = {
  getMarkdown: () => doc.content,
  preparePrint: null,
  focus: null,
  command: null,
  insertTable: null,
  insertCode: null,
  codeSource: null,
  selectionSource: null,
};

// '새로 만든 글'·'이름 변경 직후'에만 본문에 포커스를 준다(파일 목록을 키보드로 탐색 중이면 빼앗지 않는다).
// 문서를 열기 직전에 켜 두면 새로 만들어지는 에디터가 한 번 소비한다.
// 에디터 생성은 openDoc 이 끝난 뒤에 비동기로 완료되므로 호출부가 바로 끄면 소비되지 못한다 — 일정 시간 뒤 스스로 꺼진다.
export const focusNext = { on: false };
let focusTimer: ReturnType<typeof setTimeout> | undefined;
export function requestEditorFocus() {
  focusNext.on = true;
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => { focusNext.on = false; }, 4000);
}

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
export interface ToastAction { label: string; run: () => void }
export const toasts = $state<{ id: number; text: string; kind: 'info' | 'error'; action?: ToastAction }[]>([]);
let toastId = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
/** action 이 있으면 누를 시간을 주려고 8초 동안 보인다 */
export function toast(text: string, kind: 'info' | 'error' = 'info', opts: { action?: ToastAction } = {}) {
  const id = ++toastId;
  toasts.push({ id, text, kind, ...(opts.action ? { action: opts.action } : {}) });
  releaseToast(id, opts.action ? 8000 : kind === 'error' ? 6000 : 3000);
}
/** 토스트를 바로 닫는다(눌러서 닫기) */
export function dismissToast(id: number) {
  clearTimeout(toastTimers.get(id));
  toastTimers.delete(id);
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}
/** 마우스를 올려 읽는 동안에는 사라지지 않게 타이머를 멈춘다 */
export function holdToast(id: number) {
  clearTimeout(toastTimers.get(id));
  toastTimers.delete(id);
}
/** ms 뒤에 닫히도록 타이머를 (다시) 건다 */
export function releaseToast(id: number, ms = 2000) {
  clearTimeout(toastTimers.get(id));
  toastTimers.set(id, setTimeout(() => dismissToast(id), ms));
}

// ---- 대화상자 (Promise 기반) ----
export const dialog = $state<{
  open: boolean;
  title: string;
  message: string;
  input: boolean;
  value: string;
  buttons: string[];
  /** 되돌릴 수 없는 동작의 확인: 확정 단추를 위험색으로 칠하고 기본 포커스를 취소에 둔다 */
  danger: boolean;
  resolve: (r: { button: number; value: string }) => void;
}>({ open: false, title: '', message: '', input: false, value: '', buttons: [], danger: false, resolve: () => {} });

function ask(opts: { title?: string; message?: string; input?: boolean; value?: string; buttons: string[]; danger?: boolean }) {
  return new Promise<{ button: number; value: string }>((resolve) => {
    Object.assign(dialog, {
      open: true,
      title: opts.title ?? '',
      message: opts.message ?? '',
      input: opts.input ?? false,
      value: opts.value ?? '',
      buttons: opts.buttons,
      danger: opts.danger ?? false,
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

/** danger 를 생략하면 확정 단추가 '삭제'일 때 위험 동작으로 본다 */
export async function askConfirm(message: string, okLabel = '확인', danger = okLabel === '삭제'): Promise<boolean> {
  return (await ask({ message, buttons: ['취소', okLabel], danger })).button === 1;
}

// 버튼 라벨 목록 중 누른 인덱스, 닫으면 -1
export async function askChoose(message: string, buttons: string[]): Promise<number> {
  return (await ask({ message, buttons })).button;
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
