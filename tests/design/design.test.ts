import { describe, it, expect } from 'vitest';
import { contrastRatio, luminance, derivePalette, contrastWarnings, mixHex, normalizeHex, onColor } from '../../src/lib/design/colors';
import { clampTypography, clampNum, TYPO_SPEC, DEFAULT_TYPOGRAPHY, PALETTE_KEYS, type NumSpec } from '../../src/lib/design/schema';
import { PRESETS } from '../../src/lib/design/presets';
import { buildFontFamily, parseFontNames, FALLBACK_TEXT } from '../../src/lib/design/fontStack';
import { defaultDesign, serializeDesign, parseDesign, migrateLegacySettings, normalizeDesign } from '../../src/lib/design/io';
import { buildDesignCss } from '../../src/lib/design/apply';

describe('대비 계산', () => {
  it('알려진 값', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });
  it('경고: 글자/배경·보조/배경·primary 위 글자', () => {
    const p = { ...PRESETS[0].light, text: '#cccccc', muted: '#eeeeee' };
    const keys = contrastWarnings(p).map((w) => w.key);
    expect(keys).toContain('text');
    expect(keys).toContain('muted');
    expect(contrastWarnings(PRESETS[0].light).map((w) => w.key)).toEqual(['primary']); // 기존 크림 팔레트의 흰 글자/#c15f3c 대비는 4.23
  });
  it('내장 프리셋은 글자·보조 글자 대비 기준을 넘는다', () => {
    for (const pr of PRESETS) for (const m of ['light', 'dark'] as const) expect(contrastWarnings(pr[m]).filter((w) => w.key !== 'primary'), `${pr.id}/${m}`).toEqual([]);
  });
  it('hex 정규화', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('c15f3c')).toBe('#c15f3c');
    expect(normalizeHex('#12')).toBeNull();
    expect(normalizeHex(5)).toBeNull();
  });
});

describe('파생 색', () => {
  const near = (a: string, b: string, tol = 4) => {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    pa.forEach((v, i) => expect(Math.abs(v - pb[i])).toBeLessThanOrEqual(tol));
  };
  it('크림 라이트: 현재 app.css 값과 시각적으로 같다', () => {
    const v = derivePalette(PRESETS[0].light, 'light');
    near(v['--surface-2'], '#f0eee6');
    near(v['--hover'], '#efede4');
    near(v['--selected'], '#e8e6dc');
    near(v['--border-strong'], '#cfcdc2');
    near(v['--table-line'], '#a09e92');
    expect(v['--on-primary']).toBe('#ffffff');
  });
  it('크림 다크', () => {
    const v = derivePalette(PRESETS[0].dark, 'dark');
    near(v['--surface-2'], '#353532');
    near(v['--hover'], '#33322f');
    near(v['--selected'], '#403f3a');
    near(v['--border-strong'], '#55544e');
    near(v['--table-line'], '#7a7972');
    expect(v['--on-primary']).toBe('#1f1e1d');
  });
  it('mix·onColor', () => {
    expect(mixHex('#000000', '#ffffff', 50)).toBe('#808080');
    expect(onColor('#000000')).toBe('#ffffff');
    expect(onColor('#ffffff')).toBe('#1f1e1d');
  });
});

describe('스키마 클램프', () => {
  it('범위 밖·잘못된 타입', () => {
    const t = clampTypography({ fontSize: 999, lineHeight: 0, letterSpacing: 'x', indent: -3, align: 'center', quoteBg: 'yes', h1Scale: 100, contentWidth: 100, bogus: 1 });
    expect(t.fontSize).toBe(24);
    expect(t.lineHeight).toBe(1.2);
    expect(t.letterSpacing).toBe(0);
    expect(t.indent).toBe(0);
    expect(t.align).toBe('left');
    expect(t.quoteBg).toBe(false);
    expect(t.h1Scale).toBe(3);
    expect(t.contentWidth).toBe(480);
    expect('bogus' in t).toBe(false);
  });
  it('본문 폭 0 은 전체 폭으로 보존', () => {
    expect(clampTypography({ contentWidth: 0 }).contentWidth).toBe(0);
    expect(clampNum(TYPO_SPEC.fontSize as NumSpec, 0)).toBe(12);
  });
  it('기본값은 현재 화면과 같다', () => {
    expect(DEFAULT_TYPOGRAPHY.fontSize).toBe(15);
    expect(DEFAULT_TYPOGRAPHY.contentWidth).toBe(980);
    expect(DEFAULT_TYPOGRAPHY.lineHeight).toBe(1.5);
    expect(clampTypography(undefined)).toEqual(DEFAULT_TYPOGRAPHY);
  });
});

