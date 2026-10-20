// 색 변주·랜덤 테마 생성(순수 함수). 모든 결과는 글자 대비 기준을 지키도록 마지막에 보정한다.
// - varyPalette: 지금 팔레트의 색조·채도·밝기를 조금씩 흔든다(분위기는 유지, 약간의 변화)
// - randomTheme: 하나의 색조(+조화 규칙)에서 라이트·다크 한 쌍을 새로 만든다. 눈이 편하도록 바탕 채도는 낮게 둔다.
import { PALETTE_KEYS, type Palette, type PaletteKey } from './schema';
import { hexToRgb, rgbToHex, contrastRatio, onColor, normalizeHex } from './colors';

export type Rng = () => number;

/** 같은 시드면 같은 수열(재현 가능한 '다시 뽑기'와 테스트용) */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- HSL / HSV 변환 (h: 0~360, s·l·v: 0~100) ----
export type HSL = [number, number, number];

export function hexToHsl(hex: string): HSL {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d > 1e-9) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

export function hslToHex([h, s, l]: HSL): string {
  const S = Math.max(0, Math.min(100, s)) / 100, L = Math.max(0, Math.min(100, l)) / 100;
  const H = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] = H < 60 ? [c, x, 0] : H < 120 ? [x, c, 0] : H < 180 ? [0, c, x] : H < 240 ? [0, x, c] : H < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

export function hexToHsv(hex: string): HSL {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-9) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : (d / max) * 100, max * 100];
}

