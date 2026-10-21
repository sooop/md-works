import { describe, it, expect } from 'vitest';
import { CODE_THEMES, HL_KEYS, pairedCodeTheme, buildCodeThemeCss, cleanHl } from '../../src/lib/design/codeThemes';
import { PRESETS } from '../../src/lib/design/presets';
import { contrastRatio, normalizeHex } from '../../src/lib/design/colors';

describe('코드 테마', () => {
  it('모든 색이 16진수이고 id 가 겹치지 않는다', () => {
    expect(new Set(CODE_THEMES.map((t) => t.id)).size).toBe(CODE_THEMES.length);
    for (const t of CODE_THEMES) for (const m of ['light', 'dark'] as const) for (const k of HL_KEYS) expect(normalizeHex(t[m][k]), `${t.id}.${m}.${k}`).not.toBeNull();
  });
  it('짝지은 프리셋의 코드 배경 위에서 읽을 수 있다(주석 2.5, 나머지 3 이상)', () => {
    for (const t of CODE_THEMES) {
      const preset = PRESETS.find((p) => p.id === t.id) ?? PRESETS.find((p) => p.id === 'cream')!;
      for (const m of ['light', 'dark'] as const) for (const k of HL_KEYS) {
        const bg = preset[m].codeBg;
        const need = k === 'comment' ? 2.5 : 3;
        expect(contrastRatio(t[m][k], bg), `${t.id}.${m}.${k} on ${bg}`).toBeGreaterThanOrEqual(need);
      }
    }
  });
  it('짝: 같은 id 의 테마가 있으면 그것, 없으면 기본', () => {
    expect(pairedCodeTheme('dracula')).toBe('dracula');
    expect(pairedCodeTheme('paper')).toBe('default');
    expect(pairedCodeTheme('custom:x')).toBe('default');
    expect(pairedCodeTheme(undefined)).toBe('default');
  });
  it('기본 테마는 CSS 가 없고 나머지는 라이트·다크 변수를 낸다', () => {
    expect(buildCodeThemeCss(CODE_THEMES[0])).toBe('');
    const css = buildCodeThemeCss(CODE_THEMES.find((t) => t.id === 'nord')!);
    expect(css).toContain('--hl-keyword:#4c6f9a');
    expect(css).toContain("[data-theme='dark']");
  });
  it('cleanHl 은 틀린 색을 fallback 으로 바꾼다', () => {
    expect(cleanHl({ keyword: 'zzz', string: '#abc' }, CODE_THEMES[0].light).keyword).toBe(CODE_THEMES[0].light.keyword);
    expect(cleanHl({ string: '#abc' }, CODE_THEMES[0].light).string).toBe('#aabbcc');
  });
});
