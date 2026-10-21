// 코드 블록 문법 강조: 필요한 언어만 골라 등록한다(언어별로 동적 로드).
// language-data 전체(약 100개)를 쓰지 않는 이유는 단일 HTML 번들 크기 때문이다.
import { HighlightStyle, LanguageDescription, LanguageSupport, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const stream = (parser: Parameters<typeof StreamLanguage.define>[0]) => new LanguageSupport(StreamLanguage.define(parser));

// .env 는 전용 문법이 없어 간단한 스트림 파서를 둔다: KEY=value, # 주석, export, 따옴표 값
interface EnvState { value: boolean; space: boolean }
const dotenv = {
  name: 'dotenv',
  startState: (): EnvState => ({ value: false, space: true }),
  token(s: import('@codemirror/language').StringStream, st: EnvState): string | null {
    if (s.sol()) { st.value = false; st.space = true; }
    if (s.eatSpace()) { st.space = true; return null; }
    const afterSpace = st.space;
    st.space = false;
    if (!st.value) {
      if (s.peek() === '#') { s.skipToEnd(); return 'comment'; }
      if (afterSpace && s.match(/^export(?=\s)/)) return 'keyword';
      if (s.match(/^[A-Za-z_][\w.-]*/)) return 'variableName';
      if (s.eat('=')) { st.value = true; st.space = false; return 'operator'; }
      s.next();
      return null;
    }
    const c = s.peek();
    if (c === '#' && afterSpace) { s.skipToEnd(); return 'comment'; }
    if (c === '"' || c === "'") {
      const q = s.next();
      let esc = false;
      let ch: string | void;
      while ((ch = s.next()) != null) {
        if (!esc && ch === q) break;
        esc = q === '"' && !esc && ch === '\\';
      }
      return 'string';
    }
    if (s.match(/^-?\d+(\.\d+)?(?=\s|$)/)) return 'number';
    if (s.match(/^\$\{?[A-Za-z_][\w]*\}?/)) return 'variableName';
    if (s.match(/^[^\s#$]+/)) return 'string';
    s.next();
    return null;
  },
};

const languageList: LanguageDescription[] = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js', 'jsx', 'mjs', 'cjs', 'node'],
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts', 'tsx'],
    extensions: ['ts', 'tsx', 'mts', 'cts'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true, jsx: true })),
  }),
  LanguageDescription.of({
    name: 'JSON',
    alias: ['jsonc', 'json5'],
    extensions: ['json', 'jsonc'],
    load: () => import('@codemirror/lang-json').then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['htm', 'xhtml'],
    extensions: ['html', 'htm'],
    load: () => import('@codemirror/lang-html').then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: 'CSS',
    extensions: ['css'],
    load: () => import('@codemirror/lang-css').then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: 'Markdown',
    alias: ['md', 'markdown'],
    extensions: ['md', 'markdown'],
    load: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  }),
  LanguageDescription.of({
    name: 'Python',
    alias: ['py', 'python3'],
    extensions: ['py', 'pyw'],
    load: () => import('@codemirror/lang-python').then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: 'SQL',
    alias: ['mysql', 'postgresql', 'pgsql', 'sqlite', 'tsql'],
    extensions: ['sql'],
    load: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  }),
  LanguageDescription.of({
    name: 'YAML',
    alias: ['yml'],
    extensions: ['yaml', 'yml'],
    load: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  }),
  LanguageDescription.of({
    name: 'XML',
    alias: ['xaml', 'svg', 'xsd', 'xslt', 'csproj'],
    extensions: ['xml', 'xaml', 'svg', 'xsd', 'xslt', 'csproj'],
    load: () => import('@codemirror/lang-xml').then((m) => m.xml()),
  }),
  LanguageDescription.of({
    name: 'C#',
    alias: ['csharp', 'cs'],
    extensions: ['cs'],
    load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => stream(m.csharp)),
  }),
  LanguageDescription.of({
    name: 'C',
    extensions: ['c', 'h'],
    load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  }),
  LanguageDescription.of({
    name: 'C++',
    alias: ['cpp', 'cc', 'cxx', 'hpp'],
    extensions: ['cpp', 'cc', 'cxx', 'hpp'],
    load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  }),
  LanguageDescription.of({
    name: 'Objective-C',
    alias: ['objc', 'obj-c', 'objectivec', 'objective-c'],
    extensions: ['m', 'mm'],
    load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => stream(m.objectiveC)),
  }),
  LanguageDescription.of({
    name: 'Swift',
    extensions: ['swift'],
    load: () => import('@codemirror/legacy-modes/mode/swift').then((m) => stream(m.swift)),
  }),
  LanguageDescription.of({
    name: 'Shell',
    alias: ['bash', 'sh', 'zsh', 'shell'],
    extensions: ['sh', 'bash', 'zsh'],
    load: () => import('@codemirror/legacy-modes/mode/shell').then((m) => stream(m.shell)),
  }),
  LanguageDescription.of({
    name: 'PowerShell',
    alias: ['ps1', 'pwsh', 'powershell'],
    extensions: ['ps1', 'psm1', 'psd1'],
    load: () => import('@codemirror/legacy-modes/mode/powershell').then((m) => stream(m.powerShell)),
  }),
  LanguageDescription.of({
    name: 'TOML',
    extensions: ['toml'],
    load: () => import('@codemirror/legacy-modes/mode/toml').then((m) => stream(m.toml)),
  }),
  LanguageDescription.of({
    name: '.env',
    alias: ['env', 'dotenv'],
    extensions: ['env'],
    load: async () => stream(dotenv),
  }),
  LanguageDescription.of({
    name: 'Diff',
    alias: ['patch'],
    extensions: ['diff', 'patch'],
    load: () => import('@codemirror/legacy-modes/mode/diff').then((m) => stream(m.diff)),
  }),
];

