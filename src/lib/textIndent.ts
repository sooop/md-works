// textarea 의 Tab 들여쓰기·내어쓰기와 줄바꿈 때의 들여쓰기 이어받기.
// 순수 계산(indentEdit·newlineEdit)과, 그것을 textarea 에 붙이는 Svelte 액션(tabIndent)으로 나눈다.

/** 들여쓰기 한 단계: 공백 2칸(마크다운 중첩 목록의 관례) */
export const INDENT = '  ';

export interface TextEdit {
  /** 바꿀 범위 [from, to) 와 그 자리에 넣을 글자 */
  from: number;
  to: number;
  insert: string;
  /** 바꾼 뒤의 선택 범위 */
  start: number;
  end: number;
}

const LIST_LINE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/;

/** pos 가 속한 줄의 시작 위치 */
const lineStartAt = (value: string, pos: number) => value.lastIndexOf('\n', pos - 1) + 1;
/** pos 가 속한 줄의 끝(개행 직전) 위치 */
function lineEndAt(value: string, pos: number) {
  const i = value.indexOf('\n', pos);
  return i < 0 ? value.length : i;
}

/** 줄 맨 앞의 들여쓰기 한 단계를 뗀다(공백 최대 2칸 또는 탭 하나). 뗀 글자 수를 함께 돌려준다 */
function outdentLine(line: string): [string, number] {
  if (line.startsWith('\t')) return [line.slice(1), 1];
  const n = line.startsWith(INDENT) ? INDENT.length : line.startsWith(' ') ? 1 : 0;
  return [line.slice(n), n];
}

/**
 * Tab(outdent=false)·Shift+Tab(outdent=true) 의 결과를 계산한다. 바뀌는 것이 없으면 null.
 * - 선택이 없고 일반 줄이면 커서 자리에 공백 2칸을 넣는다.
 * - 선택이 없고 목록 줄('- ', '1. ')이면 줄 전체를 한 단계 들여쓴다(중첩 목록).
 * - 선택이 있으면 선택이 걸친 모든 줄을 들여쓴다(빈 줄은 건너뛴다). 선택한 글자를 지우지 않는다.
 * - 내어쓰기는 항상 줄 단위다.
 */
export function indentEdit(value: string, start: number, end: number, outdent = false): TextEdit | null {
  const collapsed = start === end;
  const from = lineStartAt(value, start);
  if (collapsed && !outdent && !LIST_LINE.test(value.slice(from, lineEndAt(value, start)))) {
    return { from: start, to: start, insert: INDENT, start: start + INDENT.length, end: start + INDENT.length };
  }
  // 선택이 다음 줄의 맨 앞에서 끝나면 그 줄은 포함하지 않는다
  const lastPos = !collapsed && value[end - 1] === '\n' ? end - 1 : end;
  const to = lineEndAt(value, lastPos);
  const lines = value.slice(from, to).split('\n');
  let firstDelta = 0, total = 0;
  const next = lines.map((ln, i) => {
    let out = ln, d = 0;
    if (outdent) { const [s, n] = outdentLine(ln); out = s; d = -n; }
    else if (ln.length || lines.length === 1) { out = INDENT + ln; d = INDENT.length; }
    if (i === 0) firstDelta = d;
    total += d;
    return out;
  });
  if (!total) return null;
  const newStart = Math.max(from, start + firstDelta);
  return { from, to, insert: next.join('\n'), start: newStart, end: collapsed ? newStart : Math.max(newStart, end + total) };
}

/**
 * 줄바꿈할 때 지금 줄의 들여쓰기와 목록 기호를 다음 줄로 이어받는다. 이어받을 것이 없으면 null(기본 줄바꿈에 맡긴다).
 * 기호만 있고 내용이 없는 목록 줄에서 줄바꿈하면 그 기호를 지워 목록을 끝낸다.
 */
export function newlineEdit(value: string, start: number, end: number): TextEdit | null {
  const from = lineStartAt(value, start);
  const head = value.slice(from, start);
  const m = /^([ \t]*)((?:[-*+]|(\d+)([.)]))[ \t]+)?/.exec(head);
  if (!m) return null;
  const [all, ws, marker, num, punct] = m;
  if (!all) return null;
  if (marker && all === head && start === end && lineEndAt(value, start) === start) {
    // 빈 목록 항목: 기호를 지운다
    return { from, to: start, insert: '', start: from, end: from };
  }
  const nextMarker = !marker ? '' : num ? `${Number(num) + 1}${punct} ` : marker;
  const insert = '\n' + ws + nextMarker;
  return { from: start, to: end, insert, start: start + insert.length, end: start + insert.length };
}

/** 계산한 편집을 textarea 에 적용한다. execCommand 를 써서 브라우저의 실행 취소(Ctrl+Z) 기록에 남긴다 */
export function applyEdit(el: HTMLTextAreaElement, edit: TextEdit) {
  el.setSelectionRange(edit.from, edit.to);
  let done = false;
  try {
    done = edit.insert ? document.execCommand('insertText', false, edit.insert) : document.execCommand('delete');
  } catch { /* 지원하지 않으면 아래로 */ }
  if (!done) {
    el.setRangeText(edit.insert, edit.from, edit.to, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.setSelectionRange(edit.start, edit.end);
}

export interface TabIndentOptions {
  /** 이 키 입력이 '줄바꿈'인가. 기본은 Enter(수식키 무관). Enter 가 저장인 입력창은 Shift+Enter 만 넘긴다 */
  isNewline?: (e: KeyboardEvent) => boolean;
}

/**
 * textarea 에서 Tab 이 포커스 이동 대신 들여쓰기로 동작하게 한다(Shift+Tab 내어쓰기, 줄바꿈 때 들여쓰기·목록 기호 이어받기).
 * 키보드만 쓰는 사람이 갇히지 않도록 Esc 를 누른 직후의 Tab 은 가로채지 않고 포커스를 옮긴다.
 */
export function tabIndent(el: HTMLTextAreaElement, opts: TabIndentOptions = {}) {
  let o = opts;
  let release = false; // Esc 직후: 다음 Tab 은 포커스 이동
  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중에는 건드리지 않는다
    if (e.key === 'Escape') { release = true; return; }
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    const wasRelease = release;
    release = false;
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (wasRelease) return;
      e.preventDefault();
      const edit = indentEdit(el.value, el.selectionStart, el.selectionEnd, e.shiftKey);
      if (edit) applyEdit(el, edit);
      return;
    }
    const newline = o.isNewline ? o.isNewline(e) : e.key === 'Enter';
    if (e.key === 'Enter' && newline && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const edit = newlineEdit(el.value, el.selectionStart, el.selectionEnd);
      if (!edit) return;
      e.preventDefault();
      applyEdit(el, edit);
    }
  };
  const onBlur = () => { release = false; };
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onBlur);
  return {
    update(next: TabIndentOptions = {}) { o = next; },
    destroy() { el.removeEventListener('keydown', onKey); el.removeEventListener('blur', onBlur); },
  };
}
