// 디자인 설정의 반응형 상태. 패널과 앱 시작(main.ts)이 공유한다
import { loadDesign, saveDesign, cloneDesign, normalizeDesign, defaultDesign } from './io';
import { applyDesign } from './apply';
import { getPreset } from './presets';
import type { Design, PaletteKey, TypoKey, Typography } from './schema';
import { clampTypography } from './schema';
import { normalizeHex } from './colors';

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

/** 프리셋 선택: 라이트·다크 팔레트를 함께 교체 */
export function selectPreset(id: string) {
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
