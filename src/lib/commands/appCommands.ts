// 명령 팔레트에 올릴 명령 목록. 모드(서버/단일)마다 다른 동작은 셸이 ctx 로 넘기고, 나머지(패널·집중 모드·테마·검색·서식)는 여기서 직접 잇는다.
import type { Command } from './registry.svelte';
import { doc, settings, persistSettings, applyTheme, editorBridge, toast, type EditorCommand, type Theme } from '../store.svelte';
import { toggleFocus } from '../writing/state.svelte';
import { ui } from '../search/state.svelte';
import { toggleLeft, openLeft } from '../sidebar/state.svelte';
import { toggleRight } from '../rightbar/state.svelte';
import { sendSelection, findByEditorText } from '../snippets/state.svelte';
import { startDraft } from '../comments/store.svelte';
import { openListImport } from '../tableListUi.svelte';

export interface AppCommandCtx {
  server: boolean;
  /** 열 수 있는 글 목록(경로 또는 id, 화면에 보일 이름) */
  docs: () => { id: string; label: string }[];
  openDoc: (id: string) => void;
  createDoc: () => void;
  createFolder: () => void;
  pasteDoc: () => void;
  save: () => void;
  importFiles?: () => void;
  history: () => void;
  exportMd: () => void;
  copyMd: () => void;
  exportDocx: () => void;
  print: () => void;
  images?: (to: 'base64' | 'file') => void;
  settings: () => void;
  backup: () => void;
}

const hasDoc = () => !!doc.path;
const canFormat = () => !!doc.path && doc.edit;

function setTheme(t: Theme) {
  settings.theme = t;
  applyTheme();
  persistSettings();
}