// Milkdown 의 언어 로더는 alias 로만 조회하고 name 은 보지 않는다.
// 그래서 ```python, ```css 처럼 name 과 같은 표기가 매칭되지 않으므로 소문자 name 을 alias 에 추가한다.
export const codeLanguages: LanguageDescription[] = languageList.map((l) =>
  LanguageDescription.of({
    name: l.name,
    alias: [...new Set([l.name.toLowerCase(), ...l.alias])],
    extensions: l.extensions,
    load: () => l.load(),
  }),
);

// 색은 CSS 변수(--hl-*)로 정의해 라이트/다크 테마와 함께 바뀐다 (app.css 참고)
const v = (name: string) => `var(--hl-${name})`;
export const codeHighlightStyle = HighlightStyle.define([
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: v('keyword') },
    { tag: [t.string, t.special(t.string), t.regexp, t.character, t.attributeValue], color: v('string') },
    { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: v('number') },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: v('comment'), fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName), t.labelName], color: v('function') },
    { tag: [t.typeName, t.className, t.namespace, t.standard(t.name)], color: v('type') },
    { tag: [t.propertyName, t.attributeName], color: v('property') },
    { tag: [t.tagName, t.angleBracket, t.meta, t.processingInstruction], color: v('tag') },
    { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: v('punct') },
    { tag: [t.link, t.url], color: v('function'), textDecoration: 'underline' },
    { tag: t.heading, color: v('keyword'), fontWeight: '700' },
    { tag: t.strong, fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: [t.inserted], color: v('inserted') },
    { tag: [t.deleted], color: v('deleted') },
    { tag: [t.changed], color: v('number') },
    { tag: t.escape, color: v('number') },
]);
export const codeHighlight = syntaxHighlighting(codeHighlightStyle);

// ---- 최근 고른 언어 5개를 선택기 목록 맨 위(현재 언어 바로 아래)에 둔다 ----
// Milkdown 선택기는 이 배열의 순서대로 목록을 만들고 현재 언어만 맨 앞으로 올리므로, 배열 순서를 제자리에서 바꾼다.
const RECENT_KEY = 'md-works.recentCodeLangs';
const RECENT_MAX = 5;

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

let recent = loadRecent();
const baseOrder = codeLanguages.map((l) => l.name);

function applyRecentOrder() {
  const rank = (name: string) => { const i = recent.indexOf(name); return i < 0 ? recent.length + baseOrder.indexOf(name) : i; };
  codeLanguages.sort((a, b) => rank(a.name) - rank(b.name));
}
applyRecentOrder();

/** 선택기에서 언어를 골랐을 때 부른다(이름은 data-language 값) */
export function noteLanguage(name: string) {
  if (!baseOrder.includes(name)) return;
  recent = [name, ...recent.filter((n) => n !== name)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* 저장 불가 */ }
  applyRecentOrder();
}
