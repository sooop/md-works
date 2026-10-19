// 색 계산: 16진수 파싱, 혼합, WCAG 상대휘도·대비, 10색 팔레트에서 나머지 CSS 변수 파생
import type { Palette } from './schema';

export type RGB = [number, number, number];

/** '#rgb' / '#rrggbb' (# 생략 가능) → 소문자 '#rrggbb'. 형식이 틀리면 null */
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (s.startsWith('#')) s = s.slice(1);
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null;
}

export function hexToRgb(hex: string): RGB {
  const h = normalizeHex(hex) ?? '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** a 에 b 를 pct(0~100)% 섞은 색 */
export function mixHex(a: string, b: string, pct: number): string {
  const [ra, rb] = [hexToRgb(a), hexToRgb(b)];
  const t = Math.max(0, Math.min(100, pct)) / 100;
  return rgbToHex([0, 1, 2].map((i) => ra[i] + (rb[i] - ra[i]) * t) as RGB);
}

/** WCAG 2.x 상대휘도 (0~1) */
export function luminance(hex: string): number {
  const lin = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG 대비비 (1~21) */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const ON_LIGHT = '#ffffff';
const ON_DARK = '#1f1e1d';

/** primary 위에 올릴 글자색: 흰색과 어두운 색 중 대비가 큰 쪽 */
export function onColor(bg: string): string {
  return contrastRatio(ON_LIGHT, bg) >= contrastRatio(ON_DARK, bg) ? ON_LIGHT : ON_DARK;
}

/** 모드별 파생 비율(%). 기본 크림 팔레트의 현재 값에 맞춰 보정한 값이다 */
const MIX = {
  light: { surface2: 2.7, hover: 3.3, selected: 6.4, borderStrong: 12, tableLine: 59 },
  dark: { surface2: 3.6, hover: 2.4, selected: 9, borderStrong: 13, tableLine: 58 },
} as const;

/** 10색 팔레트 → 적용할 CSS 변수 전체(이름 → 값) */
export function derivePalette(p: Palette, mode: 'light' | 'dark'): Record<string, string> {
  const m = MIX[mode];
  return {
    '--bg': p.bg,
    '--surface': p.surface,
    '--surface-2': mixHex(p.surface, p.text, m.surface2),
    '--text': p.text,
    '--muted': p.muted,
    '--border': p.border,
    '--border-strong': mixHex(p.border, p.text, m.borderStrong),
    '--hover': mixHex(p.surface, p.text, m.hover),
    '--selected': mixHex(p.surface, p.text, m.selected),
    '--accent': p.accent,
    '--primary': p.primary,
    '--on-primary': onColor(p.primary),
    '--accent-soft': p.accentSoft,
    '--quote': p.quote,
    '--code-bg': p.codeBg,
    '--table-line': mixHex(p.border, p.muted, m.tableLine),
  };
}

export type ContrastWarning = { key: 'text' | 'muted' | 'primary'; ratio: number; need: number };

/** 가독성 기준 미달 항목. text/bg ≥ 4.5, muted/bg ≥ 3, on-primary/primary ≥ 4.5 */
export function contrastWarnings(p: Palette): ContrastWarning[] {
  const checks: ContrastWarning[] = [
    { key: 'text', ratio: contrastRatio(p.text, p.bg), need: 4.5 },
    { key: 'muted', ratio: contrastRatio(p.muted, p.bg), need: 3 },
    { key: 'primary', ratio: contrastRatio(onColor(p.primary), p.primary), need: 4.5 },
  ];
  return checks.filter((c) => c.ratio < c.need);
}

/** 이 값 미만의 대비가 되는 색 편집은 적용하지 않는다(패널 자체가 읽을 수 없게 되는 것을 막는다) */
export const MIN_APPLY_CONTRAST = 2;

/** 팔레트에서 가장 낮은 글자/바탕 대비: 본문-배경, 본문-표면, 보조-배경 */
export function minTextContrast(p: Palette): number {
  return Math.min(contrastRatio(p.text, p.bg), contrastRatio(p.text, p.surface), contrastRatio(p.muted, p.bg));
}

/**
 * 색 하나를 바꾸려 할 때 적용을 막아야 하면 그 대비비를, 아니면 null.
 * 바꾼 뒤 최저 대비가 2.0 미만이고 지금보다 나빠질 때만 막는다
 * (이미 낮은 팔레트에서 다른 색을 고치거나 대비를 개선하는 편집은 허용).
 */
export function contrastBlock(p: Palette, key: keyof Palette, hex: string, min = MIN_APPLY_CONTRAST): number | null {
  const next = normalizeHex(hex);
  if (!next) return null;
  const after = minTextContrast({ ...p, [key]: next });
  return after < min && after < minTextContrast(p) ? after : null;
}
