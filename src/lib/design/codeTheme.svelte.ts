// 코드 블록 테마의 선택·내 테마 상태. 이 기기에는 '고른 테마 id'와 '내 코드 테마(사용자가 만든 것)'만 저장하고,
// 내장 테마의 색은 앱에 들어 있다. 선택은 'auto'(디자인 프리셋에 짝지은 테마를 따름)가 기본이다.
import { CODE_THEMES, DEFAULT_CODE_THEME_ID, buildCodeThemeCss, cleanHl, getCodeTheme, pairedCodeTheme, type CodeTheme, type HlKey } from './codeThemes';
import { normalizeHex } from './colors';

export const AUTO = 'auto';
export const CODE_CUSTOM_PREFIX = 'custom:';
const SEL_KEY = 'works.codeTheme';
const CUSTOM_KEY = 'works.codeTheme.custom';
const STYLE_ID = 'works-code-theme';
const MAX_CUSTOM = 30;

const read = (key: string): unknown => {
  try { const t = localStorage.getItem(key); return t ? JSON.parse(t) : null; } catch { return null; }
};
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 저장소를 못 쓰는 환경 */ } };

export function cleanCustomCode(input: unknown): CodeTheme[] {
  if (!Array.isArray(input)) return [];
  const base = CODE_THEMES[0];
  const out: CodeTheme[] = [];
  for (const v of input) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (typeof o.id !== 'string' || !/^(custom:)?[\w-]{1,60}$/.test(o.id) || typeof o.name !== 'string') continue;
    out.push({
      id: CODE_CUSTOM_PREFIX + o.id.replace(/^custom:/, ''),
      name: o.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || '이름 없음',
      light: cleanHl(o.light, base.light),
      dark: cleanHl(o.dark, base.dark),
    });
    if (out.length >= MAX_CUSTOM) break;
  }
  return out;
}

/** 내 코드 테마(이 기기에만 저장) */
export const customCode: CodeTheme[] = $state(cleanCustomCode(read(CUSTOM_KEY)));

const stored = read(SEL_KEY);
export const codeSel: { id: string } = $state({ id: typeof stored === 'string' ? stored : AUTO });

let lastPreset: string | undefined;

/** 선택(없는 id 면 auto)을 실제 테마로 */
export function resolveCodeTheme(sel: string, presetId: string | undefined, customs: CodeTheme[] = customCode): CodeTheme {
  if (sel !== AUTO) {
    const t = getCodeTheme(sel) ?? customs.find((c) => c.id === sel);
    if (t) return t;
  }
  return getCodeTheme(pairedCodeTheme(presetId)) ?? CODE_THEMES[0];
}

/** 지금 적용 중인 코드 테마 */
export const currentCodeTheme = (): CodeTheme => resolveCodeTheme(codeSel.id, lastPreset);

/** 디자인 프리셋이 바뀌었거나 앱이 시작될 때 부른다: 선택에 맞는 테마를 문서에 반영 */
export function refreshCodeTheme(presetId?: string) {
  lastPreset = presetId;
  if (typeof document === 'undefined') return;
  const css = buildCodeThemeCss(currentCodeTheme());
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!css) { el?.remove(); return; }
  if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el); }
  el.textContent = css;
}

export function setCodeTheme(id: string) {
  codeSel.id = id;
  write(SEL_KEY, id);
  refreshCodeTheme(lastPreset);
}

const newId = () => `${CODE_CUSTOM_PREFIX}c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** 테마(내장·내 것·auto 는 지금 적용 중인 것)를 복제해 내 코드 테마로 만들고 선택한다 */
export function duplicateCodeTheme(srcId: string, name?: string): string | null {
  const src = srcId === AUTO ? currentCodeTheme() : getCodeTheme(srcId) ?? customCode.find((c) => c.id === srcId);
  if (!src || customCode.length >= MAX_CUSTOM) return null;
  const t: CodeTheme = { id: newId(), name: (name ?? `${src.name} 복사본`).slice(0, 40), light: { ...src.light }, dark: { ...src.dark } };
  customCode.unshift(t);
  write(CUSTOM_KEY, customCode);
  setCodeTheme(t.id);
  return t.id;
}

export function setCodeColor(id: string, mode: 'light' | 'dark', key: HlKey, value: string) {
  const t = customCode.find((c) => c.id === id);
  const hex = normalizeHex(value);
  if (!t || !hex) return;
  t[mode][key] = hex;
  write(CUSTOM_KEY, customCode);
  if (codeSel.id === id) refreshCodeTheme(lastPreset);
}

export function renameCodeTheme(id: string, name: string) {
  const t = customCode.find((c) => c.id === id);
  if (!t) return;
  t.name = name.trim().slice(0, 40) || t.name;
  write(CUSTOM_KEY, customCode);
}

export function deleteCodeTheme(id: string) {
  const i = customCode.findIndex((c) => c.id === id);
  if (i < 0) return;
  customCode.splice(i, 1);
  write(CUSTOM_KEY, customCode);
  if (codeSel.id === id) setCodeTheme(AUTO);
}

export { DEFAULT_CODE_THEME_ID };
