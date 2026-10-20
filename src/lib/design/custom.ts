// 내 테마: 현재 디자인(팔레트 라이트·다크 + 타이포)에 이름을 붙여 이 기기에 저장해 두는 목록. 번들·내보내기에는 싣지 않는다
// (다른 기기로 옮기려면 '이식' 탭의 디자인 파일을 쓴다).
import { clampPalette, clampTypography, type Palette, type Typography } from './schema';
import { defaultDesign } from './io';

export interface CustomTheme { id: string; name: string; light: Palette; dark: Palette; typography: Typography; savedAt: number }

export const CUSTOM_KEY = 'works.design.custom';
export const CUSTOM_PREFIX = 'custom:';
const MAX_THEMES = 60;

export const isCustomId = (id: string | undefined): id is string => !!id && id.startsWith(CUSTOM_PREFIX);

export function cleanCustom(input: unknown): CustomTheme[] {
  if (!Array.isArray(input)) return [];
  const base = defaultDesign();
  const out: CustomTheme[] = [];
  for (const v of input) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (typeof o.id !== 'string' || !/^[\w-]{1,60}$/.test(o.id) || typeof o.name !== 'string') continue;
    out.push({
      id: o.id,
      name: o.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || '이름 없음',
      light: clampPalette(o.light, base.palettes.light),
      dark: clampPalette(o.dark, base.palettes.dark),
      typography: clampTypography(o.typography),
      savedAt: typeof o.savedAt === 'number' && Number.isFinite(o.savedAt) ? o.savedAt : 0,
    });
    if (out.length >= MAX_THEMES) break;
  }
  return out;
}

export function loadCustom(): CustomTheme[] {
  try {
    const t = localStorage.getItem(CUSTOM_KEY);
    return t ? cleanCustom(JSON.parse(t)) : [];
  } catch {
    return [];
  }
}

export function persistCustom(list: CustomTheme[]): void {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* 저장소를 못 쓰는 환경 */ }
}

export const newCustomId = (): string => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