export function hsvToHex([h, s, v]: HSL): string {
  const S = Math.max(0, Math.min(100, s)) / 100, V = Math.max(0, Math.min(100, v)) / 100;
  const H = ((h % 360) + 360) % 360;
  const c = V * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = V - c;
  const [r, g, b] = H < 60 ? [c, x, 0] : H < 120 ? [x, c, 0] : H < 180 ? [0, c, x] : H < 240 ? [0, x, c] : H < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const hsl = (h: number, s: number, l: number) => hslToHex([h, clamp(s, 0, 100), clamp(l, 0, 100)]);

// ---- 대비 보정 ----
/** 색 하나의 밝기(HSL L)를 against 와의 대비가 need 이상이 될 때까지 밝은 쪽/어두운 쪽으로 민다 */
function pushContrast(hex: string, against: string, need: number, towardLight: boolean): string {
  let [h, s, l] = hexToHsl(hex);
  for (let i = 0; i < 80 && contrastRatio(hslToHex([h, s, l]), against) < need; i++) l += towardLight ? 1 : -1;
  return hslToHex([h, s, clamp(l, 0, 100)]);
}

/** 팔레트가 가독성 기준을 지키게 보정: 본문 ≥ textMin, 보조 글자 ≥ mutedMin, 강조(primary) 위의 글자 ≥ 4.5, primary/배경 ≥ 3 */
export function fixPalette(p: Palette, mode: 'light' | 'dark', textMin = 7, mutedMin = 4.5): Palette {
  const out: Palette = { ...p };
  const lightText = mode === 'dark';
  out.text = pushContrast(out.text, out.bg, textMin, lightText);
  // 표면(패널) 위에서도 읽혀야 한다
  out.text = pushContrast(out.text, out.surface, Math.min(textMin, 6), lightText);
  out.muted = pushContrast(out.muted, out.bg, mutedMin, lightText);
  out.primary = pushContrast(out.primary, out.bg, 3.2, lightText);
  // primary 위 글자: onColor 가 흰색/어두운색 중 큰 쪽이라 4.5 가 안 되면 primary 를 한 쪽으로 더 민다
  for (let i = 0; i < 60 && contrastRatio(onColor(out.primary), out.primary) < 4.5; i++) {
    const [h, s, l] = hexToHsl(out.primary);
    out.primary = hslToHex([h, s, clamp(l + (lightText ? 1 : -1), 0, 100)]);
  }
  return out;
}

// ---- 변주 ----
export type VaryStrength = 'low' | 'mid' | 'high';
const STRENGTH: Record<VaryStrength, { hue: number; sat: number; light: number }> = {
  low: { hue: 8, sat: 4, light: 2 },
  mid: { hue: 18, sat: 8, light: 4 },
  high: { hue: 36, sat: 14, light: 7 },
};

/**
 * 팔레트에 약간의 무작위 변화를 준다. 모든 색을 같은 각도로 돌리고(조화 유지) 색마다 채도·밝기를 조금 흔든다.
 * 글자색 계열은 밝기를 거의 흔들지 않고, 마지막에 가독성 기준으로 보정한다.
 */
export function varyPalette(p: Palette, mode: 'light' | 'dark', rng: Rng, strength: VaryStrength = 'mid'): Palette {
  const st = STRENGTH[strength];
  const rot = (rng() * 2 - 1) * st.hue;
  const out = {} as Palette;
  for (const k of PALETTE_KEYS) {
    const [h, s, l] = hexToHsl(p[k]);
    const isText = k === 'text' || k === 'muted';
    const dl = (rng() * 2 - 1) * st.light * (isText ? 0.3 : 1);
    const ds = (rng() * 2 - 1) * st.sat;
    // 거의 무채색(s<4)인 색은 색조를 돌려도 의미가 없어 채도를 살짝 더해 준다
    out[k] = hsl(h + rot, s < 4 ? s + Math.abs(ds) * 0.5 : s + ds, l + dl);
  }
  return fixPalette(out, mode, 7, 4.5);
}

// ---- 랜덤 테마 ----
const HARMONY = [30, 150, 180, 210] as const;

export interface RandomTheme { light: Palette; dark: Palette; hue: number; accentHue: number }

/** 시드(rng)에서 라이트·다크 한 쌍을 만든다. 바탕은 저채도(눈이 편함), 강조색만 비교적 선명하다 */
export function randomTheme(rng: Rng): RandomTheme {
  const hue = Math.floor(rng() * 360);
  const accentHue = (hue + HARMONY[Math.floor(rng() * HARMONY.length)]) % 360;
  const baseSat = 6 + rng() * 8; // 바탕 채도 6~14%
  const accSat = 42 + rng() * 22; // 강조 채도 42~64%

  const light: Palette = {
    bg: hsl(hue, baseSat, 91 + rng() * 3),
    surface: hsl(hue, baseSat, 86 + rng() * 2),
    text: hsl(hue, 14 + rng() * 6, 15 + rng() * 5),
    muted: hsl(hue, 10 + rng() * 6, 36 + rng() * 6),
    border: hsl(hue, baseSat, 78 + rng() * 3),
    primary: hsl(accentHue, accSat, 33 + rng() * 6),
    accent: hsl(accentHue, accSat, 48 + rng() * 6),
    accentSoft: hsl(accentHue, 38 + rng() * 10, 84 + rng() * 3),
    quote: hsl(hue, baseSat, 70 + rng() * 5),
    codeBg: hsl(hue, baseSat, 86 + rng() * 2),
  };
  const dark: Palette = {
    bg: hsl(hue, baseSat * 0.9, 11 + rng() * 5),
    surface: hsl(hue, baseSat * 0.9, 15 + rng() * 3),
    text: hsl(hue, 8 + rng() * 8, 84 + rng() * 4),
    muted: hsl(hue, 8 + rng() * 6, 62 + rng() * 6),
    border: hsl(hue, baseSat * 0.9, 24 + rng() * 4),
    primary: hsl(accentHue, accSat, 68 + rng() * 6),
    accent: hsl(accentHue, accSat, 60 + rng() * 6),
    accentSoft: hsl(accentHue, 26 + rng() * 10, 22 + rng() * 4),
    quote: hsl(hue, baseSat, 32 + rng() * 5),
    codeBg: hsl(hue, baseSat * 0.9, 9 + rng() * 4),
  };
  return { light: fixPalette(light, 'light'), dark: fixPalette(dark, 'dark'), hue, accentHue };
}

/** 색 하나를 바탕에 pct% 섞은 불투명한 색(투명도 대신: 팔레트는 불투명한 색만 저장한다) */
export function blendOver(bg: string, color: string, pct: number): string {
  const a = hexToRgb(bg), b = hexToRgb(color);
  const t = clamp(pct, 0, 100) / 100;
  return rgbToHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as [number, number, number]);
}

export { normalizeHex };
export type { PaletteKey };