describe('font-family', () => {
  it('이스케이프·폴백', () => {
    const v = buildFontFamily('Noto Serif KR');
    expect(v).toBe(`"Noto Serif KR", ${FALLBACK_TEXT}`);
    expect(buildFontFamily('a"; } body { x: y; /* , serif')).not.toMatch(/[;{}]/);
    expect(buildFontFamily('</style><script>')).not.toMatch(/[<>]/);
    expect(buildFontFamily("Foo\\\"Bar")).toBe(`"FooBar", ${FALLBACK_TEXT}`);
    expect(buildFontFamily('')).toBe('');
    expect(buildFontFamily('Georgia, serif')).toContain('"Georgia", serif,');
  });
  it('따옴표 안의 쉼표 보존·개수 제한', () => {
    expect(parseFontNames('"A, B", C')).toEqual(['A, B', 'C']);
    expect(parseFontNames('1,2,3,4,5,6,7,8,9,10')).toHaveLength(8);
  });
});

describe('직렬화', () => {
  it('왕복', () => {
    const d = defaultDesign();
    d.typography.fontSize = 18;
    d.palettes.dark.primary = '#112233';
    const res = parseDesign(serializeDesign(d));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual(d);
    const j = JSON.parse(serializeDesign(d));
    expect(j.schema).toBe('md-works-design');
    expect(j.version).toBe(1);
  });
  it('형식이 틀리면 오류', () => {
    for (const bad of ['not json', '[]', 'null', '{}', '{"schema":"x","version":1}', '{"schema":"md-works-design"}',
      '{"schema":"md-works-design","version":99,"typography":{}}', '{"schema":"md-works-design","version":1,"typography":5}']) {
      expect(parseDesign(bad).ok, bad).toBe(false);
    }
  });
  it('잘못된 항목은 무시·클램프', () => {
    const res = parseDesign(JSON.stringify({
      schema: 'md-works-design', version: 1,
      typography: { fontSize: 500, lineHeight: 'a' },
      palettes: { light: { bg: 'red', text: '#000' } },
      presetId: 'nope',
    }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.typography.fontSize).toBe(24);
    expect(res.value.typography.lineHeight).toBe(1.5);
    expect(res.value.palettes.light.bg).toBe(PRESETS[0].light.bg);
    expect(res.value.palettes.light.text).toBe('#000000');
    expect(res.value.presetId).toBeUndefined();
    for (const k of PALETTE_KEYS) expect(res.value.palettes.dark[k]).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('normalizeDesign 은 어떤 입력도 완전한 디자인을 돌려준다', () => {
    expect(normalizeDesign(null)).toEqual({ ...defaultDesign(), presetId: undefined });
  });
});

describe('기존 설정 이관', () => {
  it('사용자가 고른 값은 이관', () => {
    expect(migrateLegacySettings({ version: 3, fontSize: 18, contentWidth: 1200 })).toEqual({ fontSize: 18, contentWidth: 1200 });
    expect(migrateLegacySettings({ version: 3, contentWidth: 0 })).toEqual({ contentWidth: 0 });
  });
  it('옛 기본값(v2 이하의 16/860)은 버린다', () => {
    expect(migrateLegacySettings({ version: 2, fontSize: 16, contentWidth: 860 })).toEqual({});
    expect(migrateLegacySettings({ version: 2, fontSize: 17 })).toEqual({ fontSize: 17 });
  });
  it('값이 없거나 이상하면 빈 객체', () => {
    expect(migrateLegacySettings(null)).toEqual({});
    expect(migrateLegacySettings({ version: 3, fontSize: 'x' })).toEqual({});
  });
});

describe('CSS 생성', () => {
  it('인쇄에 영향이 없도록 @media screen 안에만 규칙이 있다', () => {
    const css = buildDesignCss(defaultDesign());
    expect(css.startsWith('@media screen{')).toBe(true);
    expect(css.trimEnd().endsWith('}')).toBe(true);
    expect(css).toContain("html:root[data-theme='dark']");
    expect(css).toContain('--editor-font-size:15px');
    expect(css).toContain('--ed-quote-color:var(--quote)');
  });
  it('서체를 지정하면 변수가 생기고 비우면 생기지 않는다', () => {
    const d = defaultDesign();
    expect(buildDesignCss(d)).not.toContain('--ed-font:');
    d.typography.bodyFont = 'Noto Serif KR';
    const css = buildDesignCss(d);
    expect(css).toContain('--ed-font:"Noto Serif KR"');
    expect(css).toContain('--ed-heading-font:"Noto Serif KR"');
  });
});
