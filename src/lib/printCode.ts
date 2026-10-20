import { highlightTree } from '@lezer/highlight';
import { LanguageDescription } from '@codemirror/language';
import type { EditorView } from '@milkdown/kit/prose/view';
import { codeHighlightStyle, codeLanguages } from './codeLanguages';
import { editorBridge, toast } from './store.svelte';

// 인쇄용 코드 블록: CodeMirror 는 화면에 보이는 줄만 그리므로, 문서 상태의 원문으로 하이라이트된 pre > code 를 만든다.
async function highlighted(code: string, lang: string): Promise<DocumentFragment> {
  const frag = document.createDocumentFragment();
  const desc = lang ? LanguageDescription.matchLanguageName(codeLanguages, lang, true) : null;
  const support = desc ? await desc.load().catch(() => null) : null;
  if (!support) {
    frag.append(code);
    return frag;
  }
  let at = 0;
  const put = (to: number, cls: string) => {
    if (to <= at) return;
    const text = code.slice(at, to);
    if (cls) {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = text;
      frag.append(s);
    } else frag.append(text);
    at = to;
  };
  highlightTree(support.language.parser.parse(code), codeHighlightStyle, (from, to, cls) => {
    put(from, '');
    put(to, cls);
  });
  put(code.length, '');
  return frag;
}

/** 에디터 DOM 의 정적 사본을 만들어 옆에 붙인다. 인쇄 CSS 는 원본 대신 사본을 출력한다. 반환값은 사본을 지우는 함수. */
export async function buildPrintClone(view: EditorView, host: HTMLElement): Promise<() => void> {
  const clone = host.cloneNode(true) as HTMLElement;
  clone.classList.add('print-clone');
  clone.removeAttribute('contenteditable');

  const blocks: { code: string; lang: string }[] = [];
  view.state.doc.descendants((n) => {
    if (n.type.name !== 'code_block') return true;
    blocks.push({ code: n.textContent, lang: String(n.attrs.language ?? '') });
    return false;
  });
  const els = [...clone.querySelectorAll<HTMLElement>('.milkdown-code-block')];
  if (els.length === blocks.length) {
    await Promise.all(els.map(async (el, i) => {
      const pre = document.createElement('pre');
      pre.className = 'print-code';
      const code = document.createElement('code');
      code.append(await highlighted(blocks[i].code, blocks[i].lang));
      pre.append(code);
      el.replaceWith(pre);
    }));
  }

  host.after(clone);
  // 사본의 이미지가 모두 로드된 뒤에 인쇄한다 (최대 3초)
  const pending = [...clone.querySelectorAll('img')].filter((img) => !img.complete);
  if (pending.length) {
    await Promise.race([
      Promise.all(pending.map((img) => new Promise((r) => { img.onload = img.onerror = r; }))),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  }
  return () => clone.remove();
}

const HINT_KEY = 'works.printHint';
/** 인쇄 창의 머리글·바닥글 옵션은 브라우저 설정이 우선이라 앱이 끌 수 없다 — 처음 한 번만 알려 준다 */
function printHintOnce() {
  try {
    if (localStorage.getItem(HINT_KEY)) return;
    localStorage.setItem(HINT_KEY, '1');
  } catch { return; }
  const ff = /firefox/i.test(navigator.userAgent);
  toast(ff
    ? "Firefox 는 문서의 머리글·쪽 번호를 지원하지 않아 인쇄 창의 '머리글/바닥글' 설정을 따릅니다. 깔끔하게 인쇄하려면 그 옵션을 끄세요."
    : "인쇄 창의 '머리글 및 바닥글'을 켜면 브라우저의 날짜·주소가 문서의 머리글과 겹칠 수 있습니다. 문서의 머리글·쪽 번호만 쓰려면 그 옵션을 끄세요.");
}

/** 현재 문서 인쇄. 탭 제목(= PDF 저장 시 기본 파일명)에서 저장 안 됨 표시를 뺀다. */
export async function printDoc() {
  const title = document.title;
  const root = document.documentElement.style;
  let cleanup: (() => void) | undefined;
  try {
    cleanup = await editorBridge.preparePrint?.();
    const name = title.replace(/^● /, '');
    document.title = name;
    root.setProperty('--print-title', JSON.stringify(name));
    root.setProperty('--print-date', JSON.stringify(new Date().toLocaleDateString('ko-KR')));
    printHintOnce();
    window.print();
  } finally {
    root.removeProperty('--print-title');
    root.removeProperty('--print-date');
    document.title = title;
    cleanup?.();
  }
}
