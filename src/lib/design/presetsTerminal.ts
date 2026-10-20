// 널리 쓰이는 터미널·에디터 테마를 글쓰기 화면에 맞게 옮긴 프리셋. 각 테마의 공식 팔레트에서 배경·글자·강조색을 가져오고,
// 본문 글자의 가독성(대비 4.5 이상)을 위해 보조 글자 등 일부 색은 조금 조정했다. 원 테마에 라이트/다크 한 쌍이 없으면 같은 계열로 짝을 만들었다.
import type { Palette } from './schema';

export interface TerminalPreset { id: string; name: string; light: Palette; dark: Palette }

const p = (bg: string, surface: string, text: string, muted: string, border: string, primary: string, accent: string, accentSoft: string, quote: string, codeBg: string): Palette =>
  ({ bg, surface, text, muted, border, primary, accent, accentSoft, quote, codeBg });

export const TERMINAL_PRESETS: TerminalPreset[] = [
  {
    id: 'dracula', name: 'Dracula',
    light: p('#f8f8f2', '#ecece3', '#282a36', '#565f8c', '#d8d8cc', '#6d4fc2', '#c2377f', '#e3dbf7', '#9aa3c8', '#ecece3'),
    dark: p('#282a36', '#21222c', '#f8f8f2', '#9aa5d6', '#44475a', '#bd93f9', '#ff79c6', '#44475a', '#6272a4', '#21222c'),
  },
  {
    id: 'solarized', name: 'Solarized',
    light: p('#fdf6e3', '#eee8d5', '#4f666d', '#657b83', '#ddd6c1', '#1f6fa8', '#cb4b16', '#e9dfc0', '#93a1a1', '#eee8d5'),
    dark: p('#002b36', '#073642', '#a3b0b0', '#839496', '#124a58', '#2f9be0', '#2aa198', '#0b4351', '#586e75', '#073642'),
  },
  {
    id: 'nord', name: 'Nord',
    light: p('#eceff4', '#e5e9f0', '#2e3440', '#4c566a', '#d8dee9', '#4a6d9a', '#81a1c1', '#d3deeb', '#c0c8d8', '#e5e9f0'),
    dark: p('#2e3440', '#3b4252', '#eceff4', '#a3aec4', '#434c5e', '#88c0d0', '#81a1c1', '#3f4a5e', '#4c566a', '#3b4252'),
  },
  {
    id: 'gruvbox', name: 'Gruvbox',
    light: p('#e9e4d6', '#ddd7c6', '#3c3836', '#625b52', '#cfc8b4', '#9d4a14', '#b8621f', '#e3d6b5', '#b3aa95', '#ddd7c6'), // 원래의 노란 바탕(#fbf1c7)을 눈이 덜 부시게 채도·밝기를 낮췄다
    dark: p('#282828', '#3c3836', '#ebdbb2', '#a89984', '#504945', '#fabd2f', '#fe8019', '#4a4130', '#665c54', '#32302f'),
  },
  {
    id: 'one', name: 'One (Atom)',
    light: p('#fafafa', '#f0f0f1', '#383a42', '#696c77', '#dbdbdc', '#3a6fe0', '#a626a4', '#dde6fb', '#c8c9cc', '#f0f0f1'),
    dark: p('#282c34', '#21252b', '#abb2bf', '#8b93a1', '#3a3f4b', '#61afef', '#c678dd', '#33445c', '#4b5263', '#21252b'),
  },
  {
    id: 'tokyonight', name: 'Tokyo Night',
    light: p('#e1e2e7', '#d5d6db', '#343b58', '#565e86', '#c4c8da', '#2a63b8', '#9854f1', '#c9d6f5', '#a8aecb', '#d5d6db'),
    dark: p('#1a1b26', '#24283b', '#c0caf5', '#8d97c4', '#2f334d', '#7aa2f7', '#bb9af7', '#2f3a5e', '#565f89', '#16161e'),
  },
  {
    id: 'catppuccin', name: 'Catppuccin',
    light: p('#eff1f5', '#e6e9ef', '#4c4f69', '#6c6f85', '#ccd0da', '#1e66f5', '#8839ef', '#d9e0f7', '#acb0be', '#e6e9ef'),
    dark: p('#1e1e2e', '#262637', '#cdd6f4', '#a6adc8', '#45475a', '#89b4fa', '#cba6f7', '#3b3f5c', '#6c7086', '#181825'),
  },
  {
    id: 'rosepine', name: 'Rosé Pine',
    light: p('#faf4ed', '#fffaf3', '#575279', '#797593', '#dfdad9', '#7a6494', '#b4637a', '#f2e2e0', '#cecacd', '#f2e9e1'),
    dark: p('#191724', '#1f1d2e', '#e0def4', '#9893b3', '#26233a', '#c4a7e7', '#eb6f92', '#33294a', '#6e6a86', '#1f1d2e'),
  },
  {
    id: 'monokai', name: 'Monokai',
    light: p('#fafaf5', '#efefe6', '#272822', '#6b6850', '#dddccf', '#4d7c0f', '#d6125c', '#ecefc8', '#b8b59d', '#efefe6'),
    dark: p('#272822', '#1e1f1c', '#f8f8f2', '#a59f85', '#3e3d32', '#a6e22e', '#f92672', '#49483e', '#75715e', '#1e1f1c'),
  },
];
