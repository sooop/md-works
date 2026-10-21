// 코드 블록 문법 강조 테마. 색은 CSS 변수 --hl-* 11개이므로 테마는 라이트·다크 한 쌍의 색 표일 뿐이다.
// 디자인 프리셋과는 독립된 선택이지만, 기본값('auto')은 내장 프리셋에 짝지은 테마를 따라간다.
import { normalizeHex } from './colors';

export const HL_KEYS = ['keyword', 'string', 'number', 'comment', 'function', 'type', 'property', 'tag', 'punct', 'inserted', 'deleted'] as const;
export type HlKey = (typeof HL_KEYS)[number];
export type HlPalette = Record<HlKey, string>;

export const HL_LABELS: Record<HlKey, string> = {
  keyword: '키워드', string: '문자열', number: '숫자·상수', comment: '주석', function: '함수', type: '타입·클래스',
  property: '속성', tag: '태그', punct: '구두점', inserted: '추가(diff)', deleted: '삭제(diff)',
};

export interface CodeTheme { id: string; name: string; light: HlPalette; dark: HlPalette }

const h = (keyword: string, string: string, number: string, comment: string, fn: string, type: string, property: string, tag: string, punct: string, inserted: string, deleted: string): HlPalette =>
  ({ keyword, string, number, comment, function: fn, type, property, tag, punct, inserted, deleted });

/** 기본: app.css 의 현재 값(크림 프리셋과 같은 계열) */
export const DEFAULT_CODE_THEME_ID = 'default';

