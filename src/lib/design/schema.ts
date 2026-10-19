// 디자인 설정 스키마: 타이포·팔레트 타입, 범위·기본값, 클램프(범위 밖 값 보정)
import { normalizeHex } from './colors';

export const DESIGN_SCHEMA = 'md-works-design';
export const DESIGN_VERSION = 1;

export const PALETTE_KEYS = ['bg', 'surface', 'text', 'muted', 'border', 'primary', 'accent', 'accentSoft', 'quote', 'codeBg'] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type Palette = Record<PaletteKey, string>;

export const PALETTE_LABELS: Record<PaletteKey, string> = {
  bg: '배경', surface: '패널', text: '글자', muted: '보조 글자', border: '테두리',
  primary: '강조(링크·버튼)', accent: '보조 강조', accentSoft: '선택 배경', quote: '인용문 선·표식', codeBg: '코드 배경',
};

export type Align = 'left' | 'justify';

export interface Typography {
  bodyFont: string; // 빈 값이면 기본(--font)
  headingFont: string; // 빈 값이면 본문과 동일
  fontSize: number; // px
  lineHeight: number; // 배수
  letterSpacing: number; // em
  bodyWeight: number; // 본문 굵기 100~900
  headingWeight: number; // 제목 굵기 100~900, 0 = 기본(H1·H2 700, H3~H6 600)
  boldWeight: number; // 굵게(**강조**) 굵기 100~900
  paragraphGap: number; // em (문단 위·아래 각각)
  indent: number; // em, 0 = 없음
  align: Align;
  contentWidth: number; // px, 0 = 전체
  h1Scale: number; h2Scale: number; h3Scale: number; h4Scale: number; h5Scale: number; h6Scale: number;
  h1Before: number; h2Before: number; h3Before: number; h4Before: number; h5Before: number; h6Before: number;
  h1After: number; h2After: number; h3After: number; h4After: number; h5After: number; h6After: number;
  quoteBar: number; // px
  quoteUseColor: boolean;
  quoteBg: boolean;
  quoteItalic: boolean;
  codeFont: string; // 빈 값이면 기본(--font-code)
  codeScale: number; // 본문 대비 배율
  tableStripe: boolean;
  cellPadY: number; // px
  cellPadX: number; // px
}
export type TypoKey = keyof Typography;

export interface Design {
  typography: Typography;
  palettes: { light: Palette; dark: Palette };
  presetId?: string;
}

export type NumSpec = { kind: 'num'; min: number; max: number; step: number; def: number; zeroOk?: boolean };
export type BoolSpec = { kind: 'bool'; def: boolean };
export type StrSpec = { kind: 'str'; def: string; max: number };
export type EnumSpec = { kind: 'enum'; def: string; values: readonly string[] };
export type Spec = NumSpec | BoolSpec | StrSpec | EnumSpec;

const num = (min: number, max: number, step: number, def: number, zeroOk = false): NumSpec => ({ kind: 'num', min, max, step, def, zeroOk });

// 제목 기본값: 현재 app.css 의 h1~h6 (크기 em, 위·아래 여백은 px ÷ 15 로 환산한 본문 글자 크기 배수)
const H_SCALE = [1.75, 1.4, 1.125, 1.05, 1, 0.9];
const H_BEFORE = [1.867, 1.6, 1.333, 1.067, 0.8, 0.8];
const H_AFTER = [0.8, 0.667, 0.533, 0.4, 0.267, 0.267];

const headingSpecs = (): Record<string, Spec> => {
  const s: Record<string, Spec> = {};
  for (let i = 0; i < 6; i++) {
    s[`h${i + 1}Scale`] = num(0.8, 3, 0.05, H_SCALE[i]);
    s[`h${i + 1}Before`] = num(0, 4, 0.05, H_BEFORE[i]);
    s[`h${i + 1}After`] = num(0, 4, 0.05, H_AFTER[i]);
  }
  return s;
};

/** 모든 타이포 항목의 범위·기본값. UI 와 클램프가 같은 표를 쓴다 */
export const TYPO_SPEC = {
  bodyFont: { kind: 'str', def: '', max: 200 },
  headingFont: { kind: 'str', def: '', max: 200 },
  fontSize: num(12, 24, 1, 15),
  lineHeight: num(1.2, 2.4, 0.05, 1.5),
  letterSpacing: num(-0.05, 0.2, 0.005, 0),
  bodyWeight: num(100, 900, 100, 400),
  headingWeight: num(100, 900, 100, 0, true),
  boldWeight: num(100, 900, 100, 700),
  paragraphGap: num(0, 2, 0.05, 0.4),
  indent: num(0, 4, 0.1, 0),
  align: { kind: 'enum', def: 'left', values: ['left', 'justify'] },
  contentWidth: num(480, 1600, 20, 980, true),
  ...headingSpecs(),
  quoteBar: num(0, 12, 1, 4),
  quoteUseColor: { kind: 'bool', def: true },
  quoteBg: { kind: 'bool', def: false },
  quoteItalic: { kind: 'bool', def: false },
  codeFont: { kind: 'str', def: '', max: 200 },
  codeScale: num(0.7, 1.3, 0.01, 0.93),
  tableStripe: { kind: 'bool', def: false },
  cellPadY: num(0, 20, 1, 4),
  cellPadX: num(0, 40, 1, 10),
} as unknown as Record<TypoKey, Spec>;

export const TYPO_KEYS = Object.keys(TYPO_SPEC) as TypoKey[];

export function defaultTypography(): Typography {
  const t: Record<string, unknown> = {};
  for (const k of TYPO_KEYS) t[k] = TYPO_SPEC[k].def;
  return t as unknown as Typography;
}
export const DEFAULT_TYPOGRAPHY: Readonly<Typography> = Object.freeze(defaultTypography());

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** 숫자 하나를 범위로 보정. 숫자가 아니면 기본값. zeroOk 항목은 0 을 그대로 허용 */
export function clampNum(spec: NumSpec, v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return spec.def;
  if (spec.zeroOk && n === 0) return 0;
  return r3(Math.min(spec.max, Math.max(spec.min, n)));
}

function cleanStr(spec: StrSpec, v: unknown): string {
  if (typeof v !== 'string') return spec.def;
  return v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, spec.max);
}

/** 임의의 값(부분 객체 가능)을 완전한 Typography 로 만든다. 없는 항목은 기본값, 범위 밖은 클램프, 알 수 없는 키는 버린다 */
export function clampTypography(input: unknown): Typography {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const k of TYPO_KEYS) {
    const spec = TYPO_SPEC[k];
    const v = src[k];
    if (spec.kind === 'num') out[k] = clampNum(spec, v);
    else if (spec.kind === 'bool') out[k] = typeof v === 'boolean' ? v : spec.def;
    else if (spec.kind === 'str') out[k] = cleanStr(spec, v);
    else out[k] = typeof v === 'string' && spec.values.includes(v) ? v : spec.def;
  }
  return out as unknown as Typography;
}

/** 팔레트 보정: 형식이 틀린 색은 fallback 의 값으로 대체 */
export function clampPalette(input: unknown, fallback: Palette): Palette {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const out = {} as Palette;
  for (const k of PALETTE_KEYS) out[k] = normalizeHex(src[k]) ?? fallback[k];
  return out;
}
