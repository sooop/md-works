// 디자인 설정의 반응형 상태. 패널과 앱 시작(main.ts)이 공유한다
import { loadDesign, saveDesign, cloneDesign, normalizeDesign, defaultDesign } from './io';
import { applyDesign } from './apply';
import { getPreset } from './presets';
import type { Design, PaletteKey, TypoKey, Typography } from './schema';
import { clampTypography } from './schema';
import { normalizeHex } from './colors';
import { loadCustom, persistCustom, newCustomId, CUSTOM_PREFIX, isCustomId, type CustomTheme } from './custom';

export const design: Design = $state(loadDesign());

/** 가져오기·프리셋 교체 직전 상태 (되돌리기 1단계) */
export const undoState: { prev: Design | null } = $state({ prev: null });

function commit() {
  applyDesign(design);
  saveDesign(design);
}

/** 앱 시작 시 한 번 호출해 저장된 디자인을 적용한다 */
export function applyStoredDesign() {
  applyDesign(design);
}

function replace(next: Design) {
  design.typography = next.typography;
  design.palettes = next.palettes;
  design.presetId = next.presetId;
}

export function setTypo<K extends TypoKey>(key: K, value: Typography[K]) {
  design.typography = clampTypography({ ...design.typography, [key]: value });
  commit();
}

export function setColor(mode: 'light' | 'dark', key: PaletteKey, value: string) {
  const hex = normalizeHex(value);
  if (!hex) return;
  design.palettes[mode][key] = hex;
  commit();
}

/** 내 테마 목록(이 기기에만 저장) */
export const customs: CustomTheme[] = $state(loadCustom());

/** 프리셋 선택: 라이트·다크 팔레트를 함께 교체. 내 테마('custom:…')는 타이포도 함께 되돌린다 */
export function selectPreset(id: string) {
  if (isCustomId(id)) { selectCustom(id); return; }
  const p = getPreset(id);
  if (!p) return;
  design.palettes = { light: { ...p.light }, dark: { ...p.dark } };
  design.presetId = id;
  commit();
}

/** 현재 프리셋(없으면 크림)으로 팔레트 되돌리기 */
export function resetPalette() {
  selectPreset(design.presetId ?? 'cream');
}

/** 타이포를 기본값으로 */
export function resetTypography() {
  design.typography = defaultDesign().typography;
  commit();
}

/** 가져온 디자인을 즉시 적용. 직전 상태는 되돌리기용으로 보관 */
export function importDesign(next: Design) {
  undoState.prev = cloneDesign(design);
  replace(normalizeDesign(next));
  commit();
}

export function undoImport() {
  if (!undoState.prev) return;
  replace(undoState.prev);
  undoState.prev = null;
  commit();
}

// ---- 내 테마 ----
/** 지금 디자인을 이름 붙여 저장하고 그 테마를 선택한 상태로 둔다 */
export function saveCustom(name: string): string {
  const t: CustomTheme = {
    id: newCustomId(), name: name.trim().slice(0, 40) || '내 테마', savedAt: Date.now(),
    light: { ...design.palettes.light }, dark: { ...design.palettes.dark }, typography: { ...design.typography },
  };
  customs.unshift(t);
  persistCustom(customs);
  design.presetId = CUSTOM_PREFIX + t.id;
  commit();
  return t.id;
}

export function selectCustom(id: string) {
  const t = customs.find((c) => CUSTOM_PREFIX + c.id === id || c.id === id);
  if (!t) return;
  design.palettes = { light: { ...t.light }, dark: { ...t.dark } };
  design.typography = { ...t.typography };
  design.presetId = CUSTOM_PREFIX + t.id;
  commit();
}

export function renameCustom(id: string, name: string) {
  const t = customs.find((c) => c.id === id);
  if (!t) return;
  t.name = name.trim().slice(0, 40) || t.name;
  persistCustom(customs);
}

/** 현재 디자인으로 내 테마를 덮어쓴다 */
export function overwriteCustom(id: string) {
  const t = customs.find((c) => c.id === id);
  if (!t) return;
  t.light = { ...design.palettes.light };
  t.dark = { ...design.palettes.dark };
  t.typography = { ...design.typography };
  t.savedAt = Date.now();
  persistCustom(customs);
}

export function deleteCustom(id: string) {
  const i = customs.findIndex((c) => c.id === id);
  if (i < 0) return;
  customs.splice(i, 1);
  persistCustom(customs);
  if (design.presetId === CUSTOM_PREFIX + id) { design.presetId = undefined; commit(); }
}