export const CODE_THEMES: CodeTheme[] = [
  {
    id: 'default', name: '기본',
    light: h('#b3471f', '#3b7a3a', '#8f5b00', '#8a8980', '#2b5fb0', '#8a3d8f', '#1b6f78', '#b3471f', '#6b6a64', '#2f7d32', '#b3261e'),
    dark: h('#e8956f', '#a3c98a', '#e0b46a', '#8d8c84', '#8fb4e8', '#d49fd4', '#7fcdd3', '#e8956f', '#a6a59c', '#8fcf8f', '#f2a49c'),
  },
  {
    id: 'dracula', name: 'Dracula',
    light: h('#b8326e', '#6b6b0a', '#6d4fc2', '#6b738f', '#1a7a38', '#0b7a96', '#a85a00', '#b8326e', '#5a5d70', '#1a7a35', '#c42b2b'),
    dark: h('#ff79c6', '#f1fa8c', '#bd93f9', '#7a85b8', '#50fa7b', '#8be9fd', '#ffb86c', '#ff79c6', '#c0c2d6', '#50fa7b', '#ff5555'),
  },
  {
    id: 'solarized', name: 'Solarized',
    light: h('#667700', '#1d8a82', '#b5410f', '#5f737a', '#1f78b4', '#946f00', '#5a5fb0', '#b5410f', '#586e75', '#5f7000', '#c42a27'),
    dark: h('#9aae1a', '#35b5ab', '#e0693a', '#6f8890', '#4aa3e0', '#d0a21a', '#8a8fe0', '#e0693a', '#839496', '#a0b020', '#f0605d'),
  },
  {
    id: 'nord', name: 'Nord',
    light: h('#4c6f9a', '#4a7a3a', '#8a5f8a', '#6b7690', '#3b7a94', '#3d7d7b', '#4c566a', '#4c6f9a', '#4c566a', '#3f7a3a', '#b0404b'),
    dark: h('#81a1c1', '#a3be8c', '#b48ead', '#8f9bb3', '#88c0d0', '#8fbcbb', '#d8dee9', '#81a1c1', '#c0c8d8', '#a3be8c', '#d9808a'),
  },
  {
    id: 'gruvbox', name: 'Gruvbox',
    light: h('#9d0006', '#79740e', '#8f3f71', '#6b6258', '#427b58', '#8a5a00', '#076678', '#af3a03', '#5c5444', '#5f6b0a', '#9d0006'),
    dark: h('#fb4934', '#b8bb26', '#d3869b', '#928374', '#8ec07c', '#fabd2f', '#83a598', '#fe8019', '#a89984', '#b8bb26', '#fb4934'),
  },
  {
    id: 'one', name: 'One (Atom)',
    light: h('#a626a4', '#3f8a3e', '#986801', '#6f7380', '#2c63d9', '#a06b00', '#c8423a', '#c8423a', '#383a42', '#3f8a3e', '#c8423a'),
    dark: h('#c678dd', '#98c379', '#d19a66', '#7f8796', '#61afef', '#e5c07b', '#e06c75', '#e06c75', '#abb2bf', '#98c379', '#e06c75'),
  },
  {
    id: 'tokyonight', name: 'Tokyo Night',
    light: h('#7847bd', '#4b7a1f', '#b05a1f', '#5f6788', '#2a5bb5', '#0f7b99', '#1a7f6e', '#c0334f', '#4a5174', '#3a7a1a', '#c0334f'),
    dark: h('#bb9af7', '#9ece6a', '#ff9e64', '#6b7399', '#7aa2f7', '#2ac3de', '#73daca', '#f7768e', '#a9b1d6', '#9ece6a', '#f7768e'),
  },
  {
    id: 'catppuccin', name: 'Catppuccin',
    light: h('#8839ef', '#3f8a2e', '#c4590c', '#6c6f85', '#1b5fe0', '#a06a00', '#137c82', '#d20f39', '#4c4f69', '#3f8a2e', '#d20f39'),
    dark: h('#cba6f7', '#a6e3a1', '#fab387', '#7f849c', '#89b4fa', '#f9e2af', '#94e2d5', '#f38ba8', '#bac2de', '#a6e3a1', '#f38ba8'),
  },
  {
    id: 'rosepine', name: 'Rosé Pine',
    light: h('#b4637a', '#a06a10', '#b5574f', '#7d7794', '#7a5aa0', '#286983', '#3a7f8e', '#b4637a', '#575279', '#3e7d4a', '#b4344f'),
    dark: h('#eb6f92', '#f6c177', '#ebbcba', '#7f7a99', '#c4a7e7', '#9ccfd8', '#7fb8c4', '#eb6f92', '#908caa', '#9ccfd8', '#eb6f92'),
  },
  {
    id: 'monokai', name: 'Monokai',
    light: h('#d6125c', '#8a7b00', '#7a4bd1', '#6b6850', '#4d7c0f', '#0b7285', '#b45f06', '#d6125c', '#4a4a40', '#4d7c0f', '#c0123c'),
    dark: h('#f92672', '#e6db74', '#ae81ff', '#8f8b73', '#a6e22e', '#66d9ef', '#fd971f', '#f92672', '#c8c8c0', '#a6e22e', '#f92672'),
  },
];

export const getCodeTheme = (id: string): CodeTheme | undefined => CODE_THEMES.find((t) => t.id === id);

/** 디자인 프리셋에 짝지은 코드 테마. 같은 id 의 테마가 있으면 그것, 없으면 기본 */
export const pairedCodeTheme = (presetId: string | undefined): string =>
  presetId && CODE_THEMES.some((t) => t.id === presetId) ? presetId : DEFAULT_CODE_THEME_ID;

/** 팔레트 보정: 형식이 틀린 색은 fallback 의 값으로 */
export function cleanHl(input: unknown, fallback: HlPalette): HlPalette {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const out = {} as HlPalette;
  for (const k of HL_KEYS) out[k] = normalizeHex(src[k]) ?? fallback[k];
  return out;
}

const decls = (p: HlPalette) => HL_KEYS.map((k) => `--hl-${k}:${p[k]}`).join(';');

/** 테마를 CSS 텍스트로. 인쇄는 app.css 의 고정 색을 쓰도록 모두 @media screen 안에 둔다. 기본 테마는 app.css 값 그대로라 빈 문자열 */
export function buildCodeThemeCss(t: CodeTheme): string {
  if (t.id === DEFAULT_CODE_THEME_ID) return '';
  return `@media screen{html:root{${decls(t.light)}}html:root[data-theme='dark']{${decls(t.dark)}}}`;
}
