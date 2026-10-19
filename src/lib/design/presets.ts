// 내장 팔레트 프리셋. 각 프리셋은 라이트/다크 한 쌍. 'cream' 은 app.css 의 현재 값이다
import type { Palette } from './schema';

export interface Preset { id: string; name: string; light: Palette; dark: Palette }

export const PRESETS: Preset[] = [
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
    id: 'sepia', name: '세피아',
    light: { bg: '#f4ecd8', surface: '#ece2c8', text: '#433422', muted: '#6f5f48', border: '#ddd0b0', primary: '#9c4a1a', accent: '#c06a2b', accentSoft: '#ead3ac', quote: '#dccaa0', codeBg: '#ece2c8' },
    dark: { bg: '#2b241b', surface: '#342c21', text: '#eadfca', muted: '#b3a589', border: '#4a3f2f', primary: '#e0a060', accent: '#d08a45', accentSoft: '#4d3b25', quote: '#4f4333', codeBg: '#342c21' },
  },
  {
    id: 'night', name: '밤(푸른 강조)',
    light: { bg: '#f5f7fb', surface: '#eceff6', text: '#1b2030', muted: '#5b6479', border: '#d9deea', primary: '#2f55c8', accent: '#4f7bea', accentSoft: '#d9e3fb', quote: '#cbd4e8', codeBg: '#eceff6' },
    dark: { bg: '#12141a', surface: '#1a1d26', text: '#dfe3ee', muted: '#9aa3b8', border: '#2a2f3d', primary: '#7aa2ff', accent: '#5b8def', accentSoft: '#243457', quote: '#34405c', codeBg: '#1a1d26' },
  },
  {
    id: 'contrast', name: '고대비',
    light: { bg: '#ffffff', surface: '#f2f2f2', text: '#000000', muted: '#3a3a3a', border: '#595959', primary: '#0034b8', accent: '#7a1fa2', accentSoft: '#cfdcff', quote: '#595959', codeBg: '#ececec' },
    dark: { bg: '#000000', surface: '#111111', text: '#ffffff', muted: '#d0d0d0', border: '#8a8a8a', primary: '#ffd400', accent: '#5fd0ff', accentSoft: '#3a3300', quote: '#aaaaaa', codeBg: '#141414' },
  },
];

export const DEFAULT_PRESET_ID = 'cream';

export function getPreset(id: string | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
