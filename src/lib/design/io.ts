// 디자인 설정의 저장·불러오기·JSON 입출력 (DOM 에 의존하지 않는 순수 부분)
import { PALETTE_KEYS, DESIGN_SCHEMA, DESIGN_VERSION, TYPO_SPEC, clampTypography, clampPalette, clampNum, type Design, type Typography } from './schema';
import { PRESETS, DEFAULT_PRESET_ID, getPreset } from './presets';

export const DESIGN_KEY = 'works.design';
const LEGACY_SETTINGS_KEY = 'notes.settings';

export function defaultDesign(): Design {
  const p = PRESETS.find((x) => x.id === DEFAULT_PRESET_ID)!;
  return {
    typography: clampTypography({}),
    palettes: { light: { ...p.light }, dark: { ...p.dark } },
    presetId: p.id,
  };
}

export function cloneDesign(d: Design): Design {
  return JSON.parse(JSON.stringify(d)) as Design;
}

/** 어떤 값이든 안전한 Design 으로 보정 (없는 항목은 기본값) */
export function normalizeDesign(input: unknown): Design {
  const base = defaultDesign();
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const pal = (src.palettes && typeof src.palettes === 'object' ? src.palettes : {}) as Record<string, unknown>;
  const design: Design = {
    typography: clampTypography(src.typography),
    palettes: {
      light: clampPalette(pal.light, base.palettes.light),
      dark: clampPalette(pal.dark, base.palettes.dark),
    },
  };
  if (typeof src.presetId === 'string' && getPreset(src.presetId)) design.presetId = src.presetId;
  return design;
}

/** 옛 설정(notes.settings)의 글자 크기·본문 폭을 이관한다. 옛 기본값(16/860, v3 미만)은 사용자가 고른 값이 아니므로 버린다 */
export function migrateLegacySettings(raw: unknown): Partial<Typography> {
  if (!raw || typeof raw !== 'object') return {};
  const s = raw as Record<string, unknown>;
  const outdated = s.version !== 3;
  const out: Partial<Typography> = {};
  if (typeof s.fontSize === 'number' && !(outdated && s.fontSize === 16)) out.fontSize = clampNum(TYPO_SPEC.fontSize as never, s.fontSize);
  if (typeof s.contentWidth === 'number' && !(outdated && s.contentWidth === 860)) out.contentWidth = clampNum(TYPO_SPEC.contentWidth as never, s.contentWidth);
  return out;
}

function readJson(key: string): unknown {
  try {
    const t = localStorage.getItem(key);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

/** 저장된 디자인을 읽는다. 없으면 옛 설정을 이관한 기본 디자인 */
export function loadDesign(): Design {
  const stored = readJson(DESIGN_KEY);
  if (stored && typeof stored === 'object') return normalizeDesign(stored);
  const d = defaultDesign();
  d.typography = clampTypography({ ...d.typography, ...migrateLegacySettings(readJson(LEGACY_SETTINGS_KEY)) });
  return d;
}

export function saveDesign(d: Design): void {
  try {
    localStorage.setItem(DESIGN_KEY, JSON.stringify({ schema: DESIGN_SCHEMA, version: DESIGN_VERSION, ...d }));
  } catch { /* 저장소를 못 쓰는 환경 */ }
}

/** 디자인을 내보내기용 JSON 문자열로. 인자를 생략하면 저장돼 있는 현재 디자인 */
export function serializeDesign(d: Design = loadDesign()): string {
  const out: Record<string, unknown> = { schema: DESIGN_SCHEMA, version: DESIGN_VERSION, typography: d.typography, palettes: d.palettes };
  if (d.presetId) out.presetId = d.presetId;
  return JSON.stringify(out, null, 2);
}

/** JSON 문자열 검증. 형식 자체가 틀리면 오류, 개별 값이 틀리면 무시·클램프한다 */
export function parseDesign(text: string): { ok: true; value: Design } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON 형식이 아닙니다' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: '디자인 파일 형식이 아닙니다' };
  const o = data as Record<string, unknown>;
  if (o.schema !== DESIGN_SCHEMA) return { ok: false, error: 'md-works 디자인 파일이 아닙니다' };
  if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 1) return { ok: false, error: '버전 정보가 올바르지 않습니다' };
  if (o.version > DESIGN_VERSION) return { ok: false, error: `더 새로운 버전(v${o.version})의 파일입니다. 앱을 업데이트하세요` };
  for (const k of ['typography', 'palettes'] as const) {
    if (o[k] !== undefined && (o[k] === null || typeof o[k] !== 'object' || Array.isArray(o[k]))) return { ok: false, error: `'${k}' 항목이 올바르지 않습니다` };
  }
  if (o.typography === undefined && o.palettes === undefined) return { ok: false, error: '적용할 디자인 항목이 없습니다' };
  return { ok: true, value: normalizeDesign(o) };
}

export { PALETTE_KEYS };