export function buildAppCommands(c: AppCommandCtx): Command[] {
  const fmt = (id: string, title: string, name: EditorCommand, shortcut?: string, keywords?: string): Command => ({
    id: `fmt.${id}`, group: '서식', title, shortcut, keywords, when: canFormat, run: () => editorBridge.command?.(name),
  });

  const list: Command[] = [
    // ---- 파일 ----
    { id: 'file.new', group: '파일', title: '새 문서', keywords: 'new create 만들기', run: c.createDoc },
    { id: 'file.folder', group: '파일', title: '새 폴더', keywords: 'new folder 디렉터리', run: c.createFolder },
    { id: 'file.paste', group: '파일', title: '붙여넣어 새 문서 만들기', keywords: 'paste', run: c.pasteDoc },
    ...(c.importFiles ? [{ id: 'file.import', group: '파일', title: '파일 가져오기', shortcut: 'Ctrl+O', keywords: 'open import 열기', run: c.importFiles } satisfies Command] : []),
    { id: 'file.save', group: '파일', title: '저장', shortcut: 'Ctrl+S', keywords: 'save', when: hasDoc, run: c.save },

    // ---- 문서 ----
    { id: 'doc.history', group: '문서', title: '이전 버전 (이력)', keywords: 'history version 복구', when: hasDoc, run: c.history },
    { id: 'doc.md', group: '문서', title: '.md 파일로 저장', keywords: 'export markdown 내보내기', when: hasDoc, run: c.exportMd },
    { id: 'doc.copymd', group: '문서', title: '마크다운 텍스트 복사', keywords: 'copy clipboard 복사', when: hasDoc, run: c.copyMd },
    { id: 'doc.docx', group: '문서', title: '.docx 로 내보내기', keywords: 'word export 워드', when: hasDoc, run: c.exportDocx },
    { id: 'doc.print', group: '문서', title: '인쇄', shortcut: 'Ctrl+P', keywords: 'print pdf', when: hasDoc, run: c.print },
    ...(c.images ? [
      { id: 'doc.img64', group: '문서', title: '이미지를 Base64로 변환', keywords: 'image', when: hasDoc, run: () => c.images?.('base64') } satisfies Command,
      { id: 'doc.imgfile', group: '문서', title: '이미지를 파일로 분리', keywords: 'image assets', when: hasDoc, run: () => c.images?.('file') } satisfies Command,
    ] : []),
    { id: 'doc.mode', group: '문서', title: '읽기 / 편집 전환', shortcut: 'Ctrl+Alt+E', keywords: 'read edit mode 읽기모드', when: hasDoc, run: () => { doc.edit = !doc.edit; } },
    { id: 'doc.focus', group: '문서', title: '집중 모드 켜기 / 끄기', shortcut: 'Ctrl+Alt+Enter', keywords: 'focus zen 집중', run: () => toggleFocus() },

    // ---- 찾기 ----
    { id: 'find.doc', group: '찾기', title: '문서 안에서 찾기', shortcut: 'Ctrl+F', keywords: 'find search', when: hasDoc, run: () => { ui.findOpen = true; ui.findFocus++; } },
    { id: 'find.all', group: '찾기', title: '모든 문서에서 검색', shortcut: 'Ctrl+Shift+F', keywords: 'search global 전체검색', run: () => { ui.tab = 'search'; ui.globalFocus++; openLeft(); } },
    { id: 'find.snippet', group: '찾기', title: '선택한 문장과 관련된 글감 찾기', shortcut: 'Ctrl+Alt+G', keywords: 'snippet related 글감', when: hasDoc, run: findByEditorText },

    // ---- 글감·코멘트 ----
    { id: 'sn.add', group: '글감·코멘트', title: '선택한 문장을 글감으로 담기', shortcut: 'Ctrl+Alt+S', keywords: 'snippet add 포스트잇', when: hasDoc, run: () => void sendSelection() },
    { id: 'cm.add', group: '글감·코멘트', title: '선택한 문장에 코멘트 달기', shortcut: 'Ctrl+Alt+M', keywords: 'comment', when: hasDoc, run: startDraft },

    // ---- 보기 ----
    { id: 'view.left', group: '보기', title: '파일 목록 열기 / 숨기기', keywords: 'sidebar 사이드바 목록', run: () => toggleLeft() },
    { id: 'view.right', group: '보기', title: '글감·코멘트 패널 열기 / 숨기기', keywords: 'panel 사이드바 패널', run: () => toggleRight() },
    { id: 'view.light', group: '보기', title: '테마: 라이트', keywords: 'theme light 밝게', run: () => setTheme('light') },
    { id: 'view.dark', group: '보기', title: '테마: 다크', keywords: 'theme dark 어둡게', run: () => setTheme('dark') },
    { id: 'view.system', group: '보기', title: '테마: 시스템 설정 따르기', keywords: 'theme system auto', run: () => setTheme('system') },
    { id: 'app.settings', group: '앱', title: '설정', keywords: 'settings preferences 환경설정 디자인 테마 글꼴', run: c.settings },
    { id: 'app.backup', group: '앱', title: '백업 · 가져오기', keywords: 'backup import export 번들 복원', run: c.backup },

    // ---- 서식(편집기) ----
    fmt('bold', '굵게', 'bold', 'Ctrl+B', 'bold strong'),
    fmt('italic', '기울임', 'italic', 'Ctrl+I', 'italic emphasis'),
    fmt('code', '인라인 코드', 'code', 'Ctrl+E', 'code 코드'),
    fmt('strike', '취소선', 'strike', undefined, 'strikethrough'),
    fmt('h1', '제목 1', 'h1', undefined, 'heading h1'),
    fmt('h2', '제목 2', 'h2', undefined, 'heading h2'),
    fmt('h3', '제목 3', 'h3', undefined, 'heading h3'),
    fmt('p', '본문(문단)으로', 'paragraph', undefined, 'paragraph text'),
    fmt('quote', '인용', 'quote', undefined, 'blockquote'),
    fmt('bullet', '글머리 목록', 'bullet', undefined, 'bullet list ul'),
    fmt('ordered', '번호 목록', 'ordered', undefined, 'ordered list ol'),
    fmt('codeblock', '코드 블록', 'codeblock', undefined, 'code block'),
    fmt('hr', '구분선', 'hr', undefined, 'horizontal rule divider'),
    fmt('table', '표 삽입 (3×3)', 'table', undefined, 'table'),
    { id: 'fmt.tablelist', group: '서식', title: '목록·표 텍스트에서 표 만들기', keywords: 'table json yaml markdown list csv convert import 변환 표 목록 붙여넣기', when: canFormat, run: () => openListImport() },
    { id: 'fmt.codetable', group: '서식', title: '코드 블록(JSON·YAML·마크다운)을 표로 변환', keywords: 'table code block json yaml convert 코드 표 변환', when: canFormat, run: () => { const s = editorBridge.codeSource?.(); if (s) openListImport(s); else toast('커서를 JSON·YAML·마크다운 코드 블록 안에 두세요'); } },
  ];

  // 글 열기: 목록에 항상 깔면 명령이 묻히므로 검색어를 넣었을 때 팔레트가 합쳐 보여 준다(docCommands)
  return list;
}

/** 글 이동 명령: 검색어가 있을 때만 팔레트가 이 목록을 함께 검색한다 */
export function docCommands(c: Pick<AppCommandCtx, 'docs' | 'openDoc'>): Command[] {
  return c.docs().map((d) => ({ id: `open.${d.id}`, group: '글 열기', title: d.label, keywords: 'open go 이동', run: () => c.openDoc(d.id) }));
}
