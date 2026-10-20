// 내장 팔레트 프리셋. 각 프리셋은 라이트/다크 한 쌍. 'cream' 은 app.css 의 현재 값이다
import type { Palette } from './schema';
import { TERMINAL_PRESETS } from './presetsTerminal';

export type PresetGroup = 'basic' | 'terminal';
export interface Preset { id: string; name: string; group: PresetGroup; light: Palette; dark: Palette }

const BASIC: Omit<Preset, 'group'>[] = [
  {
    id: 'cream', name: '크림(기본)',
    light: { bg: '#faf9f5', surface: '#f5f4ed', text: '#141413', muted: '#6b6a64', border: '#e8e6dc', primary: '#b45434', accent: '#d97757', accentSoft: '#f3dcd2', quote: '#e8e6dc', codeBg: '#f5f4ed' },
    dark: { bg: '#262624', surface: '#2e2e2b', text: '#f0eee6', muted: '#a6a59c', border: '#3d3c38', primary: '#e8956f', accent: '#d97757', accentSoft: '#4a352c', quote: '#403f3a', codeBg: '#2e2e2b' },
  },
  {
    id: 'paper', name: '종이(흰색·중성)',
    light: { bg: '#ffffff', surface: '#f6f6f6', text: '#1a1a1a', muted: '#666666', border: '#e4e4e4', primary: '#3b5bdb', accent: '#5c7cfa', accentSoft: '#dbe4ff', quote: '#d0d0d0', codeBg: '#f4f4f4' },
    dark: { bg: '#1c1c1e', surface: '#242426', text: '#ececec', muted: '#a0a0a5', border: '#38383a', primary: '#8da2fb', accent: '#748ffc', accentSoft: '#2b3452', quote: '#48484a', codeBg: '#242426' },
  },
  {
    id: 'sepia', name: '세피아(순한)',
    light: { bg: '#ebe4d6', surface: '#e0d8c7', text: '#3d352b', muted: '#625644', border: '#cfc6b2', primary: '#8a4a26', accent: '#a8693a', accentSoft: '#dccdb2', quote: '#bfb49b', codeBg: '#e0d8c7' },
    dark: { bg: '#2a2621', surface: '#322d27', text: '#e2d9c8', muted: '#a99d86', border: '#463f34', primary: '#d79a68', accent: '#c58750', accentSoft: '#473a29', quote: '#4f4637', codeBg: '#322d27' },
  },
  {
    id: 'night', name: '밤(푸른 강조)',
    light: { bg: '#f5f7fb', surface: '#eceff6', text: '#1b2030', muted: '#5b6479', border: '#d9deea', primary: '#2f55c8', accent: '#4f7bea', accentSoft: '#d9e3fb', quote: '#cbd4e8', codeBg: '#eceff6' },
    dark: { bg: '#12141a', surface: '#1a1d26', text: '#dfe3ee', muted: '#9aa3b8', border: '#2a2f3d', primary: '#7aa2ff', accent: '#5b8def', accentSoft: '#243457', quote: '#34405c', codeBg: '#1a1d26' },
  },
  {
    id: 'moss', name: '이끼(차분한 녹회색)',
    light: { bg: '#e7ebe4', surface: '#dde3d9', text: '#2b352e', muted: '#56635a', border: '#cbd3c6', primary: '#3f6b4f', accent: '#5f8a6c', accentSoft: '#cddccf', quote: '#aebaa9', codeBg: '#dde3d9' },
    dark: { bg: '#1e2420', surface: '#262d28', text: '#d4dad5', muted: '#96a39a', border: '#36403a', primary: '#8fbf9f', accent: '#6fa583', accentSoft: '#2f4036', quote: '#4a5a4f', codeBg: '#1a1f1c' },
  },
  {
    id: 'mist', name: '안개(차가운 회청색)',
    light: { bg: '#e6e9ed', surface: '#dce0e6', text: '#2a2f38', muted: '#566070', border: '#c8ced8', primary: '#3f5f8a', accent: '#6585b0', accentSoft: '#cfd9e8', quote: '#aab4c4', codeBg: '#dce0e6' },
    dark: { bg: '#1f2329', surface: '#272c33', text: '#d0d5dc', muted: '#929ba8', border: '#353b44', primary: '#8fb0dc', accent: '#6f94c4', accentSoft: '#2c3a4e', quote: '#4a5463', codeBg: '#1b1e23' },
  },
  {
    id: 'graphite', name: '흑연(저채도 중립)',
    light: { bg: '#e9e9e8', surface: '#dfdfde', text: '#2b2b2b', muted: '#5c5c5c', border: '#cdcdcc', primary: '#496580', accent: '#7a8794', accentSoft: '#d4d9de', quote: '#b0b0af', codeBg: '#dfdfde' },
    dark: { bg: '#202124', surface: '#28292d', text: '#d2d3d6', muted: '#9a9ba0', border: '#38393e', primary: '#9bb4cf', accent: '#7f93a8', accentSoft: '#323a44', quote: '#4c4d52', codeBg: '#1c1d20' },
  },
  {
    id: 'contrast', name: '고대비',
    light: { bg: '#ffffff', surface: '#f2f2f2', text: '#000000', muted: '#3a3a3a', border: '#595959', primary: '#0034b8', accent: '#7a1fa2', accentSoft: '#cfdcff', quote: '#595959', codeBg: '#ececec' },
    dark: { bg: '#000000', surface: '#111111', text: '#ffffff', muted: '#d0d0d0', border: '#8a8a8a', primary: '#ffd400', accent: '#5fd0ff', accentSoft: '#3a3300', quote: '#aaaaaa', codeBg: '#141414' },
  },
];

export const PRESETS: Preset[] = [
  ...BASIC.map((p) => ({ ...p, group: 'basic' as const })),
  ...TERMINAL_PRESETS.map((p) => ({ ...p, group: 'terminal' as const })),
];

export const DEFAULT_PRESET_ID = 'cream';

export function getPreset(id: string | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
